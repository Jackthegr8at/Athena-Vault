import { test, type BrowserContext } from "@playwright/test";

type WebVitalName =
  | "LCP"
  | "CLS"
  | "INP"
  | "transferSize"
  | "horizontalOverflow";

interface WebVitalObservation {
  name: WebVitalName;
  value: number;
  unit: "ms" | "score" | "bytes" | "boolean";
}

declare global {
  interface Window {
    __ATHENA_LOCAL_WEB_VITALS__?: {
      observations: WebVitalObservation[];
      flush(): void;
    };
  }
}
type ProfileName = "desktop" | "tablet" | "mobile";


interface Profile {
  name: ProfileName;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile?: boolean;
}

interface WebVitalsPayload {
  route: string;
  profile: string;
  observations: WebVitalObservation[];
  deviations: { metric: string; value: number; threshold: number }[];
}

const VITALS_RUN = process.env.ATHENA_WEB_VITALS_RUN === "true";
const BASE_URL = process.env.ATHENA_E2E_BASE_URL ?? "http://localhost:3000";
const ROUTE = "/login";

const PROFILES: Profile[] = [
  { name: "desktop", viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  { name: "tablet", viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2 },
  { name: "mobile", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true },
];

const THRESHOLDS: Record<ProfileName, { LCP: number; CLS: number; INP: number }> = {
  desktop: { LCP: 1500, CLS: 0.1, INP: 200 },
  tablet: { LCP: 2500, CLS: 0.1, INP: 200 },
  mobile: { LCP: 2500, CLS: 0.1, INP: 200 },
};

const describeFn = VITALS_RUN ? test.describe : test.describe.skip;
const describeTitle = VITALS_RUN
  ? "Web Vitals (local E2E)"
  : "Web Vitals — skipped: ATHENA_WEB_VITALS_RUN is not true. These tests require a disposable local workspace with Playwright.";

describeFn(describeTitle, () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_URL}${ROUTE}`);
      await page.waitForLoadState("domcontentloaded");
      // Warm the route so the measured run does not pay dev-server compilation.
      // Any first-run redirect from the application is left alone.
    } finally {
      await context.close();
    }
  });

  for (const profile of PROFILES) {
    test(`${ROUTE} @ ${profile.name}`, async ({ browser }) => {
      let context: BrowserContext | undefined;

      try {
        context = await browser.newContext({
          viewport: profile.viewport,
          deviceScaleFactor: profile.deviceScaleFactor,
          isMobile: profile.isMobile ?? false,
          baseURL: BASE_URL,
        });
        const page = await context.newPage();

        await page.goto(ROUTE);
        await page.waitForLoadState("domcontentloaded");

        await page.waitForFunction(
          () => typeof window.__ATHENA_LOCAL_WEB_VITALS__ !== "undefined",
          { timeout: 10_000 },
        );

        // Non-mutating representative interactions: a click and a keyboard press.
        // The form is intentionally not submitted.
        await page.locator("body").click();
        await page.keyboard.press("Tab");
        // Allow the PerformanceObserver to record the interaction.
        await page.waitForTimeout(500);

        const payload = await page.evaluate<WebVitalsPayload, { route: string; profile: string }>(
          ({ route, profile }) => {
            const hook = window.__ATHENA_LOCAL_WEB_VITALS__;
            if (!hook) {
              throw new Error("__ATHENA_LOCAL_WEB_VITALS__ is not initialized");
            }
            hook.flush();
            return {
              route,
              profile,
              observations: hook.observations,
              deviations: [],
            };
          },
          { route: ROUTE, profile: profile.name },
        );

        const getValue = (name: WebVitalName) =>
          payload.observations.find((o) => o.name === name)?.value;

        const requireFinite = (name: WebVitalName): number => {
          const value = getValue(name);
          if (value === undefined || !Number.isFinite(value)) {
            throw new Error(
              `Missing or non-finite ${name} observation for ${profile.name}`,
            );
          }
          return value;
        };

        requireFinite("LCP");
        requireFinite("CLS");
        requireFinite("transferSize");
        const horizontalOverflow = requireFinite("horizontalOverflow");
        if (horizontalOverflow !== 0) {
          throw new Error(
            `Horizontal overflow detected on ${profile.name} (${horizontalOverflow}).`,
          );
        }

        const inp = getValue("INP");
        if (inp === undefined || !Number.isFinite(inp) || inp <= 0) {
          throw new Error(
            `INP observation is missing, non-finite, or not strictly positive for ${profile.name}. ` +
              "PerformanceObserver event timing may be unsupported or no interaction was observed.",
          );
        }

        const thresholds = THRESHOLDS[profile.name];
        const deviations: { metric: string; value: number; threshold: number }[] = [];

        const lcp = getValue("LCP")!;
        if (lcp > thresholds.LCP) {
          deviations.push({ metric: "LCP", value: lcp, threshold: thresholds.LCP });
        }

        const cls = getValue("CLS")!;
        if (cls > thresholds.CLS) {
          deviations.push({ metric: "CLS", value: cls, threshold: thresholds.CLS });
        }

        if (inp > thresholds.INP) {
          deviations.push({ metric: "INP", value: inp, threshold: thresholds.INP });
        }

        const finalPayload: WebVitalsPayload = { ...payload, deviations };

        test.info().attach("web-vitals-observations", {
          body: JSON.stringify(finalPayload, null, 2),
          contentType: "application/json",
        });

        if (deviations.length > 0) {
          test.info().attach("web-vitals-deviations", {
            body: JSON.stringify(
              { route: ROUTE, profile: profile.name, deviations },
              null,
              2,
            ),
            contentType: "application/json",
          });
          console.warn(
            `Web Vitals threshold deviations on ${ROUTE} @ ${profile.name}:`,
            deviations,
          );
        }
      } finally {
        await context?.close();
      }
    });
  }
});

import { test, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

declare global {
  interface Window {
    __ATHENA_A11Y_ZOOM_OBSERVATIONS__?: A11yObservations;
  }
}

type A11yObservations = {
  route: string;
  profile: string;
  overflow: {
    ok: boolean;
    clientWidth: number;
    scrollWidth: number;
  };
  keyboard: {
    ok: boolean;
    focusStops: number;
    expected: number;
    details: FocusDetail[];
  };
  readable: {
    ok: boolean;
    smallTextNodes: SmallTextNode[];
  };
  targetSizing: TargetViolation[];
};

type FocusDetail = {
  tag: string;
  id: string;
  focusVisible: boolean;
  hasOutline: boolean;
};

type SmallTextNode = {
  text: string;
  fontSize: number;
  tag: string;
};

type TargetViolation = {
  tag: string;
  identifier: string;
  width: number;
  height: number;
};

type PageMetrics = {
  overflow: A11yObservations["overflow"];
  smallTextNodes: SmallTextNode[];
  targetViolations: TargetViolation[];
};

type Profile = {
  name: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
};

const E2E_ENABLED = process.env.ATHENA_E2E_ENABLED === "true";
const BASE_URL = process.env.ATHENA_E2E_BASE_URL ?? "http://localhost:3000";

const describeFn = E2E_ENABLED ? test.describe : test.describe.skip;
const describeTitle = E2E_ENABLED
  ? "A11y zoom (local E2E)"
  : "A11y zoom — skipped: ATHENA_E2E_ENABLED is not true. These tests require a disposable local workspace with Playwright.";

const ROUTES = [
  "/login",
  "/",
  "/accounts",
  "/annual-expenses",
  "/settings",
  "/workbooks",
];

const PROFILES: Profile[] = [
  { name: "mobile-320", viewport: { width: 320, height: 667 }, deviceScaleFactor: 1 },
  { name: "mobile-375", viewport: { width: 375, height: 667 }, deviceScaleFactor: 1 },
  { name: "tablet-768", viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 },
  { name: "desktop-1280", viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  // 200% zoom is emulated by doubling the device pixel ratio while keeping
  // the same physical display size (1280x720), which yields a 640x360 CSS
  // viewport — the same effective layout as a desktop browser at 200% zoom.
  { name: "desktop-1280-200pct", viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 },
];

async function collectPageMetrics(
  page: Page,
): Promise<PageMetrics> {
  return page.evaluate<PageMetrics>(
    () => {
      const rootFontSize = parseFloat(
        window.getComputedStyle(document.documentElement).fontSize,
      );
      const minFontSize = rootFontSize * 0.75;

      const scrollingEl = document.scrollingElement ?? document.documentElement;
      const clientWidth = scrollingEl.clientWidth;
      const scrollWidth = scrollingEl.scrollWidth;
      const overflow = {
        ok: scrollWidth <= clientWidth + 20,
        clientWidth,
        scrollWidth,
      };

      const smallTextNodes: SmallTextNode[] = [];
      const treeWalker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
      );
      let textNode: Node | null;
      while ((textNode = treeWalker.nextNode()) !== null) {
        const content = textNode.textContent?.trim() ?? "";
        if (!content) continue;
        const parent = textNode.parentElement;
        if (!parent) continue;
        const style = window.getComputedStyle(parent);
        if (
          parent.closest(
            '[aria-hidden="true"], [data-a11y-ignore="true"], [role="img"], [role="presentation"], [role="none"]',
          ) !== null ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0 ||
          parent.tagName === "SCRIPT" ||
          parent.tagName === "STYLE" ||
          parent.tagName === "NOSCRIPT"
        ) {
          continue;
        }
        const fontSize = parseFloat(style.fontSize);
        if (!Number.isNaN(fontSize) && fontSize > 0 && fontSize < minFontSize) {
          smallTextNodes.push({
            text: content.slice(0, 80),
            fontSize,
            tag: parent.tagName,
          });
        }
      }

      const targetSelector =
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"]:not([disabled]), [role="link"][href], [tabindex]:not([tabindex="-1"])';
      const targets = Array.from(
        document.querySelectorAll<HTMLElement>(targetSelector),
      );
      const targetViolations: TargetViolation[] = [];
      for (const el of targets) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0 ||
          rect.width === 0 ||
          rect.height === 0
        ) {
          continue;
        }
        if (el.closest('[aria-hidden="true"], [data-a11y-ignore="true"]')) {
          continue;
        }
        if (rect.width < 24 || rect.height < 24) {
          const identifier =
            (el.id ? `#${el.id} ` : "") +
            (el.getAttribute("data-testid") ??
              el.getAttribute("aria-label") ??
              el.getAttribute("title") ??
              el.textContent?.trim().slice(0, 30) ??
              "<unknown>");
          targetViolations.push({
            tag: el.tagName,
            identifier,
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
          });
        }
      }

      return { overflow, smallTextNodes, targetViolations };
    },
  );
}

type FocusInfo = { count: number };

async function collectKeyboardMetrics(page: Page): Promise<A11yObservations["keyboard"]> {
  const focusInfo = await page.evaluate<FocusInfo>(() => {
    const targetSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"]:not([disabled]), [role="link"][href], [tabindex]:not([tabindex="-1"])';
    return { count: document.querySelectorAll<HTMLElement>(targetSelector).length };
  });

  const keyboardDetails: FocusDetail[] = [];
  const seen = new Set<string>();
  const maxTabs = Math.min(focusInfo.count + 5, 30);

  for (let i = 0; i < maxTabs; i += 1) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate<FocusDetail | null>(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el === document.documentElement) {
        return null;
      }
      const style = window.getComputedStyle(el);
      const outlineStyle = style.outlineStyle;
      const outlineWidth = parseFloat(style.outlineWidth);
      const boxShadow = style.boxShadow;
      const hasOutline =
        (outlineStyle !== "none" && !Number.isNaN(outlineWidth) && outlineWidth > 0) ||
        boxShadow !== "none";
      return {
        tag: el.tagName,
        id: el.id ?? "",
        focusVisible: el.matches(":focus-visible"),
        hasOutline,
      };
    });

    if (!active) {
      if (keyboardDetails.length > 0) break;
      continue;
    }

    const key = active.id ? `${active.tag}#${active.id}` : `${active.tag}:${i}`;

    const first = keyboardDetails[0];
    if (first) {
      const firstKey = first.id ? `${first.tag}#${first.id}` : `${first.tag}:0`;
      if (i > 0 && key === firstKey) {
        break;
      }
    }

    if (seen.has(key)) continue;
    seen.add(key);
    keyboardDetails.push(active);

    if (keyboardDetails.length >= focusInfo.count) break;
  }

  const ok =
    focusInfo.count === 0 ||
    (keyboardDetails.length > 0 &&
      keyboardDetails.every((d) => d.focusVisible || d.hasOutline));

  return {
    ok,
    focusStops: keyboardDetails.length,
    expected: focusInfo.count,
    details: keyboardDetails,
  };
}

describeFn(describeTitle, () => {
  for (const route of ROUTES) {
    for (const profile of PROFILES) {
      test(`${route} @ ${profile.name}`, async ({ browser }) => {
        let context: BrowserContext | undefined;
        let page: Page | undefined;

        try {
          context = await browser.newContext({
            viewport: profile.viewport,
            deviceScaleFactor: profile.deviceScaleFactor,
            baseURL: BASE_URL,
          });
          page = await context.newPage();
          await page.goto(route);
          await page.waitForLoadState("domcontentloaded");
          await page.waitForTimeout(200);

          const initial = await collectPageMetrics(page);
          const keyboard = await collectKeyboardMetrics(page);

          const observations: A11yObservations = {
            route,
            profile: profile.name,
            overflow: initial.overflow,
            keyboard,
            readable: {
              ok: initial.smallTextNodes.length === 0,
              smallTextNodes: initial.smallTextNodes,
            },
            targetSizing: initial.targetViolations,
          };

          await page.evaluate<void, A11yObservations>((obs) => {
            window.__ATHENA_A11Y_ZOOM_OBSERVATIONS__ = obs;
          }, observations);

          test.info().attach("a11y-observations", {
            body: JSON.stringify(observations, null, 2),
            contentType: "application/json",
          });

          if (observations.targetSizing.length > 0) {
            test.info().attach("target-sizing-violations", {
              body: JSON.stringify(observations.targetSizing, null, 2),
              contentType: "application/json",
            });
            console.warn(
              `Target sizing violations on ${route} @ ${profile.name}:`,
              observations.targetSizing,
            );
          }

          expect(
            observations.overflow.ok,
            `horizontal overflow on ${route} at ${profile.name}`,
          ).toBe(true);
          expect(
            observations.readable.ok,
            `text too small on ${route} at ${profile.name}`,
          ).toBe(true);
          expect(
            observations.keyboard.ok,
            `keyboard focus not visible on ${route} at ${profile.name}`,
          ).toBe(true);
        } finally {
          await context?.close();
        }
      });
    }
  }
});

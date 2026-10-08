export interface WebVitalObservation {
  name: "LCP" | "CLS" | "INP" | "transferSize" | "horizontalOverflow";
  value: number;
  unit: "ms" | "score" | "bytes" | "boolean";
}

export interface LocalWebVitalsHook {
  observations: WebVitalObservation[];
  flush(): void;
}

declare global {
  interface Window {
    __ATHENA_LOCAL_WEB_VITALS__?: LocalWebVitalsHook;
  }
}

type LcpEntry = PerformanceEntry & { startTime: number };
type LayoutShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean };
type EventEntry = PerformanceEntry & { duration: number; interactionId: number };
type ResourceEntry = PerformanceEntry & { transferSize: number };

function isSupportedEntryType(type: string): boolean {
  return (
    typeof PerformanceObserver !== "undefined" &&
    Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes(type)
  );
}

export function initLocalWebVitals(): () => void {
  const enabled =
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_ATHENA_LOCAL_WEB_VITALS === "true";

  if (!enabled) {
    return () => {};
  }

  let lcp: number | undefined;
  let cls = 0;
  let inp: number | undefined;
  let transferSize = 0;

  const lcpSupported = isSupportedEntryType("largest-contentful-paint");
  const clsSupported = isSupportedEntryType("layout-shift");
  const inpSupported = isSupportedEntryType("event");
  const resourceSupported = isSupportedEntryType("resource");

  const observers: PerformanceObserver[] = [];

  function processEntries(entries: readonly PerformanceEntry[]): void {
    for (const entry of entries) {
      const type = entry.entryType;

      if (type === "largest-contentful-paint") {
        const candidate = (entry as LcpEntry).startTime;
        if (lcp === undefined || candidate > lcp) {
          lcp = candidate;
        }
      } else if (type === "layout-shift") {
        const shift = entry as LayoutShiftEntry;
        if (!shift.hadRecentInput) {
          cls += shift.value;
        }
      } else if (type === "event") {
        const event = entry as EventEntry;
        if (event.interactionId && event.duration > 0) {
          if (inp === undefined || event.duration > inp) {
            inp = event.duration;
          }
        }
      } else if (type === "resource") {
        transferSize += (entry as ResourceEntry).transferSize || 0;
      }
    }
  }

  function createObserver(type: string): PerformanceObserver | null {
    if (!isSupportedEntryType(type)) {
      return null;
    }
    try {
      const options: PerformanceObserverInit & { durationThreshold?: number } = {
        type,
        buffered: true,
      };
      if (type === "event") {
        options.durationThreshold = 16;
      }
      const observer = new PerformanceObserver((list) => {
        processEntries(list.getEntries());
      });
      observer.observe(options as PerformanceObserverInit);
      return observer;
    } catch {
      return null;
    }
  }

  if (lcpSupported) {
    const observer = createObserver("largest-contentful-paint");
    if (observer) observers.push(observer);
  }

  if (clsSupported) {
    const observer = createObserver("layout-shift");
    if (observer) observers.push(observer);
  }

  if (inpSupported) {
    const observer = createObserver("event");
    if (observer) observers.push(observer);
  }

  if (resourceSupported) {
    const observer = createObserver("resource");
    if (observer) observers.push(observer);
  }

  function flush(): void {
    for (const observer of observers) {
      processEntries(observer.takeRecords());
    }

    const observations: WebVitalObservation[] = [];

    if (typeof lcp === "number") {
      observations.push({ name: "LCP", value: lcp, unit: "ms" });
    }

    if (clsSupported) {
      observations.push({ name: "CLS", value: cls, unit: "score" });
    }

    if (typeof inp === "number") {
      observations.push({ name: "INP", value: inp, unit: "ms" });
    }

    if (resourceSupported) {
      observations.push({
        name: "transferSize",
        value: transferSize,
        unit: "bytes",
      });
    }

    const horizontalOverflow =
      document.documentElement.scrollWidth > document.documentElement.clientWidth
        ? 1
        : 0;
    observations.push({
      name: "horizontalOverflow",
      value: horizontalOverflow,
      unit: "boolean",
    });

    window.__ATHENA_LOCAL_WEB_VITALS__ = {
      observations,
      flush,
    };
  }

  window.__ATHENA_LOCAL_WEB_VITALS__ = {
    observations: [],
    flush,
  };

  return function cleanup(): void {
    for (const observer of observers) {
      try {
        observer.disconnect();
      } catch {
        // Ignore; the observer may already be disconnected.
      }
    }
  };
}

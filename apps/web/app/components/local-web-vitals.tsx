"use client";

import { useEffect } from "react";
import { initLocalWebVitals } from "../../lib/web-vitals";

export function LocalWebVitals() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ATHENA_LOCAL_WEB_VITALS !== "true") {
      return;
    }
    return initLocalWebVitals();
  }, []);

  return null;
}

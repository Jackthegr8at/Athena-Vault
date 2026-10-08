import { useEffect, useRef } from "react";

const DEFAULT_AUTO_DISMISS_DELAY_MS = 5000;

export function useAutoDismiss(
  isActive: boolean,
  onDismiss: () => void,
  delayMs = DEFAULT_AUTO_DISMISS_DELAY_MS,
): void {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!isActive) return;

    const timeoutId = window.setTimeout(() => onDismissRef.current(), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, isActive]);
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type State<T> = { scope: object; status: "loading" | "ready" | "error"; data?: readonly T[] };
export function useDeferredDetails<T>(kind: "recurring" | "excluded", enabled: boolean, scope: object, validate: (value: unknown) => value is readonly T[]) {
  const [state, setState] = useState<State<T> | null>(null);
  const flight = useRef<{ scope: object; controller: AbortController } | null>(null);
  const current = state?.scope === scope ? state : null;
  useEffect(() => () => { flight.current?.controller.abort(); flight.current = null; }, [scope]);
  const load = useCallback(() => {
    if (!enabled || flight.current?.scope === scope) return;
    const controller = new AbortController();
    const request = { scope, controller };
    flight.current?.controller.abort(); flight.current = request;
    setState({ scope, status: "loading" });
    void fetch(`/api/cash-flow/details?kind=${kind}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Details unavailable");
        const body: unknown = await response.json();
        const data = body && typeof body === "object" && "data" in body ? body.data : null;
        if (!validate(data)) throw new Error("Invalid details");
        if (!controller.signal.aborted && flight.current === request) setState({ scope, status: "ready", data });
      }).catch(() => {
        if (!controller.signal.aborted && flight.current === request) setState({ scope, status: "error" });
      }).finally(() => { if (flight.current === request) flight.current = null; });
  }, [enabled, kind, scope, validate]);
  return { status: current?.status ?? "idle", data: current?.data, load };
}

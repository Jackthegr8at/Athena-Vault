// @vitest-environment jsdom
import React, { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";
import { useDeferredDetails } from "./use-deferred-details";
const dom = createDomTestRoot();
const validate = (v: unknown): v is readonly string[] => Array.isArray(v) && v.every(x => typeof x === "string");
function Harness({ scope }: { scope: object }) {
  const details = useDeferredDetails("excluded", true, scope, validate);
  return <><button onClick={() => { details.load(); details.load(); }}>Load</button><span>{details.status}</span><output>{details.data?.join(",")}</output></>;
}
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
it("does not fetch initially, deduplicates, and retries without replacing focus", async () => {
  fetchMock.mockRejectedValueOnce(new Error("synthetic failure"));
  const scope = {};
  await dom.render(<Harness scope={scope} />); expect(fetchMock).not.toHaveBeenCalled();
  const button = dom.get<HTMLButtonElement>("button"); button.focus(); await click(button);
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(dom.get("span").textContent).toBe("error");
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: ["synthetic"] }) });
  await click(button); expect(fetchMock).toHaveBeenCalledTimes(2); expect(dom.get("output").textContent).toBe("synthetic"); expect(document.activeElement).toBe(button);
});
it("ignores obsolete responses after scope refresh and aborts unmounted requests", async () => {
  let resolve: (value: unknown) => void = () => {};
  fetchMock.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await dom.render(<Harness scope={{}} />); await click(dom.get("button"));
  const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
  await dom.render(<Harness scope={{}} />); expect(signal.aborted).toBe(true);
  await act(async () => resolve({ ok: true, json: async () => ({ data: ["old"] }) }));
  expect(dom.get("output").textContent).toBe(""); expect(dom.get("span").textContent).toBe("idle");
});

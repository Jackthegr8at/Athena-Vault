import { describe, expect, it } from "vitest";
import { resolveWorkbookNavigationHref, type WorkbookNavigationClick } from "./workbook-navigation";

const baseClick: WorkbookNavigationClick = {
  href: "/accounts",
  currentHref: "http://localhost:3000/workbooks?workbook=workbook-a",
  button: 0,
  defaultPrevented: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target: "",
  download: false,
};

describe("resolveWorkbookNavigationHref", () => {
  it("returns a same-origin route with its query and hash", () => {
    expect(resolveWorkbookNavigationHref({ ...baseClick, href: "/accounts?from=workbook#summary" })).toBe("/accounts?from=workbook#summary");
  });

  it.each([
    ["a secondary mouse button", { button: 1 }],
    ["a modified command click", { metaKey: true }],
    ["a modified control click", { ctrlKey: true }],
    ["a modified shift click", { shiftKey: true }],
    ["a modified alternate click", { altKey: true }],
    ["a prevented click", { defaultPrevented: true }],
    ["a download", { download: true }],
    ["a new-tab target", { target: "_blank" }],
    ["an external URL", { href: "https://example.com/accounts" }],
    ["the same route with another hash", { href: "/workbooks?workbook=workbook-a#details" }],
    ["the same route", { href: "/workbooks?workbook=workbook-a" }],
  ] as const)("ignores %s", (_description, overrides) => {
    expect(resolveWorkbookNavigationHref({ ...baseClick, ...overrides })).toBeNull();
  });

  it("accepts an explicit same-window target", () => {
    expect(resolveWorkbookNavigationHref({ ...baseClick, target: "_self" })).toBe("/accounts");
  });
});

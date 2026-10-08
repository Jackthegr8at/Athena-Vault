// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvestmentDropdown } from "./investment-dropdown";

describe("InvestmentDropdown", () => {
  it("renders a closed floating dropdown without creating an empty portal during SSR", () => {
    const markup = renderToStaticMarkup(<InvestmentDropdown
      value="checking"
      options={[{ value: "checking", label: "Checking" }]}
      onChange={() => undefined}
      aria-label="Account type"
      floating
    />);

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("investment-dropdown-options");
  });
});

"use client";

import { useState } from "react";
import { InvestmentDropdown, type InvestmentDropdownOption } from "../investments/investment-dropdown";

interface FormDropdownProps<T extends string> {
  readonly id?: string;
  readonly name: string;
  readonly defaultValue: T;
  readonly options: readonly InvestmentDropdownOption<T>[];
  readonly describedBy?: string;
  readonly invalid?: boolean;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly numeric?: boolean;
  readonly ariaLabel?: string;
  readonly floatingMinWidth?: number;
}

export function FormDropdown<T extends string>({ id, name, defaultValue, options, describedBy, invalid, required, disabled, numeric = false, ariaLabel, floatingMinWidth = 260 }: FormDropdownProps<T>) {
  const [value, setValue] = useState<T>(defaultValue);
  return <InvestmentDropdown id={id} name={name} value={value} options={options} onChange={setValue} floating floatingMinWidth={floatingMinWidth} disabled={disabled} numeric={numeric} aria-label={ariaLabel} aria-describedby={describedBy} aria-invalid={invalid} aria-required={required} />;
}

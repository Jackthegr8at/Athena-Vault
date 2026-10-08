"use client";

import { createPortal } from "react-dom";
import React, { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

export type InvestmentDropdownOption<T extends string = string> = {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
};

type InvestmentDropdownPosition = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly maxHeight: number;
};

type InvestmentDropdownProps<T extends string = string> = {
  readonly id?: string;
  readonly name?: string;
  readonly value: T;
  readonly options: readonly InvestmentDropdownOption<T>[];
  readonly onChange: (value: T) => void;
  readonly className?: string;
  readonly numeric?: boolean;
  readonly disabled?: boolean;
  readonly floating?: boolean;
  readonly floatingMinWidth?: number;
  readonly "aria-label"?: string;
  readonly "aria-labelledby"?: string;
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: boolean;
  readonly "aria-required"?: boolean;
};

export function InvestmentDropdown<T extends string>({
  id,
  name,
  value,
  options,
  onChange,
  className,
  numeric = false,
  disabled = false,
  floating = false,
  floatingMinWidth = 0,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: InvestmentDropdownProps<T>) {
  const idScope = useId().replace(/:/g, "");
  const triggerId = id ?? `investment-dropdown-${idScope}`;
  const valueId = `${triggerId}-value`;
  const listboxId = `${triggerId}-options`;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options.find((option) => option.value === value) ?? options[selectedIndex] ?? null;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [menuPosition, setMenuPosition] = useState<InvestmentDropdownPosition | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rootClassName = `investment-dropdown${open ? " is-open" : ""}${numeric ? " is-numeric" : ""}${className ? ` ${className}` : ""}`;
  const triggerLabelledBy = ariaLabel ? undefined : ariaLabelledBy ? `${ariaLabelledBy} ${valueId}` : undefined;

  useEffect(() => {
    if (!open) return;
    function dismissDropdown(event: PointerEvent): void {
      if (event.target instanceof Node && (dropdownRef.current?.contains(event.target) || optionsRef.current?.contains(event.target))) return;
      setOpen(false);
      setMenuPosition(null);
    }
    function closeDropdownOnEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setOpen(false);
      setMenuPosition(null);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", dismissDropdown);
    document.addEventListener("keydown", closeDropdownOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissDropdown);
      document.removeEventListener("keydown", closeDropdownOnEscape);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !floating) return;

    function updateMenuPosition(): void {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = Math.max(window.innerWidth, 24);
      const viewportHeight = Math.max(window.innerHeight, 24);
      const width = Math.min(Math.max(rect.width, floatingMinWidth), Math.max(0, viewportWidth - 24));
      const maxLeft = Math.max(12, viewportWidth - width - 12);
      const left = Math.min(Math.max(12, rect.left), maxLeft);
      const measuredHeight = optionsRef.current?.scrollHeight ?? 320;
      const below = Math.max(1, viewportHeight - rect.bottom - 12);
      const above = Math.max(1, rect.top - 12);
      const opensAbove = below < Math.min(measuredHeight, 320) && above > below;
      const maxHeight = opensAbove ? above : below;
      const top = opensAbove ? Math.max(12, rect.top - Math.min(measuredHeight, maxHeight) - 8) : rect.bottom + 8;
      setMenuPosition((previous) => previous?.top === top && previous.left === left && previous.width === width && previous.maxHeight === maxHeight ? previous : { top, left, width, maxHeight });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [floating, floatingMinWidth, open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  function openDropdown(): void {
    setActiveIndex(selectedIndex);
    setMenuPosition(null);
    setOpen(true);
  }

  function closeDropdown(): void {
    setOpen(false);
    setMenuPosition(null);
    triggerRef.current?.focus();
  }

  function selectOption(index: number): void {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    closeDropdown();
  }

  function focusOption(index: number): void {
    setActiveIndex(index);
    optionRefs.current[index]?.focus();
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (open || !["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    openDropdown();
  }

  function handleOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === "Tab") {
      setOpen(false);
      setMenuPosition(null);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeDropdown();
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = Math.min(options.length - 1, index + 1);
    if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex === null || nextIndex === index) return;
    event.preventDefault();
    focusOption(nextIndex);
  }

  const optionsMenu = open ? <div ref={optionsRef} className={`investment-dropdown-options${floating ? " investment-dropdown-options--floating" : ""}${numeric ? " investment-dropdown-options--numeric" : ""}`} id={listboxId} role="listbox" aria-label={ariaLabel ? `${ariaLabel} options` : undefined} aria-labelledby={ariaLabel ? undefined : ariaLabelledBy} style={floating ? { position: "fixed", top: menuPosition?.top ?? -10000, left: menuPosition?.left ?? 0, width: menuPosition?.width ?? `min(${Math.max(floatingMinWidth, 340)}px, calc(100vw - 24px))`, maxHeight: menuPosition?.maxHeight, visibility: menuPosition ? "visible" : "hidden" } : undefined}>
    {options.map((option, index) => <button key={option.value} ref={(element) => { optionRefs.current[index] = element; }} className={`investment-dropdown-option${activeIndex === index ? " is-active" : ""}`} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} onClick={() => selectOption(index)} onKeyDown={(event) => handleOptionKeyDown(event, index)} onMouseEnter={() => setActiveIndex(index)}>
      <span>{option.label}</span>
      {option.value === value ? <Check aria-hidden="true" size={17} strokeWidth={2.2} /> : null}
    </button>)}
  </div> : null;

  return <div className={rootClassName} ref={dropdownRef}>
    {name ? <input className="investment-dropdown-input" type="hidden" name={name} value={value} disabled={disabled} /> : null}
    <button ref={triggerRef} className="investment-dropdown-trigger" id={triggerId} type="button" role="combobox" onClick={() => open ? closeDropdown() : openDropdown()} onKeyDown={handleTriggerKeyDown} disabled={disabled || options.length === 0} aria-label={ariaLabel} aria-labelledby={triggerLabelledBy} aria-describedby={ariaDescribedBy} aria-invalid={ariaInvalid} aria-required={ariaRequired} aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId}>
      <span className="investment-dropdown-trigger-value" id={valueId}>{selectedOption?.label ?? "Select an option"}</span>
      <ChevronDown className="investment-dropdown-chevron" aria-hidden="true" size={18} strokeWidth={2} />
    </button>
    {floating && open && typeof document !== "undefined" ? createPortal(optionsMenu, document.body) : optionsMenu}
  </div>;
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { UserMenu } from "./user-menu";
import { mainNav, moreNav, NavIcon } from "./app-shell-nav";

export function AppMobileNav({ active, isAdmin, isDemo = false }: { readonly active: string; readonly isAdmin: boolean; readonly isDemo?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <nav className="mobile-nav">
      {mainNav.map((item) => (
        <Link href={item.href} key={item.label} className={item.label === active ? "active" : ""}>
          {item.short}
        </Link>
      ))}
      <button
        type="button"
        aria-label={open ? "Close navigation" : "More navigation"}
        aria-controls="mobile-more-menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="mobile-nav-more"
      >
        {open ? <X aria-hidden="true" size={20} strokeWidth={2} /> : <Menu aria-hidden="true" size={20} strokeWidth={2} />}
      </button>
      {open ? (
        <div id="mobile-more-menu" className="mobile-nav-menu">
          <div className="mobile-nav-menu-links">
            {moreNav.map((item) => (
              <Link
                href={item.href}
                key={item.label}
                className={`mobile-nav-menu-link ${item.label === active ? "active" : ""}`}
                onClick={() => setOpen(false)}
              >
                <span className="nav-icon">
                  <NavIcon icon={item.icon} />
                </span>
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
          <div className="mobile-nav-account-actions">
            <UserMenu isAdmin={isAdmin} isDemo={isDemo} />
          </div>
        </div>
      ) : null}
    </nav>
  );
}

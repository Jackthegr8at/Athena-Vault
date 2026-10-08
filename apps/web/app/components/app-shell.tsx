import Link from "next/link";
import Image from "next/image";
import { nav, NavIcon } from "./app-shell-nav";
import { NavSubLink } from "./app-shell-subnav-link";

export function AppSidebar({ active }: { readonly active: string }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <Link href="/" className="brand-link" aria-label="Athena Vault home">
          <Image className="brand-wordmark" src="/brand/athena-vault-wordmark.svg" alt="Athena Vault" width={220} height={59} draggable={false} />
          <Image className="brand-mark-img" src="/brand/athena-vault-mark.svg" alt="" aria-hidden="true" width={34} height={49} draggable={false} />
        </Link>
        <p className="brand-tagline">Private finance workspace</p>
      </div>
      <nav className="nav">
        <div className="nav-label">Workspace</div>
        {nav.map((item) => {
          const link = (
            <Link href={item.href} key={item.label} className={`nav-link ${item.label === "Settings" ? "nav-link-settings" : ""} ${item.label === active ? "active" : ""}`}>
              <span className="nav-icon">
                <NavIcon icon={item.icon} />
              </span>
              <span>{item.label}</span>
            </Link>
          );

          if (!item.children) return link;

          return (
            <div className="nav-group" key={item.label}>
              {link}
              <div className="nav-subnav" aria-label={`${item.label} sections`}>
                {item.children.map((child) => (
                  <NavSubLink href={child.href} label={child.label} key={child.label} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

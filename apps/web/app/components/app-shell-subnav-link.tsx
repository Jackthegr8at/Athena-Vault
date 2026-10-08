"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavSubLink({ href, label }: { readonly href: string; readonly label: string }) {
  const pathname = usePathname();
  const isActive = pathname === href;
  return <Link href={href} className={`nav-sublink ${isActive ? "active" : ""}`} aria-current={isActive ? "page" : undefined}>{label}</Link>;
}

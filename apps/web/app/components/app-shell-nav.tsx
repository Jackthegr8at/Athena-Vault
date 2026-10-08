import {
  ArrowLeftRight,
  CalendarDays,
  Calculator,
  FolderKanban,
  House,
  Landmark,
  LayoutDashboard,
  Settings,
  Target,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export const nav = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Accounts", href: "/accounts", icon: Landmark },
  {
    label: "Cash flow",
    href: "/cash-flow",
    icon: ArrowLeftRight,
    children: [{ label: "Recurring payments", href: "/cash-flow/recurring" }],
  },
  { label: "Annual expenses", href: "/annual-expenses", icon: CalendarDays },
  { label: "Home", href: "/home", icon: House },
  { label: "Salaries", href: "/salaries", icon: Wallet },
  { label: "Shared Expenses", href: "/shared-expenses", icon: FolderKanban },
  { label: "Workbooks", href: "/workbooks", icon: Calculator },
  { label: "Investments", href: "/investments", icon: TrendingUp },
  { label: "Goals", href: "/goals", icon: Target },
  { label: "Settings", href: "/settings", icon: Settings },
];

export const mainNav = [
  { label: "Overview", short: "Overview", href: "/" },
  { label: "Accounts", short: "Accounts", href: "/accounts" },
  { label: "Cash flow", short: "Cash", href: "/cash-flow" },
  { label: "Annual expenses", short: "Plan", href: "/annual-expenses" },
  { label: "Home", short: "Home", href: "/home" },
];

export const moreNav = nav.filter((item) => !mainNav.some((main) => main.label === item.label));

export function NavIcon({ icon: Icon }: { readonly icon: LucideIcon }) {
  return <Icon aria-hidden="true" size={18} strokeWidth={1.8} />;
}

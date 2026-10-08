import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./app-shell.css";
import "./custom-dropdown.css";
import "./animated-line-background.css";
import "./globals.css";
import { LocalWebVitals } from "./components/local-web-vitals";

export const metadata: Metadata = {
  title: "Athena Vault",
  description: "Private personal finance and projection workspace",
  icons: {
    icon: "/brand/athena-vault-small-head.png",
    shortcut: "/brand/athena-vault-small-head.png",
    apple: "/brand/athena-vault-small-head.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Next.js consumes the forwarded request nonce for its own inline bootstrap scripts.
  void nonce;

  return (
    <html lang="en">
      <body>{children}<LocalWebVitals /></body>
    </html>
  );
}

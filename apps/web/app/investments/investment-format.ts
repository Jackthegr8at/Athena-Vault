export type InvestmentCurrency = "CAD" | "USD" | "EUR";

function currencyPrefix(currency: InvestmentCurrency): string {
  if (currency === "USD") return "US$";
  if (currency === "EUR") return "€";
  return "$";
}

export function formatMoney(minor: number | null, currency: InvestmentCurrency): string {
  if (minor === null || !Number.isSafeInteger(minor)) return "Unavailable";
  const negative = minor < 0;
  const absolute = BigInt(negative ? -minor : minor);
  const whole = (absolute / 100n).toLocaleString("en-CA");
  const cents = String(absolute % 100n).padStart(2, "0");
  return `${negative ? "−" : ""}${currencyPrefix(currency)}${whole}.${cents}`;
}

import { ArrowDownRight, ArrowUpRight, TrendingUp } from "lucide-react";
import { AnimatedLineBackground } from "../components/animated-line-background";
import { formatMoneyMinor, formatSignedMoneyMinor } from "../../lib/format-money";

function dollars(minor: number): string {
  return formatMoneyMinor(minor);
}

function signedDollars(minor: number | null): string {
  return formatSignedMoneyMinor(minor, { unavailableLabel: "—" });
}

export interface AccountSelectedPeriodCardProps {
  readonly selectedTotalMinor: number;
  readonly liquidChangeMinor: number | null;
  readonly largestMovement: { readonly accountName: string; readonly deltaMinor: number } | null;
}

export function AccountSelectedPeriodCard({ selectedTotalMinor, liquidChangeMinor, largestMovement }: AccountSelectedPeriodCardProps) {
  const LargestMovementIcon = largestMovement && largestMovement.deltaMinor < 0 ? ArrowDownRight : ArrowUpRight;
  return <article className="account-selected-period-card" aria-label="Selected account period summary">
    <AnimatedLineBackground lineCount={11} opacity={0.32} speed={16} scale={1.08} strokeWidth={1.3} density={1.05} drift={0.28} waveAmplitude={42} pulseStrength={0.9} color="#9F9270" accentColor="#E0C681" seed="account-selected-period" className="animated-line-background--account-selected" />
    <div className="account-selected-period-total">
      <p className="eyebrow">Selected period total</p>
      <strong>{dollars(selectedTotalMinor)}</strong>
    </div>
    <div className="account-selected-period-metrics">
      <div className="account-selected-period-metric">
        <span className="account-selected-period-icon"><TrendingUp aria-hidden="true" size={20} strokeWidth={1.7} /></span>
        <div><small>Liquid accounts change</small><strong>{signedDollars(liquidChangeMinor)}</strong><span>vs prior period</span></div>
      </div>
      <div className="account-selected-period-metric">
        <span className="account-selected-period-icon"><LargestMovementIcon aria-hidden="true" size={20} strokeWidth={1.7} /></span>
        <div><small>Largest movement</small><strong>{largestMovement ? signedDollars(largestMovement.deltaMinor) : "—"}</strong><span>{largestMovement?.accountName ?? "No movement recorded"}</span></div>
      </div>
    </div>
  </article>;
}

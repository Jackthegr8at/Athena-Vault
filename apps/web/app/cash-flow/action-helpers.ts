export interface CashFlowActionState {
  readonly ok: boolean;
  readonly message: string;
}

export const initialCashFlowActionState: CashFlowActionState = { ok: false, message: "" };

export function focusIfConnected(target: { readonly isConnected: boolean; focus: () => void } | null): void {
  if (target?.isConnected) target.focus();
}

export function shouldCloseSuccessfulAction(
  previousState: CashFlowActionState,
  nextState: CashFlowActionState,
  pending: boolean,
  showMessage: boolean,
): boolean {
  return showMessage && !pending && nextState !== previousState && nextState.ok;
}

export function formDataText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

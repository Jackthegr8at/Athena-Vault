export type HouseholdExpenseActionField = "id" | "name" | "category" | "frequency" | "amount" | "accountId";

export interface HouseholdExpenseActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly fieldErrors: Partial<Record<HouseholdExpenseActionField, string>>;
}

export const initialHouseholdExpenseActionState: HouseholdExpenseActionState = {
  ok: false,
  message: "",
  fieldErrors: {},
};

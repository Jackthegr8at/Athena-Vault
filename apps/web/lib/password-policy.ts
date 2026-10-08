export const PASSWORD_POLICY_ERROR = "Password must contain 12-128 characters including at least one letter and one digit.";
export const PASSWORD_COMPROMISED_ERROR = "This password has appeared in a known data breach. Choose a different password.";
export const PASSWORD_BREACH_CHECK_UNAVAILABLE_ERROR = "We couldn't verify this password's security. Please try again.";

export function isPasswordPolicyValid(password: string): boolean {
  return password.length >= 12
    && password.length <= 128
    && /[A-Za-z]/.test(password)
    && /[0-9]/.test(password);
}

export function assertPasswordPolicy(password: string): void {
  if (!isPasswordPolicyValid(password)) throw new Error(PASSWORD_POLICY_ERROR);
}

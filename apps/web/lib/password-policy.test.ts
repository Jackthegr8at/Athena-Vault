import { describe, expect, it } from "vitest";
import { assertPasswordPolicy, PASSWORD_POLICY_ERROR } from "./password-policy";

describe("password policy", () => {
  it.each([
    ["too short", "A1short"],
    ["letters only", "a".repeat(12)],
    ["digits only", "1".repeat(12)],
    ["too long", `A1${"a".repeat(127)}`],
  ])("rejects %s passwords", (_label, password) => {
    expect(() => assertPasswordPolicy(password)).toThrow(PASSWORD_POLICY_ERROR);
  });

  it("accepts a 12-128 character password containing a letter and a digit", () => {
    expect(() => assertPasswordPolicy("correct horse1")).not.toThrow();
  });
});

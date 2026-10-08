import { describe, expect, it } from "vitest";
import { getDemoAccessCredentials, getDemoAccessPresentation } from "./demo-access";

describe("demo login presentation", () => {
  it("stays hidden unless demo access is explicitly enabled", () => {
    expect(getDemoAccessPresentation({
      ATHENA_DEMO_IDENTIFIER: "demo@example.test",
      ATHENA_DEMO_PASSWORD: "configured-placeholder",
    })).toBeNull();
    expect(getDemoAccessPresentation({
      ATHENA_DEMO_ENABLED: "false",
      ATHENA_DEMO_IDENTIFIER: "demo@example.test",
      ATHENA_DEMO_PASSWORD: "configured-placeholder",
    })).toBeNull();
  });

  it("requires both configured credential values", () => {
    expect(getDemoAccessPresentation({ ATHENA_DEMO_ENABLED: "true" })).toBeNull();
    expect(getDemoAccessPresentation({ ATHENA_DEMO_ENABLED: "true", ATHENA_DEMO_IDENTIFIER: "demo@example.test" })).toBeNull();
    expect(getDemoAccessPresentation({ ATHENA_DEMO_ENABLED: "true", ATHENA_DEMO_IDENTIFIER: " ", ATHENA_DEMO_PASSWORD: "configured-placeholder" })).toBeNull();
    expect(getDemoAccessPresentation({ ATHENA_DEMO_ENABLED: "true", ATHENA_DEMO_IDENTIFIER: "demo@example.test", ATHENA_DEMO_PASSWORD: " " })).toBeNull();
  });

  it("returns only the deployment-configured identifier to the page", () => {
    const environment = {
      ATHENA_DEMO_ENABLED: " TRUE ",
      ATHENA_DEMO_IDENTIFIER: " demo@example.test ",
      ATHENA_DEMO_PASSWORD: "configured-placeholder",
    };
    expect(getDemoAccessPresentation(environment)).toEqual({ identifier: "demo@example.test" });
    expect(getDemoAccessPresentation(environment)).not.toHaveProperty("password");
    expect(getDemoAccessCredentials(environment)).toEqual({ identifier: "demo@example.test", password: "configured-placeholder" });
  });
});

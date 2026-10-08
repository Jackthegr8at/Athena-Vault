import "./server-only";

export type DemoAccessPresentation = Readonly<{
  readonly identifier: string;
}>;

export type DemoAccessCredentials = Readonly<{
  readonly identifier: string;
  readonly password: string;
}>;

type DemoEnvironment = Readonly<Record<string, string | undefined>>;

function isExplicitlyEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function getDemoAccessCredentials(environment: DemoEnvironment = process.env): DemoAccessCredentials | null {
  if (!isExplicitlyEnabled(environment.ATHENA_DEMO_ENABLED)) return null;

  const identifier = environment.ATHENA_DEMO_IDENTIFIER?.trim();
  const password = environment.ATHENA_DEMO_PASSWORD;
  if (!identifier || !password || password.trim().length === 0) return null;

  return { identifier, password };
}

export function getDemoAccessPresentation(environment: DemoEnvironment = process.env): DemoAccessPresentation | null {
  const credentials = getDemoAccessCredentials(environment);
  return credentials ? { identifier: credentials.identifier } : null;
}

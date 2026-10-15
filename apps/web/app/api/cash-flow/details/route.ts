import { createCashFlowRepository } from "@athena/database";
import { UnauthenticatedError } from "../../../../lib/server/auth-session";
import { withAuthenticatedDatabase } from "../../../../lib/server/owner-database";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request): Promise<Response> {
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "recurring" && kind !== "excluded") return Response.json({ error: "Invalid detail kind." }, { status: 400, headers });
  try {
    const data = await withAuthenticatedDatabase(async (database, user) => {
      const repo = createCashFlowRepository(database);
      return kind === "recurring" ? repo.getRecurringEditorDetails(user.owner.id) : repo.listExcludedExpenses(user.owner.id);
    }, { requireTwoFactor: true });
    return Response.json({ data }, { headers });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT;")) {
      return Response.json({ error: "Additional authentication required." }, { status: 403, headers });
    }
    return Response.json({ error: error instanceof UnauthenticatedError ? "Authentication required." : "Details are unavailable." }, { status: error instanceof UnauthenticatedError ? 401 : 500, headers });
  }
}

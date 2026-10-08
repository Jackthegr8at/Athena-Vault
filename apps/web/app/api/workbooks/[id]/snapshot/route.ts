import { createCalculationWorkbooksRepository } from "@athena/database";
import { UnauthenticatedError } from "../../../../../lib/server/auth-session";
import { withAuthenticatedDatabase } from "../../../../../lib/server/owner-database";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: responseHeaders });
}

interface WorkbookSnapshotRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(_request: Request, context: WorkbookSnapshotRouteContext): Promise<Response> {
  const { id } = await context.params;
  try {
    const snapshot = await withAuthenticatedDatabase(async (database, user) => {
      const workbook = await createCalculationWorkbooksRepository(database).getById(user.owner.id, id);
      return workbook?.snapshot ?? null;
    }, { requireTwoFactor: true });
    if (snapshot === null) return jsonError("Workbook not found.", 404);
    return Response.json({ snapshot }, { status: 200, headers: responseHeaders });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonError("Authentication required.", 401);
    if (error instanceof RangeError) return jsonError("Workbook not found.", 404);
    throw error;
  }
}

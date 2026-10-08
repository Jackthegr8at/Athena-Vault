import { DATABASE_HEALTH_QUERY } from "@athena/database";
import { getServerDatabase } from "../../../lib/server/database";

export const dynamic = "force-dynamic";
const HEALTH_QUERY = DATABASE_HEALTH_QUERY;

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET(): Promise<Response> {
  try {
    await getServerDatabase().execute(HEALTH_QUERY);
    return Response.json({ status: "ok", database: "ok" }, { status: 200, headers: noStoreHeaders });
  } catch {
    return Response.json({ status: "error", database: "unavailable" }, { status: 503, headers: noStoreHeaders });
  }
}

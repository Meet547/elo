import { NextResponse } from "next/server";
import { db, dbEnabled } from "@/lib/db";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" } as const;
// Bump when a new application release requires another committed migration.
const REQUIRED_SCHEMA = '20261108100000_command_receipts';

/** Readiness includes database reachability and the required committed schema. */
export async function GET() {
  if (!dbEnabled) return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  try {
    const migrations = await db.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
    const ready = migrations.some(row => row.migration_name === REQUIRED_SCHEMA && row.finished_at && !row.rolled_back_at)
      && !migrations.some(row => !row.finished_at && !row.rolled_back_at);
    if (!ready) return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ ok: true, mode: "postgresql" }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
}

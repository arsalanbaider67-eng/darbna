import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import { connect, type Db } from "./db";

const DIR = join(import.meta.dir, "..", "migrations");

export async function migrate(db: Db, log = console.log): Promise<string[]> {
  await db`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  const done = new Set((await db`SELECT name FROM schema_migrations`).map((r: { name: string }) => r.name));
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(DIR, f), "utf8");
    await db.begin(async (tx) => {
      await tx.unsafe(sql);
      await tx`INSERT INTO schema_migrations (name) VALUES (${f})`;
    });
    log(`applied ${f}`);
    applied.push(f);
  }
  return applied;
}

if (import.meta.main) {
  const db = connect(loadConfig().databaseUrl);
  const applied = await migrate(db);
  console.log(applied.length ? `${applied.length} migration(s) applied` : "database up to date");
  await db.close();
}

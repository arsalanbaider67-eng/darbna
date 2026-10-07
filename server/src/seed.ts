import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arabicKey, destinationPoint, latinKey } from "@darbna/core";
import { loadConfig } from "./config";
import { connect, type Db } from "./db";

interface SeedPlace {
  key: string;
  kind: string;
  parent?: string;
  lat: number;
  lng: number;
  importance: number;
  names: { ar?: string; ckb?: string; en?: string; alias?: string[] };
}

/** Load the curated gazetteer. Idempotent: matches existing rows by external_ref. */
export async function seedGazetteer(db: Db): Promise<number> {
  const file = JSON.parse(readFileSync(join(import.meta.dir, "..", "seed", "gazetteer.seed.json"), "utf8")) as { places: SeedPlace[] };
  const ids = new Map<string, number>();
  for (const p of file.places) {
    const ref = `seed:${p.key}`;
    const [row] = await db`
      INSERT INTO places (kind, lat, lng, importance, quality, external_ref)
      VALUES (${p.kind}, ${p.lat}, ${p.lng}, ${p.importance}, 'seed_unverified', ${ref})
      ON CONFLICT DO NOTHING RETURNING id`;
    const id: number = row?.id ?? (await db`SELECT id FROM places WHERE external_ref = ${ref}`)[0].id;
    ids.set(p.key, Number(id));
    const names: [string, string, boolean][] = [];
    if (p.names.ar) names.push(["ar", p.names.ar, true]);
    if (p.names.ckb) names.push(["ckb", p.names.ckb, true]);
    if (p.names.en) names.push(["en", p.names.en, true]);
    for (const a of p.names.alias ?? []) names.push(["alias", a, false]);
    for (const [lang, name, primary] of names) {
      const ar = /[؀-ۿ]/.test(name) ? arabicKey(name) : null;
      const lat = /[a-zA-Z]/.test(name) ? latinKey(name) : null;
      await db`
        INSERT INTO place_names (place_id, lang, name, is_primary, ar_key, lat_key)
        VALUES (${id}, ${lang}, ${name}, ${primary}, ${ar}, ${lat})
        ON CONFLICT (place_id, lang, name) DO UPDATE SET ar_key = EXCLUDED.ar_key, lat_key = EXCLUDED.lat_key`;
    }
  }
  for (const p of file.places) {
    if (p.parent && ids.has(p.parent)) await db`UPDATE places SET parent_id = ${ids.get(p.parent)!} WHERE id = ${ids.get(p.key)!}`;
  }
  return file.places.length;
}

/**
 * DEMO reports around central Baghdad, flagged is_sample = true.
 * They are invisible unless the server runs with SAMPLE_DATA=on, and the app labels them "تجريبي / Sample".
 */
export async function seedDemoReports(db: Db): Promise<number> {
  await db`DELETE FROM reports WHERE is_sample`;
  const tahrir: [number, number] = [44.4140, 33.3337];
  const demo: [string, number, number, number][] = [
    ["congestion", 0, 400, 30],
    ["crash", 90, 900, 60],
    ["roadworks", 200, 1500, 4320],
    ["pothole", 300, 700, 20160],
    ["flooding", 45, 2200, 360],
  ];
  for (const [cat, brg, dist, ttl] of demo) {
    const [lng, lat] = destinationPoint(tahrir, brg, dist);
    await db`INSERT INTO reports (category, lat, lng, expires_at, is_sample, confirms)
             VALUES (${cat}, ${lat}, ${lng}, now() + make_interval(mins => ${ttl}), true, ${Math.floor(Math.random() * 3)})`;
  }
  return demo.length;
}

if (import.meta.main) {
  const what = process.argv[2];
  const db = connect(loadConfig().databaseUrl);
  if (what === "gazetteer") console.log(`seeded ${await seedGazetteer(db)} gazetteer places (quality=seed_unverified)`);
  else if (what === "demo") console.log(`seeded ${await seedDemoReports(db)} SAMPLE reports (is_sample=true)`);
  else console.log("usage: bun src/seed.ts gazetteer|demo");
  await db.close();
}

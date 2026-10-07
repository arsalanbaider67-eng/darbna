import { buildApp } from "./app";
import { loadConfig } from "./config";
import { connect } from "./db";
import { migrate } from "./migrate";
import { NominatimProvider } from "./providers/geocoding";
import { OsrmProvider, ValhallaProvider } from "./providers/routing";

const config = loadConfig();
const db = connect(config.databaseUrl);
if (process.env.MIGRATE_ON_START !== "false") await migrate(db);

const routing = config.routing.provider === "osrm"
  ? new OsrmProvider(config.routing.url, config.routing.timeoutMs)
  : new ValhallaProvider(config.routing.url, config.routing.timeoutMs);
const geocoder = new NominatimProvider(config.geocoding.url, config.geocoding.timeoutMs, config.geocoding.userAgent, config.geocoding.minIntervalMs);
const app = buildApp({ config, db, routing, geocoder });

const server = Bun.serve({
  port: config.port,
  fetch(req, srv) {
    const ip = (config.trustProxy ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined) ?? srv.requestIP(req)?.address ?? "unknown";
    return app.fetch(req, ip);
  },
});

const sweep = async () => {
  try {
    const r = await app.reports.sweep();
    if (r.expired || r.purged) console.log(JSON.stringify({ level: "info", sweep: r }));
  } catch (e) {
    console.error(JSON.stringify({ level: "error", sweep: (e as Error).message }));
  }
};
setInterval(sweep, 60_000);
void sweep();

console.log(JSON.stringify({ level: "info", msg: `Darbna API on :${server.port}`, routing: routing.name, sampleData: config.sampleData }));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    server.stop();
    await db.close();
    process.exit(0);
  });
}

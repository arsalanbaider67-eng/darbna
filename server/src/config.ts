function req(env: Record<string, string | undefined>, name: string, fallback?: string): string {
  const v = env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing required env var ${name}`);
  return v;
}
const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : ["1", "true", "on", "yes"].includes(v.toLowerCase()));
const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export interface Config {
  port: number;
  databaseUrl: string;
  /** Secret for HMAC-ing anonymous install IDs. Rotating it unlinks all past votes. */
  installHashSecret: string;
  adminToken: string;
  routing: { provider: "valhalla" | "osrm"; url: string; timeoutMs: number };
  geocoding: { provider: "nominatim"; url: string; timeoutMs: number; userAgent: string; minIntervalMs: number };
  map: { styleDay: string; styleNight: string; attribution: string; lighten: boolean };
  sampleData: boolean;
  corsOrigins: string[];
  trustProxy: boolean;
}

export function loadConfig(env = process.env): Config {
  const prod = env.NODE_ENV === "production";
  const secret = req(env, "INSTALL_HASH_SECRET", prod ? undefined : "dev-only-not-secret");
  if (prod && secret.length < 32) throw new Error("INSTALL_HASH_SECRET must be ≥ 32 chars in production");
  return {
    port: num(env.PORT, 8080),
    databaseUrl: req(env, "DATABASE_URL", prod ? undefined : "postgres://darbna:darbna@localhost:5432/darbna"),
    installHashSecret: secret,
    adminToken: req(env, "ADMIN_TOKEN", prod ? undefined : "dev-admin-token"),
    routing: {
      provider: (env.ROUTING_PROVIDER as "valhalla" | "osrm") ?? "valhalla",
      url: req(env, "ROUTING_URL", "http://localhost:8002"),
      timeoutMs: num(env.ROUTING_TIMEOUT_MS, 8000),
    },
    geocoding: {
      provider: "nominatim",
      url: req(env, "GEOCODER_URL", "http://localhost:8088"),
      timeoutMs: num(env.GEOCODER_TIMEOUT_MS, 4000),
      userAgent: env.GEOCODER_USER_AGENT ?? "Darbna/0.1 (self-hosted)",
      minIntervalMs: num(env.GEOCODER_MIN_INTERVAL_MS, 0),
    },
    map: {
      styleDay: req(env, "MAP_STYLE_DAY_URL", "http://localhost:8090/styles/darbna-day.json"),
      styleNight: req(env, "MAP_STYLE_NIGHT_URL", "http://localhost:8090/styles/darbna-night.json"),
      attribution: env.MAP_ATTRIBUTION ?? "© OpenStreetMap contributors",
      lighten: bool(env.MAP_STYLE_LIGHTEN, true),
    },
    sampleData: bool(env.SAMPLE_DATA, !prod),
    corsOrigins: (env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    trustProxy: bool(env.TRUST_PROXY, false),
  };
}

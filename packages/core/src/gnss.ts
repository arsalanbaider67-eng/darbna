/**
 * Satellite systems (GNSS) your phone's location chip can use, from the manufacturer's published
 * specifications. Phones combine every system they support automatically — the user doesn't pick
 * one — and iOS does not let apps see which satellites are in use right now, so this is the
 * published spec, not a live reading.
 *
 * iPhone data: Apple's tech-spec pages (Location section), checked 2026-10-18. Models whose page
 * we haven't checked are left out on purpose ("not published"), never guessed.
 */
export type GnssId = "gps" | "glonass" | "galileo" | "beidou" | "qzss" | "navic";

export interface GnssSystem {
  id: GnssId;
  name: string;
  /** ISO country/union code for the flag. */
  flag: "US" | "RU" | "EU" | "CN" | "JP" | "IN";
  /** Global, or regional (only helps near its home region). */
  coverage: "global" | "regional";
  /** Does it cover Iraq? Regional systems mostly don't. */
  overIraq: boolean;
}

export const GNSS_SYSTEMS: GnssSystem[] = [
  { id: "gps", name: "GPS", flag: "US", coverage: "global", overIraq: true },
  { id: "glonass", name: "GLONASS", flag: "RU", coverage: "global", overIraq: true },
  { id: "galileo", name: "Galileo", flag: "EU", coverage: "global", overIraq: true },
  { id: "beidou", name: "BeiDou", flag: "CN", coverage: "global", overIraq: true },
  { id: "qzss", name: "QZSS", flag: "JP", coverage: "regional", overIraq: false },
  { id: "navic", name: "NavIC", flag: "IN", coverage: "regional", overIraq: false },
];

export interface DeviceGnss {
  model: string;
  /** Apple publishes the list for this model. */
  published: boolean;
  systems: GnssId[];
  /** "Precision dual-frequency GPS" (L1 + L5): better accuracy between tall buildings. */
  dualFrequency: boolean;
  source?: string;
}

const FIVE: GnssId[] = ["gps", "glonass", "galileo", "qzss", "beidou"];
const SIX: GnssId[] = [...FIVE, "navic"];

// [model identifier(s), name, systems, dual-frequency, Apple tech-spec page]
const IPHONES: [string[], string, GnssId[], boolean, string][] = [
  [["iPhone13,2"], "iPhone 12", FIVE, false, "https://support.apple.com/111876"],
  [["iPhone14,7"], "iPhone 14", FIVE, false, "https://support.apple.com/111850"],
  [["iPhone15,2"], "iPhone 14 Pro", FIVE, true, "https://support.apple.com/111849"],
  [["iPhone15,4"], "iPhone 15", FIVE, false, "https://support.apple.com/111831"],
  [["iPhone16,1"], "iPhone 15 Pro", SIX, true, "https://support.apple.com/111829"],
  [["iPhone17,3"], "iPhone 16", FIVE, false, "https://support.apple.com/121029"],
  [["iPhone17,1"], "iPhone 16 Pro", SIX, true, "https://support.apple.com/121031"],
  [["iPhone17,5"], "iPhone 16e", SIX, false, "https://support.apple.com/122208"],
  [["iPhone18,3"], "iPhone 17", SIX, true, "https://support.apple.com/125089"],
  [["iPhone18,4"], "iPhone Air", SIX, true, "https://support.apple.com/125092"],
  [["iPhone18,1"], "iPhone 17 Pro", SIX, true, "https://support.apple.com/125090"],
  [["iPhone18,2"], "iPhone 17 Pro Max", SIX, true, "https://support.apple.com/125091"],
];

/** Same-generation siblings use the same location chip as the model whose page we checked. */
const SIBLINGS: Record<string, [string, string]> = {
  "iPhone13,1": ["iPhone 12 mini", "iPhone13,2"], "iPhone13,3": ["iPhone 12 Pro", "iPhone13,2"], "iPhone13,4": ["iPhone 12 Pro Max", "iPhone13,2"],
  "iPhone14,8": ["iPhone 14 Plus", "iPhone14,7"], "iPhone15,3": ["iPhone 14 Pro Max", "iPhone15,2"],
  "iPhone15,5": ["iPhone 15 Plus", "iPhone15,4"], "iPhone16,2": ["iPhone 15 Pro Max", "iPhone16,1"],
  "iPhone17,4": ["iPhone 16 Plus", "iPhone17,3"], "iPhone17,2": ["iPhone 16 Pro Max", "iPhone17,1"],
};

/** Names for models we know but whose GNSS list we haven't confirmed from Apple. */
const UNCONFIRMED: Record<string, string> = {
  "iPhone14,4": "iPhone 13 mini", "iPhone14,5": "iPhone 13", "iPhone14,2": "iPhone 13 Pro", "iPhone14,3": "iPhone 13 Pro Max",
  "iPhone14,6": "iPhone SE (3rd generation)", "iPhone18,5": "iPhone 17e",
};

/** What this phone supports. `modelId` is e.g. "iPhone16,1" (expo-device), `modelName` a fallback label. */
export function gnssForDevice(modelId: string | null | undefined, modelName?: string | null): DeviceGnss {
  const id = modelId ?? "";
  const sib = SIBLINGS[id];
  const row = IPHONES.find((r) => r[0].includes(sib ? sib[1] : id));
  if (row) return { model: sib ? sib[0] : row[1], published: true, systems: row[2], dualFrequency: row[3], source: row[4] };
  return { model: UNCONFIRMED[id] ?? modelName ?? id ?? "", published: false, systems: [], dualFrequency: false };
}

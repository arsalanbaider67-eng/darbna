// Runs with `bun test` (pure TS, no React Native needed).
import { describe, expect, it } from "bun:test";
import type { RouteStep } from "@darbna/core";
import { fmtDistance, fmtDuration, instructionText } from "../src/i18n";
import { ar } from "../src/i18n/ar";
import { ckb } from "../src/i18n/ckb";
import { en } from "../src/i18n/en";

function leaves(o: unknown, path = ""): [string, string][] {
  if (typeof o === "string") return [[path, o]];
  if (Array.isArray(o)) return o.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  return Object.entries(o as object).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("locale tables", () => {
  const A = new Map(leaves(ar));
  for (const [name, table] of [["ckb", ckb], ["en", en]] as const) {
    it(`${name} has the same keys and placeholders as ar`, () => {
      const T = new Map(leaves(table));
      expect([...T.keys()].sort()).toEqual([...A.keys()].sort());
      for (const [k, v] of T) expect(`${k}:${placeholders(v)}`).toBe(`${k}:${placeholders(A.get(k)!)}`);
    });
  }
  it("Arabic-script locales have no untranslated English strings", () => {
    const allowed = /^(GPS|0123|[\s{}\w·%✓✗()\-.:]*)$/;
    for (const [locale, table] of [["ar", ar], ["ckb", ckb]] as const) {
      for (const [k, v] of leaves(table)) {
        if (/[؀-ۿ]/.test(v) || allowed.test(v)) continue;
        throw new Error(`${locale}.${k} looks untranslated: ${v}`);
      }
    }
  });
});

describe("instructions", () => {
  const step = (p: Partial<RouteStep>): RouteStep => ({ index: 1, kind: "right", shapeIndex: 3, location: [44, 33], distanceM: 300, durationS: 30, ...p });
  const arW = { lang: "ar" as const, digits: "western" as const };
  it("Iraqi Arabic turn with street", () => {
    expect(instructionText(step({ streetName: "شارع فلسطين" }), 480, arW)).toBe("بعد 500 م، لف يمين على شارع فلسطين");
  });
  it("roundabout uses local term and ordinal", () => {
    expect(instructionText(step({ kind: "roundabout", roundaboutExit: 2 }), null, arW)).toBe("بالفلكة، اطلع من المخرج الثاني");
    expect(instructionText(step({ kind: "roundabout", roundaboutExit: 2 }), null, { lang: "en", digits: "western" })).toBe("At the roundabout, take the second exit");
  });
  it("spoken distances use words for units", () => {
    expect(instructionText(step({}), 1234, arW, true)).toBe("ورا 1.2 كيلومتر، لف يمين");
  });
  it("Arabic-Indic digits on screen when chosen", () => {
    expect(fmtDistance(1234, { lang: "ar", digits: "arabic" })).toBe("١٫٢ كم");
    expect(fmtDuration(3900, { lang: "ar", digits: "arabic" })).toBe("١ س ٥ د");
  });
  it("Kurdish uses Sorani strings", () => {
    expect(instructionText(step({}), null, { lang: "ckb", digits: "western" })).toBe("بەلای ڕاستدا بسوڕێوە");
  });
});

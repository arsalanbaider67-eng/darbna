import { describe, expect, it } from "bun:test";
import { arabicKey, latinKey, searchKeys } from "../src/normalize";
import { extendExpiry, reportConfidence, routingTreatment, shouldAutoHide } from "../src/reports";
import { localizeDigits, roundDistance } from "../src/format";

describe("Arabic normalization", () => {
  const same = (a: string, b: string) => expect(arabicKey(a)).toBe(arabicKey(b));
  it("folds hamza/alef, ta marbuta, alef maqsura, diacritics, tatweel, article", () => {
    same("الكاظمية", "كاظميه");
    same("الأعظمية", "الاعظميه");
    same("مُستشفى", "مستشفي");
    same("بغـــداد", "بغداد");
    same("إربيل", "اربيل");
    same("ساحة التحرير", "ساحه تحرير");
  });
  it("folds Kurdish/Persian letter forms and Eastern digits", () => {
    same("سلێمانی", "سليماني");
    same("کرکوک", "كركوك");
    expect(arabicKey("شارع ٦٢")).toBe(arabicKey("شارع 62"));
  });
});

describe("Latin transliteration skeleton", () => {
  const groups = [
    ["Kadhimiya", "Kazimiyah", "Al-Kadhimiyah", "al Kazimiya"],
    ["Baghdad", "Bagdad", "Baghdaad"],
    ["Karrada", "Karada", "Al-Karradah"],
    ["Mosul", "Mousel", "Mawsil"],
    ["Erbil", "Arbil", "Irbil"],
    ["Sulaymaniyah", "Sulaimaniya", "Slemani"],
    ["Basra", "Basrah", "Al-Basrah"],
    ["Adhamiya", "Azamiya", "Aadhamiyah"],
    ["Nasiriyah", "Nassiriya"],
    ["Mansour", "Mansur"],
    ["Iraq", "Irak"],
  ];
  for (const g of groups) {
    it(g.join(" / "), () => {
      const k = latinKey(g[0]);
      for (const v of g) expect(latinKey(v)).toBe(k);
    });
  }
  it("keeps different cities apart", () => {
    expect(latinKey("Najaf")).not.toBe(latinKey("Karbala"));
    expect(latinKey("Basra")).not.toBe(latinKey("Mosul"));
  });
  it("detects scripts", () => {
    expect(searchKeys("Karrada").arabic).toBeNull();
    expect(searchKeys("الكرادة").latin).toBeNull();
  });
});

describe("reports", () => {
  const t0 = new Date("2026-10-07T10:00:00Z");
  const exp = new Date("2026-10-07T11:00:00Z");
  it("confidence rises with confirms, falls with gone votes and age", () => {
    const base = reportConfidence("community", { confirms: 0, gone: 0 }, t0, exp, t0);
    const conf = reportConfidence("community", { confirms: 3, gone: 0 }, t0, exp, t0);
    const gone = reportConfidence("community", { confirms: 0, gone: 2 }, t0, exp, t0);
    const old = reportConfidence("community", { confirms: 0, gone: 0 }, t0, exp, new Date("2026-10-07T10:55:00Z"));
    expect(base).toBe(0.4);
    expect(conf).toBeGreaterThan(base);
    expect(gone).toBeLessThan(base);
    expect(old).toBeLessThan(base);
    expect(reportConfidence("official", { confirms: 0, gone: 5 }, t0, exp, t0)).toBe(1);
  });
  it("unverified reports never restrict routing", () => {
    expect(routingTreatment("closure", "community", 1)).toBe("advise");
    expect(routingTreatment("closure", "official", 1)).toBe("avoid");
    expect(routingTreatment("pothole", "community", 1)).toBe("display");
    expect(routingTreatment("crash", "community", 0.4)).toBe("display");
  });
  it("confirmation extends expiry up to the category cap", () => {
    const later = new Date("2026-10-07T10:50:00Z");
    const e = extendExpiry("congestion", t0, new Date("2026-10-07T10:30:00Z"), later);
    expect(e.toISOString()).toBe("2026-10-07T11:20:00.000Z");
    const capped = extendExpiry("congestion", t0, e, new Date("2026-10-07T11:55:00Z"));
    expect(capped.toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });
  it("auto-hides when gone votes clearly win", () => {
    expect(shouldAutoHide({ confirms: 0, gone: 1 })).toBe(false);
    expect(shouldAutoHide({ confirms: 0, gone: 2 })).toBe(true);
    expect(shouldAutoHide({ confirms: 3, gone: 4 })).toBe(false);
  });
});

describe("format", () => {
  it("rounds distances for speech", () => {
    expect(roundDistance(437)).toEqual({ value: 450, unit: "m" });
    expect(roundDistance(1234)).toEqual({ value: 1.2, unit: "km" });
    expect(roundDistance(23_600)).toEqual({ value: 24, unit: "km" });
  });
  it("renders Arabic-Indic digits", () => {
    expect(localizeDigits("1.2", "arabic")).toBe("١٫٢");
  });
});

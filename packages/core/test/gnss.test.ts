import { describe, expect, it } from "bun:test";
import { GNSS_SYSTEMS, gnssForDevice } from "../src/gnss";

describe("gnssForDevice (Apple published specs)", () => {
  it("iPhone 17 Pro: dual-frequency, six systems incl. NavIC", () => {
    const d = gnssForDevice("iPhone18,1");
    expect(d.model).toBe("iPhone 17 Pro");
    expect(d.dualFrequency).toBe(true);
    expect(d.systems).toContain("navic");
    expect(d.systems.length).toBe(6);
  });
  it("iPhone 15: five systems, no NavIC, single frequency", () => {
    const d = gnssForDevice("iPhone15,4");
    expect(d.systems).not.toContain("navic");
    expect(d.dualFrequency).toBe(false);
  });
  it("siblings share their generation's chip", () => {
    expect(gnssForDevice("iPhone16,2").model).toBe("iPhone 15 Pro Max");
    expect(gnssForDevice("iPhone16,2").systems).toContain("navic");
  });
  it("unchecked models are not guessed", () => {
    const d = gnssForDevice("iPhone14,5");
    expect(d.published).toBe(false);
    expect(d.systems).toEqual([]);
    expect(d.model).toBe("iPhone 13");
    expect(gnssForDevice(null, "Pixel 8").model).toBe("Pixel 8");
  });
  it("regional systems are marked as not covering Iraq", () => {
    expect(GNSS_SYSTEMS.filter((s) => !s.overIraq).map((s) => s.id)).toEqual(["qzss", "navic"]);
  });
});

import { expect, test } from "bun:test";
import { levelFor, normalizeRewardContact, rewardMilestones, rewardAtBucket } from "../src";

test("ten-level rewards have exact boundaries and continue beyond level 100", () => {
  expect(rewardMilestones(6499)).toEqual({ level: 9, reached: 0, next: 10 });
  expect(rewardMilestones(6500)).toEqual({ level: 10, reached: 10, next: 20 });
  expect(rewardMilestones(16500)).toEqual({ level: 20, reached: 20, next: 30 });
  expect(rewardMilestones(106500)).toEqual({ level: 110, reached: 110, next: 120 });
  expect(levelFor(NaN).level).toBe(1);
  expect(levelFor(-100).level).toBe(1);
});
test("reward contact normalization rejects unusable contacts and normalizes duplicate spellings", () => {
  expect(normalizeRewardContact("email", "  Person@Example.com ")).toBe("person@example.com");
  expect(normalizeRewardContact("email", "wrong")).toBeNull();
  expect(normalizeRewardContact("whatsapp", "+964 770-123-4567")).toBe("+9647701234567");
  expect(normalizeRewardContact("phone", "07701234567")).toBeNull();
  expect(normalizeRewardContact("telegram", "@Road_Helper")).toBe("@road_helper");
  expect(normalizeRewardContact("telegram", "https://t.me/example")).toBeNull();
});
test("all 20,000 draw positions award exactly the configured odds, without a no-prize slot", () => {
  const counts: Record<string,number> = {};
  for (let i = 0; i < 20000; i++) { const prize = rewardAtBucket(i); counts[prize] = (counts[prize] ?? 0) + 1; }
  expect(counts).toEqual({ voucher: 8000, oil_change: 100, car: 1, mobile_credit: 11899 });
  expect(rewardAtBucket(8099)).toBe("oil_change");
  expect(rewardAtBucket(8100)).toBe("car");
  expect(rewardAtBucket(8101)).toBe("mobile_credit");
  expect(() => rewardAtBucket(20000)).toThrow();
  expect(() => rewardAtBucket(-1)).toThrow();
});

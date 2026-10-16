import { expect, test } from "bun:test";
import { deliverGuidance } from "../src/nav/promptDelivery";

test("Arabic never falls back to a different device voice", async () => {
  let fallback = 0;
  for (const hasClips of [true, false]) {
    expect(await deliverGuidance("ar", hasClips, async () => false, async () => { fallback++; })).toBe(false);
  }
  expect(await deliverGuidance("ar", true, async () => { throw new Error("audio unavailable"); }, async () => { fallback++; })).toBe(false);
  expect(fallback).toBe(0);
});
test("successful recordings play and English retains its system fallback", async () => {
  let fallback = 0;
  expect(await deliverGuidance("ar", true, async () => true, async () => { fallback++; })).toBe(true);
  expect(fallback).toBe(0);
  expect(await deliverGuidance("en", false, async () => false, async () => { fallback++; })).toBe(true);
  expect(fallback).toBe(1);
});

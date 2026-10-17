import { expect, test } from "bun:test";
import { createCachedSearch, createRequestGate } from "../src/searchClient";

test("submitted searches wait for every provider's request slot", async () => {
  let clock = 1000;
  const gate = createRequestGate(1100, () => clock, async ms => { clock += ms; });
  const starts: number[] = [];
  await Promise.all([1, 2, 3].map(async () => { await gate(); starts.push(clock); }));
  expect(starts).toEqual([1000, 2100, 3200]);
});

test("repeat searches share the request and cache, while full search remains distinct from typing", async () => {
  let calls = 0, clock = 1000;
  const search = createCachedSearch(async () => { calls++; return { results: ["place"], partial: false }; }, () => clock);
  await Promise.all([search("airport", "ar", undefined, { remote: true }), search("airport", "ar", undefined, { remote: true })]);
  await search("airport", "ar", undefined, { remote: true });
  expect(calls).toBe(1);
  await search("airport", "ar", undefined, { remote: true, autocomplete: true });
  expect(calls).toBe(2);
  clock += 180001;
  await search("airport", "ar", undefined, { remote: true });
  expect(calls).toBe(3);
});

test("partial failures and errors are retried instead of cached as complete coverage", async () => {
  let calls = 0;
  const search = createCachedSearch(async () => { calls++; if (calls === 1) throw new Error("offline"); return { results: [], partial: true }; });
  await expect(search("x", "ar")).rejects.toThrow("offline");
  await search("x", "ar"); await search("x", "ar");
  expect(calls).toBe(3);
});

import { expect, it } from "bun:test";
import { deleteUserData, explicitTrafficConsent } from "../src/privacyControls";

it("old opt-out defaults do not become consent after upgrading", () => {
  expect(explicitTrafficConsent({ shareTraffic: true }).shareTraffic).toBe(false);
  expect(explicitTrafficConsent({ shareTraffic: true, trafficConsentVersion: 1 }).shareTraffic).toBe(true);
  expect(explicitTrafficConsent({ shareTraffic: false, trafficConsentVersion: 1 }).shareTraffic).toBe(false);
});

it("server deletion failure preserves the local identity for retry and never announces success", async () => {
  const calls: string[] = [];
  await expect(deleteUserData({
    stop: () => calls.push("stop"),
    removeRemote: async () => { calls.push("remote"); throw new Error("offline"); },
    wipeLocal: async () => { calls.push("wipe"); },
    finish: () => { calls.push("success"); },
  })).rejects.toThrow("offline");
  expect(calls).toEqual(["stop", "remote"]);
});

it("confirmed deletion stops sharing, removes remote data, then wipes locally", async () => {
  const calls: string[] = [];
  await deleteUserData({ stop: () => calls.push("stop"), removeRemote: async () => { calls.push("remote"); },
    wipeLocal: async () => { calls.push("wipe"); }, finish: () => { calls.push("success"); } });
  expect(calls).toEqual(["stop", "remote", "wipe", "success"]);
});

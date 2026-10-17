/** Old versions enabled contribution without an explicit opt-in. Do not carry that forward. */
export function explicitTrafficConsent<T extends { shareTraffic: boolean; trafficConsentVersion?: number }>(settings: T): Omit<T, "shareTraffic"> & { shareTraffic: boolean } {
  return settings.trafficConsentVersion === 1 ? settings : { ...settings, shareTraffic: false };
}

/** Keep the deletion identity until the server confirms deletion, so a failed request can be retried. */
export async function deleteUserData(actions: {
  stop(): void;
  removeRemote(): Promise<unknown>;
  wipeLocal(): Promise<void>;
  finish(): void;
}): Promise<void> {
  actions.stop();
  await actions.removeRemote();
  await actions.wipeLocal();
  actions.finish();
}

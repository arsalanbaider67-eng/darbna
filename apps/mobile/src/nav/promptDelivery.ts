/** Arabic guidance must never silently switch from the recorded Iraqi speaker to a
 * device-selected accent, gender or language when a clip cannot play.
 */
export async function deliverGuidance(recordedLang: "ar" | "en", hasClips: boolean, play: () => Promise<boolean>, systemFallback: () => Promise<void>): Promise<boolean> {
  if (hasClips && await play().catch(() => false)) return true;
  if (recordedLang === "ar") return false;
  await systemFallback();
  return true;
}

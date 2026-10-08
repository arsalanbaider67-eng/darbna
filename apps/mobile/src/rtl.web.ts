/** In the browser, layout direction is just the document's `dir` — no reload needed. */
export async function ensureDirection(rtl: boolean): Promise<void> {
  if (typeof document === "undefined") return;
  document.documentElement.dir = rtl ? "rtl" : "ltr";
  document.documentElement.lang = rtl ? "ar" : "en";
}

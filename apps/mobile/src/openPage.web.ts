/**
 * Web: open in a new tab/window so the app stays where it was. (Navigating the app's own window
 * — e.g. in the installed home-screen app — left people on the page with no way back.)
 */
export async function openPage(url: string): Promise<void> {
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) window.location.assign(url);
}

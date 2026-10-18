import * as WebBrowser from "expo-web-browser";

/**
 * Opens a web page (privacy policy, support, sources) inside the app with a "Done" button, so the
 * user comes straight back to Darbna (Safari View Controller on iPhone, Custom Tabs on Android).
 */
export async function openPage(url: string): Promise<void> {
  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    controlsColor: "#21194A",
    dismissButtonStyle: "close",
  });
}

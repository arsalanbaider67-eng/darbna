/** Yes/no confirmation in the browser (react-native-web's Alert is a no-op). */
export function confirmDialog(title: string, message: string, _ok: string, _cancel: string, _destructive = false): Promise<boolean> {
  return Promise.resolve(typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`));
}

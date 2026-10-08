import { Alert } from "react-native";

/** Yes/no confirmation. Native: system alert. (Web: see dialog.web.ts.) */
export function confirmDialog(title: string, message: string, ok: string, cancel: string, destructive = false): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancel, style: "cancel", onPress: () => resolve(false) },
      { text: ok, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) } as any);
  });
}

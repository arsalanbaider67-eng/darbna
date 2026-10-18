/**
 * How drivers reach Darbna support (prize claims, problems, abuse reports).
 * Email is fixed; phone and WhatsApp come from the build (GitHub variables SUPPORT_PHONE and
 * SUPPORT_WHATSAPP, international format like +9647701234567). Buttons without a value are hidden.
 */
import { Linking } from "react-native";

export const SUPPORT_EMAIL = "darbnaiq@gmail.com";
const clean = (v: string | undefined) => (v ?? "").replace(/[^\d+]/g, "");
export const SUPPORT_PHONE = clean(process.env.EXPO_PUBLIC_SUPPORT_PHONE);
export const SUPPORT_WHATSAPP = clean(process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP) || SUPPORT_PHONE;

export function contactWhatsApp(message: string): Promise<void> {
  return Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP.replace(/^\+/, "")}?text=${encodeURIComponent(message)}`);
}
export function contactPhone(): Promise<void> {
  return Linking.openURL(`tel:${SUPPORT_PHONE}`);
}
export function contactEmail(subject: string, body: string): Promise<void> {
  return Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
}

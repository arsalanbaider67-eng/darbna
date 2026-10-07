export type DigitStyle = "western" | "arabic";

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export function localizeDigits(s: string, style: DigitStyle): string {
  if (style === "western") return s;
  return s.replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]).replace(/\./g, "٫");
}

/** Rounds like a driver thinks: 50 m steps below 1 km, 0.1 km below 10 km, whole km above. */
export function roundDistance(m: number): { value: number; unit: "m" | "km" } {
  if (m < 50) return { value: Math.max(10, Math.round(m / 10) * 10), unit: "m" };
  if (m < 950) return { value: Math.round(m / 50) * 50, unit: "m" };
  if (m < 9950) return { value: Math.round(m / 100) / 10, unit: "km" };
  return { value: Math.round(m / 1000), unit: "km" };
}

/** Rounds a duration to whole minutes (min 1) and splits hours. */
export function splitDuration(s: number): { h: number; m: number } {
  const total = Math.max(1, Math.round(s / 60));
  return { h: Math.floor(total / 60), m: total % 60 };
}

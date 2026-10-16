import type { MapStyle } from "./style";

/** OpenMapTiles names in the driver's language, falling back to a real local name.
 * Leave shields and non-name text fields intact. Empty translated names must not hide a label.
 */
export function navigationStyle(style: MapStyle, lang: "ar" | "ckb" | "en"): MapStyle {
  const fields = lang === "ckb" ? ["name:ckb", "name:ku", "name:ar", "name", "name:latin"]
    : lang === "ar" ? ["name:ar", "name", "name:latin"] : ["name:en", "name:latin", "name"];
  // text-field has a formatted result type: null branches inside coalesce are rejected
  // by MapLibre. Return strings from every branch instead.
  const text = ["case", ...fields.flatMap(key => [
    ["!=", ["coalesce", ["get", key], ""], ""], ["to-string", ["get", key]],
  ]), ""];
  return { ...style, layers: style.layers.map(layer => {
    if (layer.type !== "symbol" || !layer.layout?.["text-field"]) return layer;
    const field = JSON.stringify(layer.layout["text-field"]);
    if (!/name/.test(field) || /ref|shield/.test(layer.id)) return layer;
    return { ...layer, layout: { ...layer.layout, "text-field": text }, paint: {
      ...layer.paint, "text-halo-width": 1.5, "text-halo-blur": 0.3,
    } };
  }) };
}

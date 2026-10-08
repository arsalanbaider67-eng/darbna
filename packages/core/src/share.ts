import { foldDigits } from "./normalize";
import type { LngLat } from "./geo";

export interface SharedLocation {
  coord: LngLat;
  label?: string;
}

const num = (s: string) => Number(foldDigits(s).replace("٫", "."));

function valid(lat: number, lng: number): LngLat | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
}

/**
 * Extract coordinates from things people actually share in Iraq: WhatsApp/Telegram
 * location messages (Google Maps links), geo: URIs, Darbna links, and plain "lat, lng" text.
 * Short links (maps.app.goo.gl) carry no coordinates and return null — the app tells
 * the user to share the full link or a pin instead of guessing.
 */
export function parseSharedLocation(input: string): SharedLocation | null {
  const text = foldDigits(input.trim()).replace(/٫/g, ".");

  // geo:33.31,44.36?q=33.31,44.36(Label)
  let m = text.match(/^geo:\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:[^?]*)?(?:\?(.*))?$/i);
  if (m) {
    const q = m[3] ? new URLSearchParams(m[3]).get("q") : null;
    const inner = q?.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:\s*\((.*)\))?/);
    if (inner) {
      const c = valid(num(inner[1]), num(inner[2]));
      if (c) return { coord: c, label: inner[3] || undefined };
    }
    const c = valid(num(m[1]), num(m[2]));
    if (c && !(c[0] === 0 && c[1] === 0)) return { coord: c };
  }

  // darbna://place?lat=..&lng=..&name=..
  m = text.match(/^darbna:\/\/place\?(.*)$/i);
  if (m) {
    const p = new URLSearchParams(m[1]);
    const c = valid(num(p.get("lat") ?? ""), num(p.get("lng") ?? ""));
    if (c) return { coord: c, label: p.get("name") ?? undefined };
  }

  // Darbna web links: https://…/darbna/?to=lat,lng&name=…
  m = text.match(/[?&]to=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i);
  if (m) {
    const c = valid(num(m[1]), num(m[2]));
    const qs = text.includes("?") ? new URLSearchParams(text.slice(text.indexOf("?") + 1).split("#")[0]) : null;
    if (c) return { coord: c, label: qs?.get("name") || undefined };
  }

  // Google Maps long links: ?q=lat,lng | /@lat,lng,zoom | !3dLAT!4dLNG | ll=lat,lng | query=lat,lng
  m = text.match(/[?&](?:q|ll|query|destination|daddr)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i)
    ?? text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
    ?? text.match(/\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) {
    const c = valid(num(m[1]), num(m[2]));
    if (c) return { coord: c };
  }

  // OpenStreetMap: #map=zoom/lat/lng or ?mlat=..&mlon=..
  m = text.match(/mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/) ?? text.match(/#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
  if (m) {
    const c = valid(num(m[1]), num(m[2]));
    if (c) return { coord: c };
  }

  // Plain "33.3152, 44.3661" (lat first, as people type it)
  m = text.match(/^(-?\d{1,2}\.\d{3,})\s*[,،\s]\s*(-?\d{1,3}\.\d{3,})$/);
  if (m) {
    const c = valid(num(m[1]), num(m[2]));
    if (c) return { coord: c };
  }
  return null;
}

/**
 * A link that opens a place in Darbna. `base` is the web app's address (works for anyone with a
 * browser); without it, a darbna:// link for the installed app.
 */
export function buildShareLink(coord: LngLat, name?: string, base?: string): string {
  const lat = coord[1].toFixed(6), lng = coord[0].toFixed(6);
  if (base) {
    const qs = new URLSearchParams({ to: `${lat},${lng}`, ...(name ? { name } : {}) });
    return `${base.replace(/[?#].*$/, "")}?${qs.toString().replace("%2C", ",")}`;
  }
  const qs = new URLSearchParams({ lat, lng, ...(name ? { name } : {}) });
  return `darbna://place?${qs}`;
}

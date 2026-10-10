#!/usr/bin/env python3
"""
Builds packages/core/data/sos-regions.json: the areas the SOS screen needs to tell apart.

  IQ-KR  Kurdistan Region of Iraq   — OpenStreetMap relation 5392650 (admin_level 3, ISO 3166-2 IQ-KR)
  IQ     Iraq (whole country)       — union of OSM's 18 Iraqi governorate relations (admin_level 4)
  TUR    Turkey                     — geoBoundaries gbOpen TUR ADM0 (simplified)

Inputs come from the "data-sources" branch (fetched by .github/workflows/fetch-sources.yml).
Rings are assembled from OSM ways, then simplified (Douglas–Peucker) with a small tolerance so
the app stays light; the tolerance is recorded and the app's boundary margin is far larger.

usage: build_sos_regions.py <data-sources/bounds dir> <output json>
"""
import json, math, sys
from collections import defaultdict

SRC, OUT = sys.argv[1], sys.argv[2]
TOL_M = 20.0  # simplification tolerance (metres)

def key(p): return (round(p[0], 7), round(p[1], 7))

def assemble(ways):
    """Join way polylines (lists of [lon,lat]) into closed rings."""
    ways = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while ways:
        ring = ways.pop()
        changed = True
        while key(ring[0]) != key(ring[-1]) and changed:
            changed = False
            for i, w in enumerate(ways):
                if key(w[0]) == key(ring[-1]): ring += w[1:]
                elif key(w[-1]) == key(ring[-1]): ring += w[::-1][1:]
                elif key(w[-1]) == key(ring[0]): ring = w[:-1] + ring
                elif key(w[0]) == key(ring[0]): ring = w[::-1][:-1] + ring
                else: continue
                ways.pop(i); changed = True; break
        if key(ring[0]) != key(ring[-1]):
            raise SystemExit(f"open ring left over ({len(ring)} pts) — boundary data incomplete")
        rings.append(ring)
    return rings

def rel_ways(rel, roles=("outer", "")):
    out = []
    for m in rel.get("members", []):
        if m.get("type") == "way" and m.get("role", "") in roles and m.get("geometry"):
            out.append((m["ref"], [[g["lon"], g["lat"]] for g in m["geometry"]]))
    return out

def to_m(p, lat0):
    return (p[0] * 111320 * math.cos(math.radians(lat0)), p[1] * 110574)

def dp(points, tol):
    if len(points) < 4: return points
    lat0 = points[0][1]
    pts = [to_m(p, lat0) for p in points]
    keep = [False] * len(points); keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best: best, bi = d, i
        if best > tol:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(points, keep) if k]

def simplify_ring(r, tol=None):
    tol = TOL_M if tol is None else tol
    # Split at the far point so DP works on a closed ring.
    far = max(range(len(r)), key=lambda i: (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2)
    a = dp(r[: far + 1], tol); b = dp(r[far:], tol)
    out = a[:-1] + b
    return [[round(x, 5), round(y, 5)] for x, y in out]

def area(r):
    return abs(sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1))) / 2

regions = {}

# Kurdistan Region (one relation)
kr = json.load(open(f"{SRC}/osm-kri.json"))["elements"][0]
outer = assemble([w for _, w in rel_ways(kr)])
inner = assemble([w for _, w in rel_ways(kr, ("inner",))]) if rel_ways(kr, ("inner",)) else []
regions["IQ-KR"] = {"outer": [simplify_ring(r) for r in outer], "inner": [simplify_ring(r) for r in inner],
                    "source": "OpenStreetMap relation 5392650 (ISO 3166-2 IQ-KR)", "license": "ODbL 1.0 — © OpenStreetMap contributors"}

# Iraq = union of the 18 governorates: ways shared by two governorates are internal borders.
govs = json.load(open(f"{SRC}/osm-irq-gov.json"))["elements"]
assert len(govs) == 18, f"expected 18 governorates, got {len(govs)}"
count, geom = defaultdict(int), {}
for g in govs:
    for wid, w in rel_ways(g):
        count[wid] += 1; geom[wid] = w
outer_iq = assemble([geom[w] for w, n in count.items() if n == 1])
outer_iq.sort(key=area, reverse=True)
regions["IQ"] = {"outer": [simplify_ring(r) for r in outer_iq], "inner": [],
                 "source": "Union of OpenStreetMap's 18 Iraqi governorate relations (admin_level 4)", "license": "ODbL 1.0 — © OpenStreetMap contributors"}

# Turkey (only countries with a verified emergency number need a shape)
tur = json.load(open(f"{SRC}/TUR-ADM0.simplified.geojson"))["features"][0]["geometry"]
polys = tur["coordinates"] if tur["type"] == "MultiPolygon" else [tur["coordinates"]]
# Coarser (300 m) and without small islands: only used to recognise "you are in Turkey".
big = [p[0] for p in polys if len(p[0]) > 3 and area(p[0]) > 0.002]
regions["TUR"] = {"outer": [simplify_ring(r, 300) for r in big], "inner": [], "toleranceM": 300,
                  "source": "geoBoundaries gbOpen TUR ADM0 (simplified)", "license": "geoBoundaries — see https://www.geoboundaries.org"}

out = {"version": 1, "built": __import__("datetime").date.today().isoformat(), "toleranceM": TOL_M, "regions": regions}
json.dump(out, open(OUT, "w"), separators=(",", ":"))
for k, v in regions.items():
    print(k, "rings", len(v["outer"]), "+", len(v["inner"]), "points", sum(len(r) for r in v["outer"] + v["inner"]))

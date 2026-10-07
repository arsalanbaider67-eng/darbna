#!/usr/bin/env bash
# Measure OpenStreetMap coverage for Iraq before committing to it as the data source.
# Needs osmium-tool (apt install osmium-tool). Downloads ~100–200 MB.
set -euo pipefail
PBF=${1:-iraq-latest.osm.pbf}
[ -f "$PBF" ] || curl -fLo "$PBF" https://download.geofabrik.de/asia/iraq-latest.osm.pbf

echo "== Drivable roads (ways) =="
osmium tags-filter -o /tmp/roads.pbf --overwrite "$PBF" \
  w/highway=motorway,trunk,primary,secondary,tertiary,unclassified,residential,service,living_street,motorway_link,trunk_link,primary_link,secondary_link
total=$(osmium fileinfo -e -g data.count.ways /tmp/roads.pbf)
echo "drivable ways: $total"

for tag in name name:ar name:ckb name:ku name:en oneway maxspeed; do
  n=$(osmium tags-filter -o /tmp/t.pbf --overwrite /tmp/roads.pbf "w/$tag" && osmium fileinfo -e -g data.count.ways /tmp/t.pbf)
  printf "%-10s %8s ways  (%s%%)\n" "$tag" "$n" "$(( 100 * n / total ))"
done

echo "== POIs with names (for search) =="
osmium tags-filter -o /tmp/poi.pbf --overwrite "$PBF" nwr/amenity nwr/shop nwr/tourism nwr/healthcare
echo "POIs: $(osmium fileinfo -e -g data.count.nodes /tmp/poi.pbf) nodes"
echo
echo "Then: run server/scripts/journey-check.ts against Valhalla, and have local drivers"
echo "compare 20+ routes per city with what they actually drive (one-ways, closed gates, checkpoints)."

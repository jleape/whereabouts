// Fetch non-residential polygons within the SF bbox from OpenStreetMap
// (Overpass API) and save them as a single GeoJSON FeatureCollection at
// pipeline/data/sf-exclusions.geojson.
//
// Categories excluded:
//   - parks / open space / nature reserves / golf courses / sports complexes
//   - protected areas (national_park, protected_area) — includes Presidio
//   - water (bay, lakes, wetlands, beaches)
//   - cemeteries, military land, industrial, rail yards, brownfield, quarry
//   - harbour, port, landfill, construction, forest
//   - hospital / university / college / school / prison campuses
//   - airports
//   - piers and breakwaters
//   - motorways / trunk roads (linear features, buffered to ~25m half-width)

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buffer, lineString } from '@turf/turf';
// @ts-expect-error — osmtogeojson ships JS only
import osmtogeojson from 'osmtogeojson';

const OUT_PATH = resolve(process.cwd(), 'pipeline/data/sf-exclusions.geojson');
const BBOX = '37.70,-122.52,37.84,-122.35';

// Polygon-based exclusions
const POLYGON_QUERY = `
[out:json][timeout:180];
(
  way["leisure"~"^(park|nature_reserve|golf_course|stadium|pitch|sports_centre|playground)$"](${BBOX});
  relation["leisure"~"^(park|nature_reserve|golf_course|stadium|pitch|sports_centre|playground)$"](${BBOX});
  way["boundary"~"^(national_park|protected_area|aboriginal_lands)$"](${BBOX});
  relation["boundary"~"^(national_park|protected_area|aboriginal_lands)$"](${BBOX});
  way["natural"~"^(water|wetland|beach|bare_rock|sand)$"](${BBOX});
  relation["natural"~"^(water|wetland|beach|bare_rock|sand)$"](${BBOX});
  way["landuse"~"^(cemetery|military|industrial|railway|brownfield|quarry|harbour|port|construction|landfill|forest|transportation)$"](${BBOX});
  relation["landuse"~"^(cemetery|military|industrial|railway|brownfield|quarry|harbour|port|construction|landfill|forest|transportation)$"](${BBOX});
  way["amenity"~"^(hospital|university|college|school|prison)$"](${BBOX});
  relation["amenity"~"^(hospital|university|college|school|prison)$"](${BBOX});
  way["aeroway"](${BBOX});
  relation["aeroway"](${BBOX});
  way["man_made"~"^(pier|breakwater)$"](${BBOX});
);
out body;
>;
out skel qt;
`.trim();

// Linear features (highways) — fetched separately, buffered after conversion.
const HIGHWAY_QUERY = `
[out:json][timeout:120];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link)$"](${BBOX});
);
out geom;
`.trim();

const HIGHWAY_BUFFER_METERS = 25;

async function overpass(query: string) {
  const body = new URLSearchParams({ data: query }).toString();
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'whereabouts-pipeline/0.1 (https://github.com/jleape/whereabouts)',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  console.log('Fetching polygon-based exclusions from Overpass…');
  const polyOsm = await overpass(POLYGON_QUERY);
  console.log(`  polygon elements: ${polyOsm.elements?.length ?? 0}`);
  const polyGeoJson = osmtogeojson(polyOsm);
  const polygons = polyGeoJson.features.filter(
    (f: any) =>
      f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon',
  );
  console.log(`  polygons: ${polygons.length}`);

  console.log('Fetching motorway/trunk ways from Overpass…');
  const hwyOsm = await overpass(HIGHWAY_QUERY);
  console.log(`  highway ways: ${hwyOsm.elements?.length ?? 0}`);
  const highwayPolygons: any[] = [];
  for (const el of hwyOsm.elements as any[]) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) {
      continue;
    }
    const coords = el.geometry.map((n: any) => [n.lon, n.lat]);
    try {
      const ls = lineString(coords);
      const buffered = buffer(ls, HIGHWAY_BUFFER_METERS, { units: 'meters' });
      if (buffered) highwayPolygons.push(buffered);
    } catch {
      // skip degenerate ways
    }
  }
  console.log(`  highway buffered polygons: ${highwayPolygons.length}`);

  const all = [...polygons, ...highwayPolygons];
  const out = { type: 'FeatureCollection', features: all };
  await mkdir(resolve(process.cwd(), 'pipeline/data'), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out));
  console.log(`Saved ${all.length} features to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

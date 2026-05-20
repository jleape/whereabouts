// Fetch all OSM buildings (as centroids) within the SF bbox via Overpass.
// Output: pipeline/data/sf-buildings.json — array of [lng, lat] pairs.
// Used by sample-data.ts to filter hex cells to only those containing a building.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT_PATH = resolve(process.cwd(), 'pipeline/data/sf-buildings.json');
const BBOX = '37.70,-122.52,37.84,-122.35';

const OVERPASS_QUERY = `
[out:json][timeout:300];
(
  way["building"](${BBOX});
  relation["building"](${BBOX});
);
out center;
`.trim();

async function main() {
  console.log('Fetching SF building centroids from Overpass…');
  const body = new URLSearchParams({ data: OVERPASS_QUERY }).toString();
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
  const osm = await res.json();
  console.log(`  elements: ${osm.elements?.length ?? 0}`);

  const centroids: [number, number][] = [];
  for (const el of osm.elements as any[]) {
    if (el.type === 'way' && typeof el.center?.lon === 'number') {
      centroids.push([el.center.lon, el.center.lat]);
    } else if (el.type === 'relation' && typeof el.center?.lon === 'number') {
      centroids.push([el.center.lon, el.center.lat]);
    } else if (typeof el.lon === 'number') {
      centroids.push([el.lon, el.lat]);
    }
  }
  console.log(`  centroids: ${centroids.length}`);

  await mkdir(resolve(process.cwd(), 'pipeline/data'), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(centroids));
  console.log(`Saved to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

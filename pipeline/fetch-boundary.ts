// Fetch the official San Francisco boundary polygon from OSM (relation 111968)
// via the Nominatim lookup endpoint, save as GeoJSON at
// pipeline/data/sf-boundary.geojson. Used by sample-data.ts to limit the
// candidate hex grid to actual SF land area.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT_PATH = resolve(process.cwd(), 'pipeline/data/sf-boundary.geojson');
const URL =
  'https://nominatim.openstreetmap.org/lookup?osm_ids=R111968&format=json&polygon_geojson=1';

async function main() {
  console.log('Fetching SF boundary from Nominatim…');
  const res = await fetch(URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'whereabouts-pipeline/0.1 (https://github.com/jleape/whereabouts)',
    },
  });
  if (!res.ok) {
    throw new Error(`Nominatim HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
  }
  const sf = data[0];
  if (!sf.geojson) {
    throw new Error('no geojson in response');
  }
  const fc = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name: sf.display_name ?? 'San Francisco',
          osm_id: sf.osm_id,
        },
        geometry: sf.geojson,
      },
    ],
  };
  await mkdir(resolve(process.cwd(), 'pipeline/data'), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(fc));
  console.log(`Saved ${sf.geojson.type} to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

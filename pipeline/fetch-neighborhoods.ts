// Fetch SF "Analysis Neighborhoods" (41 polygons) from DataSF and save a
// trimmed, simplified GeoJSON at public/data/sf/neighborhoods.geojson.
// The app uses it to label each destination with its neighborhood.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { simplify } from '@turf/turf';

const SRC = 'https://data.sfgov.org/resource/j2bu-swwd.geojson?$limit=100';
const OUT = resolve(process.cwd(), 'public/data/sf/neighborhoods.geojson');

async function main() {
  console.log('Fetching SF analysis neighborhoods…');
  const res = await fetch(SRC, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`DataSF HTTP ${res.status}`);
  const fc = await res.json();
  const features = (fc.features as any[])
    .filter((f) => f.geometry)
    .map((f) => {
      let geom = f.geometry;
      try {
        geom = (simplify(
          { type: 'Feature', properties: {}, geometry: f.geometry } as any,
          { tolerance: 0.0002, highQuality: false },
        ) as any).geometry;
      } catch {
        // keep the unsimplified geometry on failure
      }
      return {
        type: 'Feature',
        properties: { nhood: f.properties?.nhood ?? '' },
        geometry: geom,
      };
    });
  console.log(`  ${features.length} neighborhoods`);
  await mkdir(resolve(process.cwd(), 'public/data/sf'), { recursive: true });
  await writeFile(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
  console.log(`Saved to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

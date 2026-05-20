// Generate synthetic precomputed matrix data for SF at a chosen H3 resolution.
// A hex is excluded ONLY if its entire area falls inside an OSM exclusion
// polygon (parks, water, military, industrial, campus, etc.). Hexes that
// straddle a park edge are kept. Used for app development before the real
// r5py pipeline is run.

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  polygonToCellsExperimental,
  cellToLatLng,
  POLYGON_TO_CELLS_FLAGS,
} from 'h3-js';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';

const RESOLUTION = Number(process.env.RES ?? 9);
const OUT_DIR = resolve(process.cwd(), 'public/data/sf');
const EXCLUSIONS_PATH = resolve(process.cwd(), 'pipeline/data/sf-exclusions.geojson');

// SF bbox (city proper) — used only for the map's initial view.
const SF_BBOX: [number, number, number, number] = [
  -122.515, 37.708, -122.357, 37.835,
];

// Hand-traced SF land polygon following the actual shoreline. The official
// SF county boundary extends far into the bay/ocean, and OSM tags the bay as
// coastlines (not polygons), so neither alone works for trimming. This
// polygon hugs the land tight enough to drop pure-water hexes while still
// letting "any overlap" include coastal cells (Marina, Embarcadero, Sunset).
// Coordinates are [lat, lng], clockwise from the SW corner.
const SF_LAND_RINGS: number[][][] = [
  // Main SF peninsula
  [
    [37.708, -122.504], // Daly City coast (Ocean Beach south end)
    [37.708, -122.420], // Daly City inland border
    [37.708, -122.410], // Brisbane border
    [37.713, -122.398],
    [37.715, -122.385], // Candlestick Point
    [37.722, -122.378],
    [37.734, -122.366], // Hunters Point
    [37.745, -122.377],
    [37.752, -122.384],
    [37.762, -122.385], // India Basin / Mission Rock area
    [37.770, -122.384], // Mission Bay
    [37.779, -122.388], // Oracle Park
    [37.787, -122.387], // Bay Bridge approach
    [37.795, -122.391], // Embarcadero S
    [37.797, -122.393], // Ferry Building
    [37.806, -122.405], // Pier 39 / Telegraph Hill base
    [37.808, -122.420], // Aquatic Park / Fisherman's Wharf
    [37.806, -122.443], // Marina Green
    [37.804, -122.466], // Crissy Field
    [37.810, -122.477], // Fort Point (under GG Bridge)
    [37.802, -122.483], // Lincoln Park bluffs
    [37.793, -122.498], // Baker Beach
    [37.785, -122.513], // Land's End
    [37.778, -122.514], // Cliff House
    [37.770, -122.510], // Sutro Heights
    [37.750, -122.509], // Sunset coastline
    [37.728, -122.508], // Lake Merced coast
    [37.715, -122.505],
    [37.708, -122.504],
  ],
  // Treasure Island (man-made, part of SF) — tight polygon hugging the
  // actual shoreline. East edge sits at ~-122.362, not at -122.358 which
  // was leaving a strip of bay hexes east of the island.
  [
    [37.816, -122.376],
    [37.816, -122.363],
    [37.820, -122.361],
    [37.828, -122.361],
    [37.832, -122.367],
    [37.832, -122.374],
    [37.828, -122.376],
    [37.816, -122.376],
  ],
];

interface Series {
  id: string;
  mode: 'walk' | 'bike' | 'car' | 'transit';
  peak?: 'peak' | 'offpeak';
  allowBus?: boolean;
  kmh: number;
  baseMin: number;
}

const SERIES: Series[] = [
  { id: 'walk', mode: 'walk', kmh: 4.5, baseMin: 0 },
  { id: 'bike', mode: 'bike', kmh: 15, baseMin: 0 },
  { id: 'car', mode: 'car', kmh: 32, baseMin: 0 },
  { id: 'transit-bus-peak', mode: 'transit', peak: 'peak', allowBus: true, kmh: 16, baseMin: 6 },
  { id: 'transit-bus-offpeak', mode: 'transit', peak: 'offpeak', allowBus: true, kmh: 18, baseMin: 8 },
  { id: 'transit-rail-peak', mode: 'transit', peak: 'peak', allowBus: false, kmh: 28, baseMin: 7 },
  { id: 'transit-rail-offpeak', mode: 'transit', peak: 'offpeak', allowBus: false, kmh: 28, baseMin: 12 },
];

const DETOUR = 1.3;
const R_EARTH_KM = 6371;

function haversineKm(aLng: number, aLat: number, bLng: number, bLat: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R_EARTH_KM * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function loadExclusions(): Promise<Feature<Polygon | MultiPolygon>[]> {
  const raw = await readFile(EXCLUSIONS_PATH, 'utf-8');
  const fc = JSON.parse(raw) as FeatureCollection<Polygon | MultiPolygon>;
  return fc.features;
}


// Build the set of H3 cells whose entire area is contained inside any
// exclusion polygon. h3's containmentFull flag returns exactly those cells
// for each polygon ring; the union is the set we exclude.
function buildFullyExcludedSet(
  exclusions: Feature<Polygon | MultiPolygon>[],
  resolution: number,
): Set<string> {
  const excluded = new Set<string>();
  for (const feat of exclusions) {
    const geom = feat.geometry;
    const rings = ringsFor(geom);
    for (const ring of rings) {
      const latLngRing = ring.map(([lng, lat]) => [lat, lng]);
      // polygonToCellsExperimental wants [outer, ...holes] for each polygon.
      // We treat each outer ring independently (we don't bother with holes for
      // exclusion — including the hole area in the mask only over-excludes a
      // tiny bit, and underestimating exclusions is what we want anyway since
      // we already err on the side of keeping cells).
      const cells = polygonToCellsExperimental(
        [latLngRing],
        resolution,
        POLYGON_TO_CELLS_FLAGS.containmentFull,
      );
      for (const c of cells) excluded.add(c);
    }
  }
  return excluded;
}

function ringsFor(geom: Polygon | MultiPolygon): number[][][] {
  if (geom.type === 'Polygon') {
    // Use just the outer ring; ignoring holes makes the exclusion slightly
    // more conservative which is the safer direction here.
    return [geom.coordinates[0]];
  }
  return geom.coordinates.map((poly) => poly[0]);
}

async function main() {
  console.log(`Generating sample matrix at H3 res ${RESOLUTION}…`);

  // Use any-overlap with hand-traced SF land so coastal cells (Marina,
  // Embarcadero, Sunset) with a sliver of land are kept, but cells entirely
  // over the bay or ocean are dropped.
  const rawCellSet = new Set<string>();
  for (const ring of SF_LAND_RINGS) {
    const cells = polygonToCellsExperimental(
      [ring],
      RESOLUTION,
      POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
    );
    for (const c of cells) rawCellSet.add(c);
  }
  const rawCells = Array.from(rawCellSet);
  console.log(`  raw cells overlapping SF land: ${rawCells.length}`);

  const exclusions = await loadExclusions();
  console.log(`  exclusion polygons: ${exclusions.length}`);

  const fullyExcluded = buildFullyExcludedSet(exclusions, RESOLUTION);
  console.log(`  cells fully inside an exclusion polygon: ${fullyExcluded.size}`);

  const cells: string[] = [];
  const centroids: { h3: string; lng: number; lat: number }[] = [];
  for (const h3 of rawCells) {
    if (fullyExcluded.has(h3)) continue;
    const [lat, lng] = cellToLatLng(h3);
    cells.push(h3);
    centroids.push({ h3, lng, lat });
  }
  console.log(`  kept: ${cells.length}`);

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(resolve(OUT_DIR, 'm'), { recursive: true });

  const manifest = {
    city: 'san-francisco',
    resolution: RESOLUTION,
    cells,
    series: SERIES.map((s) => ({
      id: s.id,
      mode: s.mode,
      peak: s.peak,
      allowBus: s.allowBus,
    })),
    bbox: SF_BBOX,
    compression: 'gzip',
    generatedAt: new Date().toISOString(),
    notes: 'SYNTHETIC sample data — replace with r5py-generated matrices.',
  };
  await writeFile(
    resolve(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  const cellCount = centroids.length;
  const seriesCount = SERIES.length;
  const rawBytes = cellCount * seriesCount * 2; // uint16

  console.log(
    `Writing ${cellCount} destination files (${(rawBytes / 1024).toFixed(1)} KB raw each as uint16 seconds, gzipped)…`,
  );

  // Sentinel for unreachable (>= 65535 seconds, ~18 hours, is unrealistic).
  const UNREACHABLE = 0xffff;

  let totalCompressedBytes = 0;
  for (let di = 0; di < cellCount; di++) {
    const dest = centroids[di];
    const buf = new Uint16Array(seriesCount * cellCount);
    for (let si = 0; si < seriesCount; si++) {
      const series = SERIES[si];
      for (let oi = 0; oi < cellCount; oi++) {
        const origin = centroids[oi];
        const km = haversineKm(origin.lng, origin.lat, dest.lng, dest.lat) * DETOUR;
        const minutes = (km / series.kmh) * 60 + series.baseMin;
        const seconds = Math.round(minutes * 60);
        buf[si * cellCount + oi] =
          seconds >= UNREACHABLE ? UNREACHABLE : Math.max(0, seconds);
      }
    }
    const raw = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    const gz = gzipSync(raw, { level: 9 });
    totalCompressedBytes += gz.byteLength;
    await writeFile(resolve(OUT_DIR, 'm', `${dest.h3}.bin`), gz);
    if ((di + 1) % 200 === 0 || di === cellCount - 1) {
      const ratio = (totalCompressedBytes / (rawBytes * (di + 1))) * 100;
      process.stdout.write(
        `\r  ${di + 1}/${cellCount}   compressed ${(totalCompressedBytes / 1024 / 1024).toFixed(1)} MB (${ratio.toFixed(1)}% of raw)`,
      );
    }
  }
  process.stdout.write('\n');
  console.log(
    `Done. Total compressed: ${(totalCompressedBytes / 1024 / 1024).toFixed(1)} MB. Output at ${OUT_DIR}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

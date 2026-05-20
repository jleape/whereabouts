// Fetch all preset chain location sets and regenerate the preset index.
// Two data sources are supported per preset:
//   - 'overpass': OpenStreetMap features via the Overpass API
//   - 'datasf-schools': the authoritative DataSF schools dataset (7e7j-59qk),
//      filtered to public schools that serve a given grade band
//
// Output: public/data/sf/presets/<id>.json (one per preset) + index.json.
// To add a preset: append to PRESETS and rerun `npm run fetch-presets`.

import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const BBOX = '37.70,-122.52,37.84,-122.35';
const PRESETS_DIR = resolve(process.cwd(), 'public/data/sf/presets');
const DATASF_SCHOOLS_URL =
  'https://data.sfgov.org/resource/7e7j-59qk.json?$limit=2000';

type Mode = 'walk' | 'bike' | 'rail' | 'bus' | 'car';
type Peak = 'peak' | 'offpeak';
type SchoolLevel = 'elementary' | 'middle' | 'high';

interface OverpassSource {
  kind: 'overpass';
  filters: string[];
  requireName?: boolean;
  unnamedLabel?: string;
}

interface DataSfSchoolSource {
  kind: 'datasf-schools';
  level: SchoolLevel;
}

interface PresetConfig {
  id: string;
  name: string;
  emoji: string;
  defaults: { modes: Mode[]; peak: Peak; visitsPerWeek: number };
  source: OverpassSource | DataSfSchoolSource;
}

const PRESETS: PresetConfig[] = [
  {
    id: 'dog-parks',
    name: 'Dog Parks',
    emoji: '🐕',
    defaults: { modes: ['walk'], peak: 'offpeak', visitsPerWeek: 3 },
    source: {
      kind: 'overpass',
      filters: [
        'node["leisure"="dog_park"]',
        'way["leisure"="dog_park"]',
        'relation["leisure"="dog_park"]',
      ],
      unnamedLabel: 'Dog Park',
    },
  },
  {
    id: 'yoga-studios',
    name: 'Yoga Studios',
    emoji: '🧘',
    defaults: { modes: ['walk', 'bike'], peak: 'offpeak', visitsPerWeek: 2 },
    source: {
      kind: 'overpass',
      filters: [
        'node["sport"="yoga"]',
        'way["sport"="yoga"]',
        'node["leisure"="fitness_centre"]["sport"~"yoga"]',
        'way["leisure"="fitness_centre"]["sport"~"yoga"]',
      ],
      requireName: true,
    },
  },
  {
    id: 'pilates-studios',
    name: 'Pilates Studios',
    emoji: '🤸',
    defaults: { modes: ['walk', 'bike'], peak: 'offpeak', visitsPerWeek: 2 },
    source: {
      kind: 'overpass',
      filters: [
        'node["sport"="pilates"]',
        'way["sport"="pilates"]',
        'node["leisure"="fitness_centre"]["sport"~"pilates"]',
        'way["leisure"="fitness_centre"]["sport"~"pilates"]',
      ],
      requireName: true,
    },
  },
  {
    id: 'gyms',
    name: 'Gyms',
    emoji: '🏋️',
    defaults: { modes: ['walk', 'bike'], peak: 'offpeak', visitsPerWeek: 3 },
    source: {
      kind: 'overpass',
      filters: [
        'node["leisure"="fitness_centre"]',
        'way["leisure"="fitness_centre"]',
      ],
      requireName: true,
    },
  },
  {
    id: 'swimming-pools',
    name: 'Swimming Pools',
    emoji: '🏊',
    defaults: { modes: ['walk', 'bike', 'rail', 'bus'], peak: 'offpeak', visitsPerWeek: 2 },
    source: {
      kind: 'overpass',
      filters: [
        'node["leisure"="swimming_pool"]["access"!~"private|no"]',
        'way["leisure"="swimming_pool"]["access"!~"private|no"]',
        'node["leisure"="sports_centre"]["sport"~"swimming"]',
        'way["leisure"="sports_centre"]["sport"~"swimming"]',
      ],
      requireName: true,
    },
  },
  {
    id: 'grocery-stores',
    name: 'Grocery Stores',
    emoji: '🛒',
    defaults: { modes: ['walk', 'bike', 'car'], peak: 'offpeak', visitsPerWeek: 2 },
    source: {
      kind: 'overpass',
      filters: [
        'node["shop"="supermarket"]',
        'way["shop"="supermarket"]',
        'node["shop"="grocery"]',
        'way["shop"="grocery"]',
      ],
      requireName: true,
    },
  },
  {
    id: 'pharmacies',
    name: 'Pharmacies',
    emoji: '💊',
    defaults: { modes: ['walk', 'bike', 'car'], peak: 'offpeak', visitsPerWeek: 1 },
    source: {
      kind: 'overpass',
      filters: ['node["amenity"="pharmacy"]', 'way["amenity"="pharmacy"]'],
      requireName: true,
    },
  },
  {
    id: 'libraries',
    name: 'Public Libraries',
    emoji: '📚',
    defaults: { modes: ['walk', 'bike', 'rail', 'bus'], peak: 'offpeak', visitsPerWeek: 1 },
    source: {
      kind: 'overpass',
      filters: [
        'node["amenity"="library"]["operator"~"Public Library",i]',
        'way["amenity"="library"]["operator"~"Public Library",i]',
        'node["amenity"="library"]["operator:type"="public"]',
        'way["amenity"="library"]["operator:type"="public"]',
      ],
      requireName: true,
    },
  },
  {
    id: 'playgrounds',
    name: 'Playgrounds',
    emoji: '🛝',
    defaults: { modes: ['walk', 'bike'], peak: 'offpeak', visitsPerWeek: 3 },
    source: {
      kind: 'overpass',
      filters: ['node["leisure"="playground"]', 'way["leisure"="playground"]'],
      unnamedLabel: 'Playground',
    },
  },
  {
    id: 'farmers-markets',
    name: 'Farmers Markets',
    emoji: '🧺',
    defaults: { modes: ['walk', 'bike', 'car'], peak: 'offpeak', visitsPerWeek: 1 },
    source: {
      kind: 'overpass',
      filters: ['node["amenity"="marketplace"]', 'way["amenity"="marketplace"]'],
      requireName: true,
    },
  },
  {
    id: 'beaches',
    name: 'Beaches',
    emoji: '🏖️',
    defaults: { modes: ['walk', 'bike', 'car'], peak: 'offpeak', visitsPerWeek: 1 },
    source: {
      kind: 'overpass',
      filters: ['node["natural"="beach"]', 'way["natural"="beach"]'],
      unnamedLabel: 'Beach',
    },
  },
  {
    id: 'public-high-schools',
    name: 'Public High Schools',
    emoji: '🎓',
    defaults: { modes: ['walk', 'bike', 'rail', 'bus', 'car'], peak: 'peak', visitsPerWeek: 5 },
    source: { kind: 'datasf-schools', level: 'high' },
  },
  {
    id: 'public-middle-schools',
    name: 'Public Middle Schools',
    emoji: '🏫',
    defaults: { modes: ['walk', 'bike', 'rail', 'bus', 'car'], peak: 'peak', visitsPerWeek: 5 },
    source: { kind: 'datasf-schools', level: 'middle' },
  },
  {
    id: 'public-elementary-schools',
    name: 'Public Elementary Schools',
    emoji: '✏️',
    defaults: { modes: ['walk', 'bike', 'car'], peak: 'peak', visitsPerWeek: 5 },
    source: { kind: 'datasf-schools', level: 'elementary' },
  },
  {
    id: 'daycare',
    name: 'Daycare',
    emoji: '🧸',
    defaults: { modes: ['walk', 'bike', 'car'], peak: 'peak', visitsPerWeek: 5 },
    source: {
      kind: 'overpass',
      filters: [
        'node["amenity"="childcare"]',
        'way["amenity"="childcare"]',
        'node["amenity"="kindergarten"]',
        'way["amenity"="kindergarten"]',
      ],
      requireName: true,
    },
  },
];

interface PresetLocation {
  name: string;
  lng: number;
  lat: number;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Overpass source ---------------------------------------------------------

async function fetchOverpass(
  src: OverpassSource,
  presetName: string,
): Promise<PresetLocation[]> {
  const query = `
[out:json][timeout:120];
(
${src.filters.map((f) => `  ${f}(${BBOX});`).join('\n')}
);
out center;
`.trim();
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
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const osm = await res.json();
  const seen = new Set<string>();
  const out: PresetLocation[] = [];
  let unnamed = 0;
  for (const el of osm.elements as any[]) {
    let lng: number | undefined;
    let lat: number | undefined;
    if (el.type === 'node') {
      lng = el.lon;
      lat = el.lat;
    } else if (el.center) {
      lng = el.center.lon;
      lat = el.center.lat;
    }
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    const tagName: string | undefined = el.tags?.name;
    if (!tagName && src.requireName) continue;
    const name = tagName ?? `${src.unnamedLabel ?? presetName} ${++unnamed}`;
    const key = `${name}|${lng.toFixed(4)}|${lat.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, lng, lat });
  }
  return out;
}

// --- DataSF schools source ---------------------------------------------------

let dataSfSchoolsCache: any[] | null = null;

async function loadDataSfSchools(): Promise<any[]> {
  if (dataSfSchoolsCache) return dataSfSchoolsCache;
  const res = await fetch(DATASF_SCHOOLS_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`DataSF HTTP ${res.status}`);
  dataSfSchoolsCache = (await res.json()) as any[];
  return dataSfSchoolsCache;
}

// Grade tokens → numbers. 'P'/'PK' = preschool (-1), 'K' = 0, '1'..'12' = 1..12.
function gradeNum(g: unknown): number {
  if (typeof g !== 'string') return NaN;
  const t = g.trim().toUpperCase();
  if (t === 'P' || t === 'PK') return -1;
  if (t === 'K') return 0;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? NaN : n;
}

const LEVEL_BANDS: Record<SchoolLevel, [number, number]> = {
  elementary: [1, 5],
  middle: [6, 8],
  high: [9, 12],
};

function isPublic(v: unknown): boolean {
  return v === true || v === 'true' || v === 'True';
}

async function fetchDataSfSchools(src: DataSfSchoolSource): Promise<PresetLocation[]> {
  const all = await loadDataSfSchools();
  const [bandLo, bandHi] = LEVEL_BANDS[src.level];
  const out: PresetLocation[] = [];
  for (const r of all) {
    if (r.record_type && r.record_type !== 'School') continue;
    if (r.status && r.status !== 'Active') continue;
    if (!isPublic(r.public_yesno)) continue;
    const lo = gradeNum(r.low_grade);
    const hi = gradeNum(r.high_grade);
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    // School serves this band if its grade range overlaps the band.
    if (lo > bandHi || hi < bandLo) continue;
    const coords = r.point?.coordinates as [number, number] | undefined;
    const lng = coords ? coords[0] : parseFloat(r.longitude);
    const lat = coords ? coords[1] : parseFloat(r.latitude);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    out.push({ name: r.school ?? 'School', lng, lat });
  }
  return out;
}

// --- main --------------------------------------------------------------------

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// By default only fetch presets that don't already have a data file (so adding
// one new preset doesn't re-hit Overpass for all the others). Pass `--force`
// to re-fetch everything, or `--only=<id>,<id>` to refresh specific presets.
async function main() {
  await mkdir(PRESETS_DIR, { recursive: true });
  const force = process.argv.includes('--force');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
  const indexEntries: any[] = [];

  for (const cfg of PRESETS) {
    const dataPath = resolve(PRESETS_DIR, `${cfg.id}.json`);
    const cached = await fileExists(dataPath);
    const shouldFetch = force || (only ? only.has(cfg.id) : !cached);

    if (!shouldFetch) {
      if (cached) {
        console.log(`${cfg.name}: cached`);
      } else {
        console.log(`${cfg.name}: no data — run with --only=${cfg.id}`);
        continue;
      }
    } else {
      process.stdout.write(`Fetching ${cfg.name}… `);
      let locations: PresetLocation[] | null = null;
      try {
        locations =
          cfg.source.kind === 'overpass'
            ? await fetchOverpass(cfg.source, cfg.name)
            : await fetchDataSfSchools(cfg.source);
      } catch (err) {
        console.log(`FAILED: ${(err as Error).message}`);
      }
      if (locations) {
        console.log(`${locations.length} locations`);
        await writeFile(dataPath, JSON.stringify({ locations }, null, 2));
      } else if (cached) {
        console.log(`  → keeping cached ${cfg.id}.json`);
      } else {
        console.log(`  → skipped (no cached data)`);
        continue;
      }
      if (cfg.source.kind === 'overpass') await sleep(1500);
    }

    indexEntries.push({
      id: cfg.id,
      name: cfg.name,
      emoji: cfg.emoji,
      dataFile: `${cfg.id}.json`,
      defaults: cfg.defaults,
    });
  }

  await writeFile(
    resolve(PRESETS_DIR, 'index.json'),
    JSON.stringify(indexEntries, null, 2),
  );
  console.log(`\nWrote index.json with ${indexEntries.length} presets.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

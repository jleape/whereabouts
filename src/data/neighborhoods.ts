import { booleanPointInPolygon, point } from '@turf/turf';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

// SF "Analysis Neighborhoods" — used to label destinations with a neighborhood.
let features: Feature<Polygon | MultiPolygon>[] = [];

export async function loadNeighborhoods(baseUrl = '/data/sf'): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/neighborhoods.geojson`);
    if (!res.ok) return;
    const fc = (await res.json()) as FeatureCollection<Polygon | MultiPolygon>;
    features = fc.features;
  } catch {
    // Neighborhood labels are optional — leave the list empty on failure.
  }
}

// Returns the SF neighborhood containing (lng, lat), or '' if none / not loaded.
export function neighborhoodAt(lng: number, lat: number): string {
  if (features.length === 0) return '';
  const pt = point([lng, lat]);
  for (const f of features) {
    try {
      if (booleanPointInPolygon(pt, f)) {
        return String(f.properties?.nhood ?? '');
      }
    } catch {
      // skip malformed geometry
    }
  }
  return '';
}

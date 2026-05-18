import { polygonToCells, cellToLatLng } from 'h3-js';
import { haversineKm } from './travel';

export interface HexCell {
  h3: string;
  lng: number;
  lat: number;
}

// Average area of an H3 cell at each resolution (km²)
const H3_AREA_KM2: Record<number, number> = {
  6: 36.13,
  7: 5.1613,
  8: 0.7373,
  9: 0.1053,
  10: 0.01504,
  11: 0.002149,
  12: 0.000307,
};

export function bboxAreaKm2(
  bbox: [number, number, number, number],
): number {
  const [west, south, east, north] = bbox;
  const midLat = (south + north) / 2;
  const widthKm = haversineKm(west, midLat, east, midLat);
  const heightKm = haversineKm(west, south, west, north);
  return widthKm * heightKm;
}

// Pick the H3 resolution whose cell size yields ~targetCount hexes for the bbox.
// Clamped to [7, 11] so we always produce a sane grid.
export function pickResolution(
  areaKm2: number,
  targetCount = 1200,
): number {
  if (areaKm2 <= 0) return 9;
  const targetCellArea = areaKm2 / targetCount;
  let best = 9;
  let bestDiff = Infinity;
  for (const rStr of Object.keys(H3_AREA_KM2)) {
    const r = Number(rStr);
    const a = H3_AREA_KM2[r];
    const d = Math.abs(Math.log(a) - Math.log(targetCellArea));
    if (d < bestDiff) {
      bestDiff = d;
      best = r;
    }
  }
  return Math.max(7, Math.min(11, best));
}

export function estimateHexCount(
  areaKm2: number,
  resolution: number,
): number {
  return Math.round(areaKm2 / H3_AREA_KM2[resolution]);
}

export function bboxToHexCells(
  bbox: [number, number, number, number],
  resolution: number,
): HexCell[] {
  const [west, south, east, north] = bbox;
  // h3-js expects [lat, lng] polygon coordinates in GeoJSON ring order
  const polygon: number[][][] = [
    [
      [south, west],
      [south, east],
      [north, east],
      [north, west],
      [south, west],
    ],
  ];
  const cells = polygonToCells(polygon, resolution);
  return cells.map((h3) => {
    const [lat, lng] = cellToLatLng(h3);
    return { h3, lng, lat };
  });
}

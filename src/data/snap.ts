import { latLngToCell, cellToLatLng } from 'h3-js';
import type { LoadedMatrix } from './matrix';

export interface SnappedCell {
  h3: string;
  index: number;
  lng: number;
  lat: number;
}

// Snap an arbitrary lng/lat to the nearest hex centroid in the loaded grid.
// Returns null if the point lands outside the precomputed grid.
export function snapToGrid(
  matrix: LoadedMatrix,
  lng: number,
  lat: number,
): SnappedCell | null {
  const h3 = latLngToCell(lat, lng, matrix.manifest.resolution);
  const idx = matrix.cellIndex.get(h3);
  if (idx !== undefined) {
    const [cLat, cLng] = cellToLatLng(h3);
    return { h3, index: idx, lng: cLng, lat: cLat };
  }
  // Outside the grid — find the closest cell by centroid distance as a fallback.
  let best: SnappedCell | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < matrix.manifest.cells.length; i++) {
    const cellH3 = matrix.manifest.cells[i];
    const [cLat, cLng] = cellToLatLng(cellH3);
    const dLat = cLat - lat;
    const dLng = cLng - lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDist) {
      bestDist = d;
      best = { h3: cellH3, index: i, lng: cLng, lat: cLat };
    }
  }
  return best;
}

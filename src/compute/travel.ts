import type { TravelMode, PeakPeriod } from '../state/types';

// Mode average speeds in km/h (door-to-door, including small overhead for transit waits)
export const MODE_SPEED_KMH: Record<TravelMode, number> = {
  walk: 4.5,
  bike: 15,
  transit: 18,
  car: 32,
};

// Multiplier on time during peak periods (rush hour congestion).
// Walking unaffected; biking marginally slower; transit and car significantly slower.
export const PEAK_MULT: Record<TravelMode, number> = {
  walk: 1.0,
  bike: 1.05,
  transit: 1.2,
  car: 1.5,
};

// Multiplier to convert straight-line distance to network distance
// (rough heuristic — refined later by OSRM matrix calls)
export const DETOUR_FACTOR = 1.3;

// Fixed transit overhead (wait + transfer) in minutes added when the mode is transit
export const TRANSIT_OVERHEAD_MIN = 5;

const R_EARTH_KM = 6371;

export function haversineKm(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R_EARTH_KM * c;
}

// Straight-line travel time estimate in minutes, with peak multiplier and detour factor
export function estimateMinutes(
  originLng: number,
  originLat: number,
  destLng: number,
  destLat: number,
  mode: TravelMode,
  peak: PeakPeriod,
): number {
  const km = haversineKm(originLng, originLat, destLng, destLat) * DETOUR_FACTOR;
  const baseMin = (km / MODE_SPEED_KMH[mode]) * 60;
  const withPeak = peak === 'peak' ? baseMin * PEAK_MULT[mode] : baseMin;
  return mode === 'transit' ? withPeak + TRANSIT_OVERHEAD_MIN : withPeak;
}

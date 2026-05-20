export type TravelMode = 'walk' | 'bike' | 'rail' | 'bus' | 'car';

export const ALL_MODES: TravelMode[] = ['walk', 'bike', 'rail', 'bus', 'car'];

export const MODE_LABEL: Record<TravelMode, string> = {
  walk: 'Walk',
  bike: 'Bike',
  rail: 'Rail',
  bus: 'Bus',
  car: 'Car',
};

export const MODE_EMOJI: Record<TravelMode, string> = {
  walk: '🚶',
  bike: '🚲',
  rail: '🚊',
  bus: '🚌',
  car: '🚗',
};

export type PeakPeriod = 'peak' | 'offpeak';

export interface Destination {
  id: string;
  name: string;
  lng: number;
  lat: number;
  visitsPerWeek: number;
  modes: TravelMode[];
  peak: PeakPeriod;
  chainId: string | null;
  // Filled in when the destination is saved — h3 cell + centroid coords
  // of the precomputed grid this destination snapped to.
  snappedH3?: string;
  snappedLng?: number;
  snappedLat?: number;
}

// A chain groups multiple locations the user treats as interchangeable
// (they go to whichever is nearest). Travel settings live on the chain and
// apply uniformly to every member — there is no per-destination override.
export interface Chain {
  id: string;
  name: string;
  emoji: string;
  modes: TravelMode[];
  peak: PeakPeriod;
  visitsPerWeek: number;
}

export interface City {
  name: string;
  displayName: string;
  bbox: [number, number, number, number]; // [west, south, east, north]
  center: [number, number]; // [lng, lat]
}

export interface HexScore {
  h3: string;
  // total weekly minutes (round trip-weighted by visits)
  weeklyMinutes: number;
}

export interface ArcInfo {
  fromLng: number;
  fromLat: number;
  toLng: number;
  toLat: number;
  destName: string;
  minutes: number;
  mode: TravelMode;
}

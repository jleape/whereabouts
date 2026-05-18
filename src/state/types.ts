export type TravelMode = 'walk' | 'bike' | 'transit' | 'car';

export const ALL_MODES: TravelMode[] = ['walk', 'bike', 'transit', 'car'];

export const MODE_LABEL: Record<TravelMode, string> = {
  walk: 'Walk',
  bike: 'Bike',
  transit: 'Transit',
  car: 'Car',
};

export const MODE_EMOJI: Record<TravelMode, string> = {
  walk: '🚶',
  bike: '🚲',
  transit: '🚌',
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
}

export interface Chain {
  id: string;
  name: string;
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

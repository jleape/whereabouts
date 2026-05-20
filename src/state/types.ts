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
  groupId: string | null;
  // Marker emoji. For grouped destinations the group's emoji is used instead;
  // for standalone destinations this is set from the chosen destination type.
  emoji: string;
  // Filled in when the destination is saved — h3 cell + centroid coords
  // of the precomputed grid this destination snapped to.
  snappedH3?: string;
  snappedLng?: number;
  snappedLat?: number;
}

// Common destination types offered as radio options for standalone
// destinations. The chosen type sets the destination's marker emoji.
export interface DestinationType {
  id: string;
  label: string;
  emoji: string;
}

export const DESTINATION_TYPES: DestinationType[] = [
  { id: 'office', label: 'Office', emoji: '🏢' },
  { id: 'school', label: 'School', emoji: '🏫' },
  { id: 'so', label: 'SO', emoji: '❤️' },
  { id: 'bff', label: "BFF's", emoji: '👯' },
  { id: 'family', label: 'Family', emoji: '🧬' },
  { id: 'other', label: 'Other', emoji: '📍' },
];

// A group groups multiple locations the user treats as interchangeable
// (they go to whichever is nearest). Travel settings live on the group and
// apply uniformly to every member — there is no per-destination override.
export interface Group {
  id: string;
  name: string;
  emoji: string;
  modes: TravelMode[];
  peak: PeakPeriod;
  visitsPerWeek: number;
  // Polygon destinations (large parks, beaches): outer rings as [lng,lat][].
  // When set, the group is drawn as a filled shape and its member locations
  // are the grid cells ringing the polygon (travel time = time to the edge).
  polygon?: number[][][];
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
  toId: string; // id of the winning (nearest) destination this arc points to
  destName: string;
  minutes: number;
  mode: TravelMode;
}

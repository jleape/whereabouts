import type { City } from '../state/types';

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string]; // [south, north, west, east]
  name?: string;
  type?: string;
  class?: string;
}

export async function searchCity(query: string): Promise<City | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');
  url.searchParams.set('featuretype', 'city');
  url.searchParams.set('addressdetails', '0');

  const res = await fetch(url.toString(), {
    headers: { 'Accept-Language': 'en' },
  });
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const data: NominatimResult[] = await res.json();
  if (!data.length) return null;

  // Prefer results whose class/type look like a place
  const preferred =
    data.find(
      (d) =>
        d.class === 'place' ||
        d.class === 'boundary' ||
        d.type === 'city' ||
        d.type === 'administrative' ||
        d.type === 'town',
    ) ?? data[0];

  const [south, north, west, east] = preferred.boundingbox.map(parseFloat);
  return {
    name: preferred.name ?? query,
    displayName: preferred.display_name,
    bbox: [west, south, east, north],
    center: [parseFloat(preferred.lon), parseFloat(preferred.lat)],
  };
}

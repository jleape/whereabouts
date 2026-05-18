import { MapboxOverlay } from '@deck.gl/mapbox';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { ArcLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type maplibregl from 'maplibre-gl';
import { store } from '../state/store';
import type { ArcInfo, Destination, HexScore } from '../state/types';
import { MODE_EMOJI } from '../state/types';
import { computeArcs } from '../compute/score';
import { quantileScale } from '../compute/colors';

let overlay: MapboxOverlay | null = null;
let map: maplibregl.Map | null = null;

export function attachOverlay(m: maplibregl.Map) {
  map = m;
  overlay = new MapboxOverlay({ interleaved: false, layers: [] });
  m.addControl(overlay as unknown as maplibregl.IControl);
  rebuildLayers();
  store.subscribe(rebuildLayers);
}

function rebuildLayers() {
  if (!overlay) return;
  const s = store.getState();
  const layers: any[] = [];

  // Choropleth
  if (s.hexScores.length > 0) {
    const scale = quantileScale(s.hexScores.map((h) => h.weeklyMinutes));
    layers.push(
      new H3HexagonLayer<HexScore>({
        id: 'hex-choropleth',
        data: s.hexScores,
        pickable: true,
        extruded: false,
        filled: true,
        stroked: false,
        getHexagon: (d) => d.h3,
        getFillColor: (d) => {
          const [r, g, b] = scale(d.weeklyMinutes);
          return [r, g, b, 140];
        },
        updateTriggers: { getFillColor: [s.hexScores] },
      }),
    );
  }

  // Destination markers
  if (s.destinations.length > 0) {
    layers.push(
      new ScatterplotLayer<Destination>({
        id: 'destinations',
        data: s.destinations,
        getPosition: (d) => [d.lng, d.lat],
        getRadius: 6,
        radiusUnits: 'pixels',
        getFillColor: (d) => (d.chainId ? [74, 135, 238, 230] : [40, 40, 40, 230]),
        getLineColor: [255, 255, 255, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
        stroked: true,
        filled: true,
      }),
    );
  }

  // Hood marker + arcs
  if (s.hood && s.hexScores.length > 0) {
    layers.push(
      new ScatterplotLayer({
        id: 'hood',
        data: [s.hood],
        getPosition: (d: { lng: number; lat: number }) => [d.lng, d.lat],
        getRadius: 10,
        radiusUnits: 'pixels',
        getFillColor: [255, 107, 107, 255],
        getLineColor: [255, 255, 255, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        stroked: true,
        filled: true,
      }),
    );

    const arcs: ArcInfo[] = computeArcs(s.hood, s.destinations, s.chains);
    if (arcs.length > 0) {
      layers.push(
        new ArcLayer<ArcInfo>({
          id: 'hood-arcs',
          data: arcs,
          getSourcePosition: (d) => [d.fromLng, d.fromLat],
          getTargetPosition: (d) => [d.toLng, d.toLat],
          getSourceColor: [255, 107, 107, 200],
          getTargetColor: [74, 135, 238, 200],
          getWidth: 2,
          getHeight: 0.5,
        }),
        new TextLayer<ArcInfo>({
          id: 'hood-arc-labels',
          data: arcs,
          getPosition: (d) => [(d.fromLng + d.toLng) / 2, (d.fromLat + d.toLat) / 2],
          getText: (d) => `${Math.round(d.minutes)}m ${MODE_EMOJI[d.mode]}`,
          getSize: 13,
          getColor: [20, 20, 30, 255],
          background: true,
          getBackgroundColor: [255, 255, 255, 220],
          backgroundPadding: [4, 2, 4, 2],
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontWeight: 600,
        }),
      );
    }
  }

  overlay.setProps({ layers });
}

export function getMap() {
  return map;
}

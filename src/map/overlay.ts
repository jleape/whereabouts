import { MapboxOverlay } from '@deck.gl/mapbox';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { ArcLayer, TextLayer } from '@deck.gl/layers';
import { CollisionFilterExtension } from '@deck.gl/extensions';
import type maplibregl from 'maplibre-gl';
import { store } from '../state/store';
import type { ArcInfo, Destination, HexScore } from '../state/types';
import { MODE_EMOJI } from '../state/types';
import { linearScale } from '../compute/colors';

const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

let overlay: MapboxOverlay | null = null;
let map: maplibregl.Map | null = null;
let onDestinationClickHandler: ((id: string) => void) | null = null;

export interface OverlayHandlers {
  onDestinationClick?: (id: string) => void;
}

export function attachOverlay(m: maplibregl.Map, handlers: OverlayHandlers = {}) {
  map = m;
  onDestinationClickHandler = handlers.onDestinationClick ?? null;
  overlay = new MapboxOverlay({
    interleaved: false,
    layers: [],
    getCursor: ({ isDragging, isHovering }) => {
      const mode = store.getState().mode;
      if (mode === 'adding-destination' || mode === 'choosing-hood' || mode === 'batch-deleting') {
        return 'crosshair';
      }
      if (isDragging) return 'grabbing';
      if (isHovering) return 'pointer';
      return 'grab';
    },
    getTooltip: ({ object, layer }) => {
      if (!object || layer?.id !== 'hex-choropleth') return null;
      const score = object as HexScore;
      const minutes = score.weeklyMinutes;
      const text = Number.isFinite(minutes)
        ? `${fmtMin(minutes)} / week`
        : 'Unreachable';
      return {
        text,
        style: {
          background: 'rgba(20, 20, 30, 0.75)',
          color: '#fff',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: '500',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          border: 'none',
        },
      };
    },
  });
  m.addControl(overlay as unknown as maplibregl.IControl);
  rebuildLayers();
  store.subscribe(rebuildLayers);
}

function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return `${h}h ${m}m`;
}

function rebuildLayers() {
  if (!overlay) return;
  const s = store.getState();
  const layers: any[] = [];

  if (s.hexScores.length > 0) {
    const reachable = s.hexScores
      .map((h) => h.weeklyMinutes)
      .filter((v) => Number.isFinite(v));
    const dataMin = reachable.length ? Math.min(...reachable) : 0;
    const cap = s.weeklyCap ?? (reachable.length ? Math.max(...reachable) : 0);
    const scale = linearScale(dataMin, cap);
    layers.push(
      new H3HexagonLayer<HexScore>({
        id: 'hex-choropleth',
        data: s.hexScores,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 80],
        extruded: false,
        filled: true,
        stroked: false,
        getHexagon: (d) => d.h3,
        getFillColor: (d) => {
          const [r, g, b] = scale(d.weeklyMinutes);
          return [r, g, b, 100];
        },
        updateTriggers: { getFillColor: [dataMin, cap] },
      }),
    );
  }

  if (s.destinations.length > 0) {
    const chainEmoji = new Map(s.chains.map((c) => [c.id, c.emoji]));
    const selectedIds = new Set(s.batchDelete?.selectedIds ?? []);
    layers.push(
      new TextLayer<Destination>({
        id: 'destinations',
        data: s.destinations,
        pickable: true,
        // Display at exact click point; the snapped centroid is only used for
        // matrix lookups. Emoji = the chain's emoji (📍 for standalone).
        getPosition: (d) => [d.lng, d.lat],
        getText: (d) => (d.chainId ? chainEmoji.get(d.chainId) ?? '📍' : '📍'),
        getSize: (d) => (selectedIds.has(d.id) ? 26 : 20),
        sizeUnits: 'pixels',
        getColor: [0, 0, 0, 255],
        background: true,
        getBackgroundColor: (d) =>
          selectedIds.has(d.id) ? [255, 107, 107, 230] : [0, 0, 0, 0],
        backgroundPadding: [3, 3, 3, 4],
        fontFamily: EMOJI_FONT,
        characterSet: 'auto',
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        updateTriggers: {
          getText: [s.chains],
          getSize: [selectedIds],
          getBackgroundColor: [selectedIds],
        },
        onClick: (info) => {
          const dest = info.object as Destination | undefined;
          if (!dest) return false;
          const state = store.getState();
          if (state.mode === 'batch-deleting' && state.batchDelete) {
            if (dest.chainId !== state.batchDelete.chainId) return false;
            state.toggleBatchSelection(dest.id);
            return true;
          }
          if (state.mode !== 'idle') return false;
          if (!onDestinationClickHandler) return false;
          onDestinationClickHandler(dest.id);
          return true;
        },
      }),
    );
  }

  if (s.hood) {
    layers.push(
      new TextLayer<{ lng: number; lat: number }>({
        id: 'hood',
        data: [s.hood],
        getPosition: (d) => [d.lng, d.lat],
        getText: () => '🏠',
        getSize: 36,
        sizeUnits: 'pixels',
        getColor: [0, 0, 0, 255],
        fontFamily: EMOJI_FONT,
        characterSet: 'auto',
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
      }),
    );
    if (s.arcs.length > 0) {
      layers.push(
        new ArcLayer<ArcInfo>({
          id: 'hood-arcs',
          data: s.arcs,
          getSourcePosition: (d) => [d.fromLng, d.fromLat],
          getTargetPosition: (d) => [d.toLng, d.toLat],
          getSourceColor: [255, 107, 107, 200],
          getTargetColor: [74, 135, 238, 200],
          getWidth: 2,
          getHeight: 0.5,
        }),
        new TextLayer<ArcInfo>({
          id: 'hood-arc-labels',
          data: s.arcs,
          getPosition: (d) => [(d.fromLng + d.toLng) / 2, (d.fromLat + d.toLat) / 2],
          getText: (d) => `${Math.round(d.minutes)}m ${MODE_EMOJI[d.mode]}`,
          getSize: 18,
          sizeUnits: 'pixels',
          getColor: [20, 20, 30, 255],
          background: true,
          getBackgroundColor: [255, 255, 255, 235],
          backgroundPadding: [8, 6, 8, 6],
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif',
          fontWeight: 600,
          characterSet: 'auto',
          // Hide labels that would overlap each other; shorter-trip labels win.
          // CollisionFilterExtension props aren't in TextLayer's prop types.
          extensions: [new CollisionFilterExtension()],
          ...({
            collisionEnabled: true,
            collisionGroup: 'arc-labels',
            getCollisionPriority: (d: ArcInfo) => -d.minutes,
          } as Record<string, unknown>),
        }),
      );
    }
  }

  overlay.setProps({ layers });
}

export function getMap() {
  return map;
}

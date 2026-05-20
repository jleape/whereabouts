import { MapboxOverlay } from '@deck.gl/mapbox';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { ArcLayer, TextLayer, PolygonLayer } from '@deck.gl/layers';
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
      if (mode === 'adding-destination' || mode === 'choosing-abode') {
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
        // Dim the whole choropleth once an abode is placed so the arcs pop.
        opacity: s.abode ? 0.4 : 1,
        getHexagon: (d) => d.h3,
        getFillColor: (d) => {
          const [r, g, b] = scale(d.weeklyMinutes);
          return [r, g, b, 65];
        },
        updateTriggers: { getFillColor: [dataMin, cap] },
      }),
    );
  }

  // Polygon destinations (large parks/beaches) — draw the filled shape; their
  // ring-of-cells member destinations are not shown as markers.
  const polygonGroupIds = new Set(
    s.groups.filter((g) => g.polygon && g.polygon.length).map((g) => g.id),
  );
  const polygonRings: number[][][] = [];
  for (const g of s.groups) {
    if (g.polygon) for (const ring of g.polygon) polygonRings.push(ring);
  }
  if (polygonRings.length > 0) {
    layers.push(
      new PolygonLayer<number[][]>({
        id: 'group-polygons',
        data: polygonRings,
        getPolygon: (ring) => ring,
        filled: true,
        stroked: true,
        getFillColor: [104, 168, 120, 45],
        getLineColor: [104, 168, 120, 150],
        getLineWidth: 1.5,
        lineWidthUnits: 'pixels',
        pickable: false,
      }),
    );
  }

  const markerDests = s.destinations.filter(
    (d) => !d.groupId || !polygonGroupIds.has(d.groupId),
  );
  if (markerDests.length > 0) {
    const groupEmoji = new Map(s.groups.map((c) => [c.id, c.emoji]));
    // Once an abode is placed, dim every destination that isn't the nearest
    // of its group (i.e. has no arc) so the winners pop.
    const nearestIds = new Set(s.arcs.map((a) => a.toId));
    const dimNonNearest = !!s.abode;
    const fullDests = markerDests.filter(
      (d) => !dimNonNearest || nearestIds.has(d.id),
    );
    const dimDests = dimNonNearest
      ? markerDests.filter((d) => !nearestIds.has(d.id))
      : [];

    const destLayer = (id: string, data: Destination[], opacity: number) =>
      new TextLayer<Destination>({
        id,
        data,
        opacity,
        pickable: true,
        // Display at exact click point; the snapped centroid is only used for
        // matrix lookups. Emoji = the group's emoji for grouped destinations,
        // the destination's own type emoji for standalone ones.
        getPosition: (d) => [d.lng, d.lat],
        getText: (d) =>
          d.groupId ? groupEmoji.get(d.groupId) ?? '📍' : d.emoji || '📍',
        getSize: 20,
        sizeUnits: 'pixels',
        getColor: [0, 0, 0, 255],
        fontFamily: EMOJI_FONT,
        characterSet: 'auto',
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        updateTriggers: { getText: [s.groups] },
        onClick: (info) => {
          const dest = info.object as Destination | undefined;
          if (!dest) return false;
          const state = store.getState();
          if (state.mode !== 'idle') return false;
          if (!onDestinationClickHandler) return false;
          onDestinationClickHandler(dest.id);
          return true;
        },
      });

    if (fullDests.length > 0) {
      layers.push(destLayer('destinations', fullDests, 1));
    }
    if (dimDests.length > 0) {
      layers.push(destLayer('destinations-dim', dimDests, 0.3));
    }
  }

  if (s.abode) {
    if (s.arcs.length > 0) {
      layers.push(
        new ArcLayer<ArcInfo>({
          id: 'abode-arcs',
          data: s.arcs,
          getSourcePosition: (d) => [d.fromLng, d.fromLat],
          getTargetPosition: (d) => [d.toLng, d.toLat],
          getSourceColor: [255, 107, 107, 200],
          getTargetColor: [74, 135, 238, 200],
          getWidth: 2,
          getHeight: 0.5,
        }),
        new TextLayer<ArcInfo>({
          id: 'abode-arc-labels',
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
          // collisionTestProps inflates the test box so labels keep clearance.
          // CollisionFilterExtension props aren't in TextLayer's prop types.
          extensions: [new CollisionFilterExtension()],
          ...({
            collisionEnabled: true,
            collisionGroup: 'arc-labels',
            collisionTestProps: { sizeScale: 2 },
            getCollisionPriority: (d: ArcInfo) => -d.minutes,
          } as Record<string, unknown>),
        }),
      );
    }
    // Abode marker pushed last so it renders on top of every other layer.
    layers.push(
      new TextLayer<{ lng: number; lat: number }>({
        id: 'abode',
        data: [s.abode],
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
  }

  overlay.setProps({ layers });
}

export function getMap() {
  return map;
}

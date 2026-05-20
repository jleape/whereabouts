// Viridis-ish palette, low (good) → high (bad).
// Green/teal for low travel time, magenta/red for high.
const PALETTE: Array<[number, number, number]> = [
  [38, 130, 142],   // teal — best
  [62, 168, 132],
  [137, 213, 87],
  [253, 231, 36],
  [253, 165, 38],
  [240, 90, 60],
  [180, 30, 80],    // magenta — worst
];

export function quantileScale(values: number[]) {
  if (values.length === 0) {
    return (_v: number) => PALETTE[0];
  }
  const sorted = [...values].sort((a, b) => a - b);
  const bins = PALETTE.length;
  const breaks: number[] = [];
  for (let i = 1; i < bins; i++) {
    const q = i / bins;
    const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    breaks.push(sorted[idx]);
  }
  return (v: number): [number, number, number] => {
    for (let i = 0; i < breaks.length; i++) {
      if (v <= breaks[i]) return PALETTE[i];
    }
    return PALETTE[PALETTE.length - 1];
  };
}

// Linear bins from `min` (best color) to `max` (worst color), inclusive.
// Values outside the range peg to the appropriate end. Equal-width bins mean
// each color represents the same slice of minutes — so when the user narrows
// the cap, the visible variation within that band gets more color resolution.
export function linearScale(min: number, max: number) {
  const bins = PALETTE.length;
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    return (_v: number) => PALETTE[0];
  }
  return (v: number): [number, number, number] => {
    if (v <= min) return PALETTE[0];
    if (v >= max) return PALETTE[bins - 1];
    const idx = Math.min(bins - 1, Math.floor(((v - min) / span) * bins));
    return PALETTE[idx];
  };
}

export function paletteSwatches() {
  return PALETTE;
}

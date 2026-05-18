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
  // Compute quantile breakpoints
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

export function paletteSwatches() {
  return PALETTE;
}

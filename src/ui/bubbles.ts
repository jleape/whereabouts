// Brief, auto-dismissing instruction bubbles that guide a first-time mobile
// user through the flow. Each bubble fires once per session, on a specific
// state transition. Desktop is left alone — the panel never hides the map there.

import { store, getState } from '../state/store';

const MOBILE = window.matchMedia('(max-width: 640px)');
const VISIBLE_MS = 5200;

const BUBBLES = {
  start: `👋 Add the places you go often — pick a preset, or tap + Add for your own.`,
  addDest: `📍 Tap the map where this place is.`,
  compute: `Tap "Do the sums" to see which neighbourhoods cost you the least time.`,
  results: `Greener hexes = less time lost. Pull the panel up to test where you'd live.`,
  abode: `🏠 Tap anywhere you might live.`,
  abodePlaced: `There's your weekly total — pull the panel up to hunt for a flat nearby.`,
} as const;
type BubbleKey = keyof typeof BUBBLES;

const seen = new Set<BubbleKey>();
let current: HTMLElement | null = null;
let hideTimer: number | undefined;

function dismiss() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
  const node = current;
  current = null;
  if (!node) return;
  node.classList.remove('bubble-in');
  node.addEventListener('transitionend', () => node.remove(), { once: true });
  setTimeout(() => node.remove(), 600); // fallback if transitionend is missed
}

function show(key: BubbleKey) {
  if (!MOBILE.matches || seen.has(key)) return;
  seen.add(key);
  dismiss(); // never stack two bubbles

  const node = document.createElement('div');
  node.className = 'bubble';
  node.setAttribute('role', 'status');
  node.textContent = BUBBLES[key];
  node.addEventListener('click', dismiss);
  document.body.appendChild(node);
  current = node;

  requestAnimationFrame(() => node.classList.add('bubble-in'));
  hideTimer = window.setTimeout(dismiss, VISIBLE_MS);
}

// Watch the store for the transitions each bubble keys off of.
export function initBubbles() {
  const s0 = getState();
  let prevReady = s0.matrixReady;
  let prevMode = s0.mode;
  let prevItems = s0.destinations.length > 0 || s0.groups.length > 0;
  let prevScores = s0.hexScores.length > 0;
  let prevAbode = !!s0.abode;

  // First-load prompt — only once the travel-time matrix has loaded.
  if (s0.matrixReady && !prevItems) show('start');

  store.subscribe((s) => {
    if (s.matrixReady && !prevReady) {
      if (s.destinations.length === 0 && s.groups.length === 0) show('start');
    }
    prevReady = s.matrixReady;

    if (s.mode !== prevMode) {
      if (s.mode === 'adding-destination') show('addDest');
      else if (s.mode === 'choosing-abode') show('abode');
      prevMode = s.mode;
    }

    const items = s.destinations.length > 0 || s.groups.length > 0;
    if (items && !prevItems && s.hexScores.length === 0) show('compute');
    prevItems = items;

    const scores = s.hexScores.length > 0;
    if (scores && !prevScores) show('results');
    prevScores = scores;

    const abode = !!s.abode;
    if (abode && !prevAbode) show('abodePlaced');
    prevAbode = abode;
  });
}

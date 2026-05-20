// Bottom-sheet behavior for the control panel on narrow (mobile) viewports.
// On desktop the panel is a fixed top-left card and every export here is inert.
// Layout (the collapsed translateY, the peek height) lives in style.css.

const MOBILE_QUERY = '(max-width: 640px)';
// Visible strip when collapsed — must match the translateY() in style.css.
const PEEK_PX = 76;
// Pointer travel (px) above which a gesture counts as a drag, not a tap.
const DRAG_THRESHOLD = 6;

const mql = window.matchMedia(MOBILE_QUERY);
const isMobile = () => mql.matches;

let panel: HTMLElement;
let handle: HTMLElement;
let collapsed = false;

function applyCollapsed() {
  panel.style.transition = '';
  panel.style.transform = '';
  panel.classList.toggle('collapsed', collapsed);
  handle.setAttribute('aria-expanded', String(!collapsed));
  // Reset scroll so the peek strip always shows the title, not mid-content.
  if (collapsed) panel.scrollTop = 0;
}

/** Collapse the sheet to its peek height. No-op on desktop or if already collapsed. */
export function collapseSheet() {
  if (!isMobile() || collapsed) return;
  collapsed = true;
  applyCollapsed();
}

function toggle() {
  collapsed = !collapsed;
  applyCollapsed();
}

export function initBottomSheet() {
  panel = document.getElementById('panel')!;
  handle = document.getElementById('panel-handle')!;
  handle.setAttribute('aria-expanded', 'true');

  let dragging = false;
  let startY = 0;
  let startT = 0; // translateY at gesture start
  let curT = 0; // translateY now
  let maxT = 0; // translateY for the fully-collapsed state
  let moved = false;

  handle.addEventListener('pointerdown', (e) => {
    if (!isMobile()) return;
    dragging = true;
    moved = false;
    maxT = Math.max(0, panel.offsetHeight - PEEK_PX);
    startY = e.clientY;
    startT = collapsed ? maxT : 0;
    curT = startT;
    panel.style.transition = 'none';
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > DRAG_THRESHOLD) moved = true;
    curT = Math.min(maxT, Math.max(0, startT + dy));
    panel.style.transform = `translateY(${curT}px)`;
  });

  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    if (moved) {
      collapsed = curT > maxT / 2; // snap to the nearer state
      applyCollapsed();
    } else {
      toggle(); // a tap on the handle flips the sheet
    }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  handle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  // Returning to the desktop layout: drop all sheet state so the card is clean.
  mql.addEventListener('change', () => {
    if (!isMobile()) {
      collapsed = false;
      panel.classList.remove('collapsed');
      panel.style.transform = '';
      panel.style.transition = '';
    }
  });
}

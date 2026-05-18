import maplibregl from 'maplibre-gl';
import { store } from '../state/store';
import {
  ALL_MODES,
  MODE_LABEL,
  type Destination,
  type PeakPeriod,
  type TravelMode,
} from '../state/types';

interface PopupInit {
  lng: number;
  lat: number;
  existing?: Destination;
  onSave: (d: Destination) => void;
  onCancel: () => void;
}

export function openDestinationPopup(
  map: maplibregl.Map,
  init: PopupInit,
): maplibregl.Popup {
  const root = document.createElement('div');
  root.className = 'popup-form';

  const existing = init.existing;
  const chains = store.getState().chains;
  const initialChainName = existing?.chainId
    ? chains.find((c) => c.id === existing.chainId)?.name ?? ''
    : '';

  root.innerHTML = `
    <div class="field">
      <label>Name</label>
      <input type="text" data-field="name" placeholder="e.g. Office, Yoga studio" value="${escapeHtml(existing?.name ?? '')}" />
    </div>
    <div class="field">
      <label>Chain (optional)</label>
      <input type="text" data-field="chainname" placeholder="e.g. Trader Joe's — leave blank if not a chain" list="chain-suggest" value="${escapeHtml(initialChainName)}" />
      <datalist id="chain-suggest">
        ${chains.map((c) => `<option value="${escapeHtml(c.name)}"></option>`).join('')}
      </datalist>
    </div>
    <div class="field">
      <label>Visits per week (fractions ok)</label>
      <input type="number" data-field="visits" step="0.1" min="0" value="${existing?.visitsPerWeek ?? 1}" />
    </div>
    <div class="field">
      <label>Possible travel modes</label>
      <div class="modes">
        ${ALL_MODES.map(
          (m) => `
          <label>
            <input type="checkbox" data-mode="${m}" ${
              existing ? (existing.modes.includes(m) ? 'checked' : '') : 'checked'
            } />
            ${MODE_LABEL[m]}
          </label>`,
        ).join('')}
      </div>
    </div>
    <div class="field">
      <label>When do you typically go?</label>
      <div class="peak">
        <label><input type="radio" name="peak" value="peak" ${
          (existing?.peak ?? 'peak') === 'peak' ? 'checked' : ''
        } /> Peak</label>
        <label><input type="radio" name="peak" value="offpeak" ${
          (existing?.peak ?? 'peak') === 'offpeak' ? 'checked' : ''
        } /> Off-peak</label>
      </div>
    </div>
    <div class="actions">
      <button type="button" data-action="cancel">Cancel</button>
      <button type="button" class="primary" data-action="save">Save</button>
    </div>
  `;

  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    maxWidth: 'none',
  })
    .setLngLat([init.lng, init.lat])
    .setDOMContent(root)
    .addTo(map);

  const nameInput = root.querySelector<HTMLInputElement>('[data-field="name"]')!;
  const chainInput = root.querySelector<HTMLInputElement>('[data-field="chainname"]')!;
  const visitsInput = root.querySelector<HTMLInputElement>('[data-field="visits"]')!;

  // When the chain field matches an existing chain, auto-populate visits, modes, peak
  // from the first sibling destination in that chain. Re-runs on every input change.
  chainInput.addEventListener('input', () => {
    const val = chainInput.value.trim();
    if (!val) return;
    const chain = store
      .getState()
      .chains.find((c) => c.name.toLowerCase() === val.toLowerCase());
    if (!chain) return;
    const sibling = store
      .getState()
      .destinations.find((d) => d.chainId === chain.id && d.id !== existing?.id);
    if (!sibling) return;
    visitsInput.value = String(sibling.visitsPerWeek);
    for (const m of ALL_MODES) {
      const cb = root.querySelector<HTMLInputElement>(`[data-mode="${m}"]`)!;
      cb.checked = sibling.modes.includes(m);
    }
    const peakRadio = root.querySelector<HTMLInputElement>(
      `input[name="peak"][value="${sibling.peak}"]`,
    );
    if (peakRadio) peakRadio.checked = true;
    // Suggest a default name like "Trader Joe's #2" if name is empty
    if (!nameInput.value.trim()) {
      const siblings = store
        .getState()
        .destinations.filter((d) => d.chainId === chain.id);
      nameInput.value = `${chain.name} #${siblings.length + 1}`;
    }
  });

  root.querySelector('[data-action="cancel"]')!.addEventListener('click', () => {
    popup.remove();
    init.onCancel();
  });

  root.querySelector('[data-action="save"]')!.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const visits = parseFloat(visitsInput.value);
    const modes = ALL_MODES.filter(
      (m) => (root.querySelector(`[data-mode="${m}"]`) as HTMLInputElement).checked,
    ) as TravelMode[];
    const peakInput = root.querySelector('input[name="peak"]:checked') as HTMLInputElement;
    const peak = (peakInput?.value ?? 'peak') as PeakPeriod;
    const chainNameVal = chainInput.value.trim();

    if (!name) {
      alert('Please enter a name for this destination.');
      return;
    }
    if (!Number.isFinite(visits) || visits <= 0) {
      alert('Visits per week must be a positive number.');
      return;
    }
    if (modes.length === 0) {
      alert('Pick at least one travel mode.');
      return;
    }

    let chainId: string | null = null;
    if (chainNameVal) {
      const ch = store.getState().addChain(chainNameVal);
      chainId = ch.id;
    }

    const d: Destination = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      lng: init.lng,
      lat: init.lat,
      visitsPerWeek: visits,
      modes,
      peak,
      chainId,
    };
    popup.remove();
    init.onSave(d);
  });

  return popup;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

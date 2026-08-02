import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import {
  blockToChunk,
  blockToLatLng,
  blockToRegion,
  getRegionBounds,
  getRegionCenter,
  getRegionForBlock,
  getRegionName,
  latLngToBlock,
  type CoordinatePair,
} from './coordinates';
import { RegionGridLayer } from './grid-layer';
import { parseSearch } from './search';

type Theme = 'light' | 'dark';
type SelectionMode = 'idle' | 'awaiting-first' | 'awaiting-second';

interface AreaSelection {
  id: number;
  cornerA: CoordinatePair;
  cornerB: CoordinatePair;
  color: string;
  layer: L.Rectangle;
}

const getElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element as T;
};

const formatCoordinate = (value: number): string => value.toLocaleString('en-US');
const formatPair = (x: number, z: number): string =>
  `${formatCoordinate(x)}, ${formatCoordinate(z)}`;

const savedTheme = localStorage.getItem('regionscope-theme');
let theme: Theme =
  savedTheme === 'light' || savedTheme === 'dark'
    ? savedTheme
    : window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';

const map = L.map('map', {
  crs: L.CRS.Simple,
  center: [0, 0],
  zoom: -2,
  minZoom: -18,
  maxZoom: 6,
  attributionControl: false,
  zoomControl: false,
  zoomSnap: 0.25,
  zoomDelta: 0.5,
  wheelPxPerZoomLevel: 100,
});

const gridLayer = new RegionGridLayer(theme === 'dark');
gridLayer.addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

const app = getElement<HTMLElement>('app');
const searchForm = getElement<HTMLFormElement>('search-form');
const searchInput = getElement<HTMLInputElement>('search-input');
const searchStatus = getElement<HTMLParagraphElement>('search-status');
const cursorBlock = getElement<HTMLElement>('cursor-block');
const cursorChunk = getElement<HTMLElement>('cursor-chunk');
const cursorRegion = getElement<HTMLElement>('cursor-region');
const inspector = getElement<HTMLElement>('inspector');
const inspectorEmpty = getElement<HTMLElement>('inspector-empty');
const inspectorDetails = getElement<HTMLElement>('inspector-details');
const regionName = getElement<HTMLElement>('region-name');
const regionCoordinate = getElement<HTMLElement>('region-coordinate');
const selectedBlockCard = getElement<HTMLElement>('selected-block-card');
const selectedBlockCoordinate = getElement<HTMLElement>('selected-block-coordinate');
const blockBounds = getElement<HTMLElement>('block-bounds');
const chunkBounds = getElement<HTMLElement>('chunk-bounds');
const themeButton = getElement<HTMLButtonElement>('theme-button');
const themeIcon = getElement<HTMLElement>('theme-icon');
const toolsButton = getElement<HTMLButtonElement>('tools-button');
const toolsPanel = getElement<HTMLElement>('tools-panel');
const worldborderForm = getElement<HTMLFormElement>('worldborder-form');
const worldborderRadius = getElement<HTMLInputElement>('worldborder-radius');
const worldborderClear = getElement<HTMLButtonElement>('worldborder-clear');
const worldborderStatus = getElement<HTMLOutputElement>('worldborder-status');
const selectionStartButton = getElement<HTMLButtonElement>('selection-start');
const selectionToolStatus = getElement<HTMLElement>('selection-tool-status');
const selectionToolbar = getElement<HTMLElement>('selection-toolbar');
const selectionPrompt = getElement<HTMLElement>('selection-prompt');
const selectionNextColor = getElement<HTMLElement>('selection-next-color');
const selectionList = getElement<HTMLOListElement>('selections-list');
const selectionCount = getElement<HTMLElement>('selection-count');
const selectionsEmpty = getElement<HTMLElement>('selections-empty');
const selectionsClearAll = getElement<HTMLButtonElement>('selections-clear-all');
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

let highlight: L.Rectangle | undefined;
let blockHighlight: L.Rectangle | undefined;
let worldBorder: L.Rectangle | undefined;
let selectionMode: SelectionMode = 'idle';
let selectionCornerA: CoordinatePair | undefined;
let selectionDraft: L.Rectangle | undefined;
let nextSelectionId = 1;
const selections: AreaSelection[] = [];

const setToolsOpen = (isOpen: boolean): void => {
  toolsPanel.hidden = !isOpen;
  toolsButton.setAttribute('aria-expanded', String(isOpen));
};

const getSelectionColor = (index: number): string => {
  const hue = Math.round((index * 137.508 + 8) % 360);
  return `hsl(${hue} 68% 52%)`;
};

const getSelectionBounds = (cornerA: CoordinatePair, cornerB: CoordinatePair): L.LatLngBounds => {
  const minX = Math.min(cornerA.x, cornerB.x);
  const minZ = Math.min(cornerA.z, cornerB.z);
  const maxX = Math.max(cornerA.x, cornerB.x);
  const maxZ = Math.max(cornerA.z, cornerB.z);
  return L.latLngBounds(blockToLatLng(minX, minZ), blockToLatLng(maxX + 1, maxZ + 1));
};

const renderSelectionList = (): void => {
  selectionList.replaceChildren();
  selectionCount.textContent = String(selections.length);
  selectionsEmpty.hidden = selections.length > 0;
  selectionsClearAll.disabled = selections.length === 0;

  selections.forEach((selection, index) => {
    const item = document.createElement('li');
    item.className = 'selection-item';
    item.style.setProperty('--selection-color', selection.color);
    item.innerHTML = `
      <div class="selection-item-heading">
        <div class="selection-item-name">
          <span class="selection-color" aria-hidden="true"></span>
          <strong>Selection ${index + 1}</strong>
        </div>
        <div class="selection-item-actions">
          <button type="button" data-selection-action="view" data-selection-id="${selection.id}">View</button>
          <button type="button" data-selection-action="remove" data-selection-id="${selection.id}" aria-label="Remove Selection ${index + 1}">×</button>
        </div>
      </div>
      <dl class="selection-corners">
        <div><dt>Corner A</dt><dd>X ${formatCoordinate(selection.cornerA.x)}<br>Z ${formatCoordinate(selection.cornerA.z)}</dd></div>
        <div><dt>Corner B</dt><dd>X ${formatCoordinate(selection.cornerB.x)}<br>Z ${formatCoordinate(selection.cornerB.z)}</dd></div>
      </dl>
    `;
    selectionList.append(item);
  });
};

const updateSelectionModeUi = (): void => {
  const isActive = selectionMode !== 'idle';
  selectionToolbar.hidden = !isActive;
  toolsButton.classList.toggle('has-active-tool', isActive);
  selectionStartButton.textContent = isActive ? 'Cancel selection tool' : 'Start selecting';
  selectionNextColor.style.backgroundColor = getSelectionColor(nextSelectionId - 1);

  if (selectionMode === 'awaiting-second' && selectionCornerA) {
    const message = `Corner A: ${formatPair(selectionCornerA.x, selectionCornerA.z)}. Click corner B.`;
    selectionPrompt.textContent = message;
    selectionToolStatus.textContent = message;
  } else if (selectionMode === 'awaiting-first') {
    selectionPrompt.textContent = 'Click the first corner of a selection';
    selectionToolStatus.textContent = 'Active — click the first corner on the map.';
  } else {
    selectionToolStatus.textContent = 'No selection tool active.';
  }
};

const stopSelectionMode = (): void => {
  selectionMode = 'idle';
  selectionCornerA = undefined;
  if (selectionDraft) {
    map.removeLayer(selectionDraft);
    selectionDraft = undefined;
  }
  updateSelectionModeUi();
};

const startSelectionMode = (): void => {
  selectionMode = 'awaiting-first';
  selectionCornerA = undefined;
  if (selectionDraft) {
    map.removeLayer(selectionDraft);
    selectionDraft = undefined;
  }
  setToolsOpen(false);
  updateSelectionModeUi();
};

const addSelection = (cornerA: CoordinatePair, cornerB: CoordinatePair): void => {
  const color = getSelectionColor(nextSelectionId - 1);
  const layer = L.rectangle(getSelectionBounds(cornerA, cornerB), {
    className: 'area-selection',
    color,
    fillColor: color,
    fillOpacity: 0.14,
    opacity: 0.95,
    weight: 3,
    interactive: false,
  }).addTo(map);

  selections.push({
    id: nextSelectionId,
    cornerA: { ...cornerA },
    cornerB: { ...cornerB },
    color,
    layer,
  });
  nextSelectionId += 1;
  worldBorder?.bringToBack();
  highlight?.bringToFront();
  blockHighlight?.bringToFront();
  renderSelectionList();
  inspector.classList.add('is-open');
  app.classList.add('inspector-open');
};

const applyTheme = (): void => {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = theme;
  gridLayer.setDarkMode(isDark);
  themeIcon.textContent = isDark ? '☀' : '☾';
  themeButton.ariaLabel = isDark ? 'Use light theme' : 'Use dark theme';
  themeButton.title = themeButton.ariaLabel;
  themeColor?.setAttribute('content', isDark ? '#141b16' : '#f3f5ef');
};

const closeInspector = (): void => {
  if (highlight) {
    map.removeLayer(highlight);
    highlight = undefined;
  }
  if (blockHighlight) {
    map.removeLayer(blockHighlight);
    blockHighlight = undefined;
  }
  inspector.classList.remove('is-open');
  app.classList.remove('inspector-open');
  inspectorEmpty.hidden = false;
  inspectorDetails.hidden = true;
};

const showRegion = (
  regionX: number,
  regionZ: number,
  shouldCenter: boolean,
  selectedBlock?: CoordinatePair,
): void => {
  const bounds = getRegionBounds(regionX, regionZ);
  const rectangleBounds = L.latLngBounds(
    blockToLatLng(bounds.blockMin.x, bounds.blockMin.z),
    blockToLatLng(bounds.blockMax.x + 1, bounds.blockMax.z + 1),
  );

  if (highlight) {
    highlight.setBounds(rectangleBounds);
  } else {
    highlight = L.rectangle(rectangleBounds, {
      className: 'region-highlight',
      color: '#e5663f',
      fillColor: '#e5663f',
      fillOpacity: 0.13,
      opacity: 0.95,
      weight: 3,
      interactive: false,
    }).addTo(map);
  }

  regionName.textContent = getRegionName(regionX, regionZ);
  regionCoordinate.textContent = formatPair(regionX, regionZ);

  if (selectedBlock) {
    const blockRectangleBounds = L.latLngBounds(
      blockToLatLng(selectedBlock.x, selectedBlock.z),
      blockToLatLng(selectedBlock.x + 1, selectedBlock.z + 1),
    );
    if (blockHighlight) {
      blockHighlight.setBounds(blockRectangleBounds);
    } else {
      blockHighlight = L.rectangle(blockRectangleBounds, {
        className: 'block-highlight',
        color: '#15926d',
        fillColor: '#40c69a',
        fillOpacity: 0.3,
        opacity: 1,
        weight: 2,
        interactive: false,
      }).addTo(map);
    }
    selectedBlockCoordinate.textContent = `X ${formatCoordinate(selectedBlock.x)} · Z ${formatCoordinate(selectedBlock.z)}`;
    selectedBlockCard.hidden = false;
  } else {
    if (blockHighlight) {
      map.removeLayer(blockHighlight);
      blockHighlight = undefined;
    }
    selectedBlockCard.hidden = true;
  }

  blockBounds.innerHTML = `X ${formatCoordinate(bounds.blockMin.x)}…${formatCoordinate(bounds.blockMax.x)}<br>Z ${formatCoordinate(bounds.blockMin.z)}…${formatCoordinate(bounds.blockMax.z)}`;
  chunkBounds.innerHTML = `X ${formatCoordinate(bounds.chunkMin.x)}…${formatCoordinate(bounds.chunkMax.x)}<br>Z ${formatCoordinate(bounds.chunkMin.z)}…${formatCoordinate(bounds.chunkMax.z)}`;
  inspectorEmpty.hidden = true;
  inspectorDetails.hidden = false;
  inspector.classList.add('is-open');
  app.classList.add('inspector-open');

  if (shouldCenter) {
    map.flyTo(getRegionCenter(regionX, regionZ), Math.max(map.getZoom(), -1), {
      animate: true,
      duration: 0.65,
    });
  }
};

const returnToOrigin = (): void => {
  closeInspector();
  searchInput.value = '';
  searchStatus.textContent = '';
  searchInput.removeAttribute('aria-invalid');
  map.flyTo(blockToLatLng(0, 0), -2, { animate: true, duration: 0.65 });
};

map.on('mousemove', (event: L.LeafletMouseEvent) => {
  const block = latLngToBlock(event.latlng);
  cursorBlock.textContent = formatPair(block.x, block.z);
  cursorChunk.textContent = formatPair(blockToChunk(block.x), blockToChunk(block.z));
  cursorRegion.textContent = formatPair(blockToRegion(block.x), blockToRegion(block.z));

  if (selectionMode === 'awaiting-second' && selectionCornerA && selectionDraft) {
    selectionDraft.setBounds(getSelectionBounds(selectionCornerA, block));
  }
});

map.on('click', (event: L.LeafletMouseEvent) => {
  const block = latLngToBlock(event.latlng);

  if (selectionMode === 'awaiting-first') {
    selectionCornerA = { ...block };
    selectionMode = 'awaiting-second';
    const color = getSelectionColor(nextSelectionId - 1);
    selectionDraft = L.rectangle(getSelectionBounds(block, block), {
      className: 'selection-draft',
      color,
      dashArray: '7 6',
      fillColor: color,
      fillOpacity: 0.09,
      opacity: 0.95,
      weight: 2,
      interactive: false,
    }).addTo(map);
    updateSelectionModeUi();
    return;
  }

  if (selectionMode === 'awaiting-second' && selectionCornerA) {
    const cornerA = selectionCornerA;
    if (selectionDraft) {
      map.removeLayer(selectionDraft);
      selectionDraft = undefined;
    }
    addSelection(cornerA, block);
    selectionCornerA = undefined;
    selectionMode = 'awaiting-first';
    updateSelectionModeUi();
    return;
  }

  const region = getRegionForBlock(block.x, block.z);
  showRegion(region.x, region.z, false, block);
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const result = parseSearch(searchInput.value);

  if (!result) {
    searchInput.setAttribute('aria-invalid', 'true');
    searchStatus.textContent = 'Try r.-2.3.mca or two block coordinates.';
    return;
  }

  searchInput.removeAttribute('aria-invalid');
  showRegion(
    result.region.x,
    result.region.z,
    true,
    result.kind === 'block' ? result.block : undefined,
  );
  searchStatus.textContent =
    result.kind === 'block'
      ? `Block ${formatPair(result.block.x, result.block.z)} is in ${getRegionName(result.region.x, result.region.z)}.`
      : `${getRegionName(result.region.x, result.region.z)} selected.`;
  searchInput.blur();
});

searchInput.addEventListener('input', () => {
  searchInput.removeAttribute('aria-invalid');
  searchStatus.textContent = '';
});

getElement<HTMLButtonElement>('origin-button').addEventListener('click', returnToOrigin);
getElement<HTMLButtonElement>('brand-home').addEventListener('click', returnToOrigin);
getElement<HTMLButtonElement>('inspector-close').addEventListener('click', closeInspector);

toolsButton.addEventListener('click', () => {
  setToolsOpen(toolsPanel.hasAttribute('hidden'));
});

selectionStartButton.addEventListener('click', () => {
  if (selectionMode === 'idle') {
    startSelectionMode();
  } else {
    stopSelectionMode();
  }
});

getElement<HTMLButtonElement>('selection-cancel').addEventListener('click', stopSelectionMode);

selectionList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const button = target.closest<HTMLButtonElement>('[data-selection-action]');
  if (!button) {
    return;
  }

  const id = Number(button.dataset.selectionId);
  const index = selections.findIndex((selection) => selection.id === id);
  if (index < 0) {
    return;
  }

  const selection = selections[index];
  if (button.dataset.selectionAction === 'view') {
    map.fitBounds(selection.layer.getBounds(), {
      animate: true,
      duration: 0.65,
      padding: [70, 70],
    });
  } else if (button.dataset.selectionAction === 'remove') {
    map.removeLayer(selection.layer);
    selections.splice(index, 1);
    renderSelectionList();
  }
});

selectionsClearAll.addEventListener('click', () => {
  selections.forEach((selection) => map.removeLayer(selection.layer));
  selections.splice(0, selections.length);
  renderSelectionList();
});

worldborderForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const radius = Math.floor(Number(worldborderRadius.value));

  if (!Number.isSafeInteger(radius) || radius < 1 || radius > 30_000_000) {
    worldborderRadius.setAttribute('aria-invalid', 'true');
    worldborderStatus.textContent = 'Enter a radius from 1 to 30,000,000 blocks.';
    return;
  }

  worldborderRadius.removeAttribute('aria-invalid');
  worldborderRadius.value = String(radius);
  const borderBounds = L.latLngBounds(
    blockToLatLng(-radius, -radius),
    blockToLatLng(radius, radius),
  );

  if (worldBorder) {
    worldBorder.setBounds(borderBounds);
  } else {
    worldBorder = L.rectangle(borderBounds, {
      className: 'world-border',
      color: '#7665e8',
      dashArray: '10 8',
      fillColor: '#7665e8',
      fillOpacity: 0.035,
      opacity: 0.95,
      weight: 3,
      interactive: false,
    }).addTo(map);
  }

  worldBorder.bringToBack();
  worldborderClear.disabled = false;
  worldborderStatus.textContent = `${formatCoordinate(radius)} block radius · ${formatCoordinate(radius * 2)} × ${formatCoordinate(radius * 2)} overall.`;
  setToolsOpen(false);
  map.fitBounds(borderBounds, {
    animate: true,
    duration: 0.8,
    padding: [70, 70],
  });
});

worldborderRadius.addEventListener('input', () => {
  worldborderRadius.removeAttribute('aria-invalid');
});

worldborderClear.addEventListener('click', () => {
  if (worldBorder) {
    map.removeLayer(worldBorder);
    worldBorder = undefined;
  }
  worldborderClear.disabled = true;
  worldborderStatus.textContent = 'No world border drawn.';
});

themeButton.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('regionscope-theme', theme);
  applyTheme();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!toolsPanel.hasAttribute('hidden')) {
      setToolsOpen(false);
      toolsButton.focus();
    } else if (selectionMode !== 'idle') {
      stopSelectionMode();
    } else {
      closeInspector();
    }
  }
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (
    !toolsPanel.hasAttribute('hidden') &&
    target instanceof Node &&
    !toolsPanel.contains(target) &&
    !toolsButton.contains(target)
  ) {
    setToolsOpen(false);
  }
});

applyTheme();
renderSelectionList();
updateSelectionModeUi();

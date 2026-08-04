import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import {
  BLOCKS_PER_CHUNK,
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
import {
  decodeShareState,
  encodeShareState,
  type ShareState,
  type SharedSelection,
} from './share-state';
import { parseShardAssignments, type ShardAssignment } from './shard-import';

type Theme = 'light' | 'dark';
type SelectionMode = 'idle' | 'awaiting-first' | 'awaiting-second';

interface BaseSelection {
  id: number;
  color: string;
}

interface AreaSelection extends BaseSelection {
  kind: 'area';
  cornerA: CoordinatePair;
  cornerB: CoordinatePair;
  layer: L.Rectangle;
}

interface ShardSelection extends BaseSelection {
  kind: 'shard';
  assignmentId: string;
  shard: string;
  points: CoordinatePair[];
  layer: L.Polygon;
}

type MapSelection = AreaSelection | ShardSelection;

interface AddSelectionOptions {
  color?: string;
  updateUi?: boolean;
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
const shareButton = getElement<HTMLButtonElement>('share-button');
const shareToast = getElement<HTMLElement>('share-toast');
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
const shardImportDialog = getElement<HTMLDialogElement>('shard-import-dialog');
const shardImportForm = getElement<HTMLFormElement>('shard-import-form');
const shardImportSource = getElement<HTMLTextAreaElement>('shard-import-source');
const shardImportStatus = getElement<HTMLElement>('shard-import-status');
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

let highlight: L.Rectangle | undefined;
let blockHighlight: L.Rectangle | undefined;
let worldBorder: L.Rectangle | undefined;
let worldBorderRadiusValue: number | undefined;
let selectionMode: SelectionMode = 'idle';
let selectionCornerA: CoordinatePair | undefined;
let selectionDraft: L.Rectangle | undefined;
let nextSelectionId = 1;
const selections: MapSelection[] = [];
let shareToastTimeout: number | undefined;

const setToolsOpen = (isOpen: boolean): void => {
  toolsPanel.hidden = !isOpen;
  toolsButton.setAttribute('aria-expanded', String(isOpen));
};

const showShareToast = (message: string, isError = false): void => {
  if (shareToastTimeout !== undefined) {
    window.clearTimeout(shareToastTimeout);
  }
  shareToast.textContent = message;
  shareToast.classList.toggle('is-error', isError);
  shareToast.hidden = false;
  shareToastTimeout = window.setTimeout(() => {
    shareToast.hidden = true;
  }, 3200);
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

    const heading = document.createElement('div');
    heading.className = 'selection-item-heading';
    const name = document.createElement('div');
    name.className = 'selection-item-name';
    const color = document.createElement('span');
    color.className = 'selection-color';
    color.setAttribute('aria-hidden', 'true');
    const titleWrap = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = selection.kind === 'shard' ? selection.shard : `Selection ${index + 1}`;
    titleWrap.append(title);
    if (selection.kind === 'shard') {
      const assignmentId = document.createElement('small');
      assignmentId.className = 'selection-assignment-id';
      assignmentId.textContent = selection.assignmentId;
      titleWrap.append(assignmentId);
    }
    name.append(color, titleWrap);

    const actions = document.createElement('div');
    actions.className = 'selection-item-actions';
    const viewButton = document.createElement('button');
    viewButton.type = 'button';
    viewButton.dataset.selectionAction = 'view';
    viewButton.dataset.selectionId = String(selection.id);
    viewButton.textContent = 'View';
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.dataset.selectionAction = 'remove';
    removeButton.dataset.selectionId = String(selection.id);
    removeButton.ariaLabel = `Remove ${selection.kind === 'shard' ? selection.shard : `Selection ${index + 1}`}`;
    removeButton.textContent = '×';
    actions.append(viewButton, removeButton);
    heading.append(name, actions);
    item.append(heading);

    if (selection.kind === 'area') {
      const corners = document.createElement('dl');
      corners.className = 'selection-corners';
      [
        ['Corner A', selection.cornerA],
        ['Corner B', selection.cornerB],
      ].forEach(([label, point]) => {
        const container = document.createElement('div');
        const term = document.createElement('dt');
        const description = document.createElement('dd');
        term.textContent = String(label);
        const coordinate = point as CoordinatePair;
        description.append(`X ${formatCoordinate(coordinate.x)}`, document.createElement('br'));
        description.append(`Z ${formatCoordinate(coordinate.z)}`);
        container.append(term, description);
        corners.append(container);
      });
      item.append(corners);
    } else {
      const pointDetails = document.createElement('details');
      pointDetails.className = 'selection-points';
      const summary = document.createElement('summary');
      summary.textContent = `${selection.points.length} inclusive chunk points`;
      const pointList = document.createElement('ol');
      selection.points.forEach((point) => {
        const pointItem = document.createElement('li');
        pointItem.textContent = `[${formatCoordinate(point.x)}, ${formatCoordinate(point.z)}]`;
        pointList.append(pointItem);
      });
      pointDetails.append(summary, pointList);
      item.append(pointDetails);
    }

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

const addSelection = (
  cornerA: CoordinatePair,
  cornerB: CoordinatePair,
  options: AddSelectionOptions = {},
): void => {
  const color = options.color ?? getSelectionColor(nextSelectionId - 1);
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
    kind: 'area',
    cornerA: { ...cornerA },
    cornerB: { ...cornerB },
    color,
    layer,
  });
  nextSelectionId += 1;
  worldBorder?.bringToBack();
  highlight?.bringToFront();
  blockHighlight?.bringToFront();
  if (options.updateUi !== false) {
    renderSelectionList();
    inspector.classList.add('is-open');
    app.classList.add('inspector-open');
  }
};

const getInclusiveShardPolygon = (points: CoordinatePair[]): L.LatLngExpression[] => {
  const signedArea = points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.z - next.x * point.z;
  }, 0);
  const isCounterClockwise = signedArea > 0;
  const centers = points.map((point) => ({ x: point.x + 0.5, z: point.z + 0.5 }));
  const cross = (a: CoordinatePair, b: CoordinatePair): number => a.x * b.z - a.z * b.x;

  return centers.map((center, index) => {
    const previous = centers[(index - 1 + centers.length) % centers.length];
    const next = centers[(index + 1) % centers.length];
    const incomingLength = Math.hypot(center.x - previous.x, center.z - previous.z);
    const outgoingLength = Math.hypot(next.x - center.x, next.z - center.z);
    const incoming = {
      x: (center.x - previous.x) / incomingLength,
      z: (center.z - previous.z) / incomingLength,
    };
    const outgoing = {
      x: (next.x - center.x) / outgoingLength,
      z: (next.z - center.z) / outgoingLength,
    };
    const outward = (direction: CoordinatePair): CoordinatePair =>
      isCounterClockwise
        ? { x: direction.z, z: -direction.x }
        : { x: -direction.z, z: direction.x };
    const incomingNormal = outward(incoming);
    const outgoingNormal = outward(outgoing);
    const incomingOffset = {
      x: center.x + incomingNormal.x * 0.5,
      z: center.z + incomingNormal.z * 0.5,
    };
    const outgoingOffset = {
      x: center.x + outgoingNormal.x * 0.5,
      z: center.z + outgoingNormal.z * 0.5,
    };
    const determinant = cross(incoming, outgoing);

    let boundary = incomingOffset;
    if (Math.abs(determinant) > 1e-9) {
      const betweenOffsets = {
        x: outgoingOffset.x - incomingOffset.x,
        z: outgoingOffset.z - incomingOffset.z,
      };
      const distanceAlongIncoming = cross(betweenOffsets, outgoing) / determinant;
      boundary = {
        x: incomingOffset.x + incoming.x * distanceAlongIncoming,
        z: incomingOffset.z + incoming.z * distanceAlongIncoming,
      };
    }

    return blockToLatLng(
      boundary.x * BLOCKS_PER_CHUNK,
      boundary.z * BLOCKS_PER_CHUNK,
    );
  });
};

const addShardSelection = (
  assignment: ShardAssignment,
  options: AddSelectionOptions = {},
): ShardSelection => {
  const color = options.color ?? getSelectionColor(nextSelectionId - 1);
  const layer = L.polygon(
    getInclusiveShardPolygon(assignment.points),
    {
      className: 'area-selection shard-selection',
      color,
      fillColor: color,
      fillOpacity: 0.16,
      opacity: 0.98,
      weight: 3,
      interactive: false,
    },
  ).addTo(map);
  const label = document.createElement('span');
  label.textContent = assignment.shard;
  layer.bindTooltip(label, {
    className: 'shard-label',
    direction: 'center',
    interactive: false,
    opacity: 1,
    permanent: true,
  });

  const selection: ShardSelection = {
    id: nextSelectionId,
    kind: 'shard',
    assignmentId: assignment.id,
    shard: assignment.shard,
    points: assignment.points.map((point) => ({ ...point })),
    color,
    layer,
  };
  selections.push(selection);
  nextSelectionId += 1;
  if (options.updateUi !== false) {
    renderSelectionList();
    inspector.classList.add('is-open');
    app.classList.add('inspector-open');
  }
  return selection;
};

const getCurrentShareState = (): ShareState => {
  const center = map.getCenter();
  const sharedSelections: SharedSelection[] = selections.map((selection) =>
    selection.kind === 'area'
      ? {
          kind: 'area',
          cornerA: [selection.cornerA.x, selection.cornerA.z],
          cornerB: [selection.cornerB.x, selection.cornerB.z],
          color: selection.color,
        }
      : {
          kind: 'shard',
          assignmentId: selection.assignmentId,
          shard: selection.shard,
          points: selection.points.map((point) => [point.x, point.z]),
          color: selection.color,
        },
  );

  return {
    version: 1,
    view: {
      x: center.lng,
      z: center.lat,
      zoom: map.getZoom(),
    },
    ...(worldBorderRadiusValue === undefined ? {} : { worldBorderRadius: worldBorderRadiusValue }),
    selections: sharedSelections,
  };
};

const copyText = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) {
      throw new Error('Clipboard access was unavailable.');
    }
  }
};

const copyShareLink = async (): Promise<void> => {
  try {
    const payload = encodeShareState(getCurrentShareState());
    const url = new URL(window.location.href);
    url.hash = `s=${payload}`;
    window.history.replaceState(null, '', url);
    await copyText(url.toString());
    showShareToast('Share link copied to clipboard.');
  } catch (error) {
    showShareToast(
      error instanceof Error ? error.message : 'The share link could not be created.',
      true,
    );
  }
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

shareButton.addEventListener('click', () => {
  void copyShareLink();
});

selectionStartButton.addEventListener('click', () => {
  if (selectionMode === 'idle') {
    startSelectionMode();
  } else {
    stopSelectionMode();
  }
});

getElement<HTMLButtonElement>('selection-cancel').addEventListener('click', stopSelectionMode);

getElement<HTMLButtonElement>('shard-import-open').addEventListener('click', () => {
  stopSelectionMode();
  setToolsOpen(false);
  shardImportStatus.textContent = '';
  shardImportDialog.showModal();
  shardImportSource.focus();
});

const closeShardImport = (): void => {
  shardImportDialog.close();
  shardImportStatus.textContent = '';
};

getElement<HTMLButtonElement>('shard-import-close').addEventListener('click', closeShardImport);
getElement<HTMLButtonElement>('shard-import-cancel').addEventListener('click', closeShardImport);

shardImportForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const assignments = parseShardAssignments(shardImportSource.value);
    const imported = assignments.map((assignment) =>
      addShardSelection(assignment, { updateUi: false }),
    );
    worldBorder?.bringToBack();
    highlight?.bringToFront();
    blockHighlight?.bringToFront();
    renderSelectionList();
    inspector.classList.add('is-open');
    app.classList.add('inspector-open');
    selectionToolStatus.textContent = `${imported.length} shard ${imported.length === 1 ? 'assignment' : 'assignments'} imported.`;
    shardImportDialog.close();

    const importedGroup = L.featureGroup(imported.map((selection) => selection.layer));
    map.fitBounds(importedGroup.getBounds(), {
      animate: true,
      duration: 0.8,
      padding: [70, 70],
    });
  } catch (error) {
    shardImportStatus.textContent =
      error instanceof Error ? error.message : 'The assignments could not be imported.';
  }
});

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

const drawWorldBorder = (radius: number, shouldFit: boolean): void => {
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

  worldBorderRadiusValue = radius;
  worldBorder.bringToBack();
  worldborderRadius.value = String(radius);
  worldborderClear.disabled = false;
  worldborderStatus.textContent = `${formatCoordinate(radius)} block radius · ${formatCoordinate(radius * 2)} × ${formatCoordinate(radius * 2)} overall.`;
  if (shouldFit) {
    map.fitBounds(borderBounds, {
      animate: true,
      duration: 0.8,
      padding: [70, 70],
    });
  }
};

worldborderForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const radius = Math.floor(Number(worldborderRadius.value));

  if (!Number.isSafeInteger(radius) || radius < 1 || radius > 30_000_000) {
    worldborderRadius.setAttribute('aria-invalid', 'true');
    worldborderStatus.textContent = 'Enter a radius from 1 to 30,000,000 blocks.';
    return;
  }

  worldborderRadius.removeAttribute('aria-invalid');
  setToolsOpen(false);
  drawWorldBorder(radius, true);
});

worldborderRadius.addEventListener('input', () => {
  worldborderRadius.removeAttribute('aria-invalid');
});

worldborderClear.addEventListener('click', () => {
  if (worldBorder) {
    map.removeLayer(worldBorder);
    worldBorder = undefined;
  }
  worldBorderRadiusValue = undefined;
  worldborderClear.disabled = true;
  worldborderStatus.textContent = 'No world border drawn.';
});

const restoreSharedSetup = (): void => {
  const payload = new URLSearchParams(window.location.hash.slice(1)).get('s');
  if (!payload) {
    return;
  }

  try {
    const state = decodeShareState(payload);
    if (state.worldBorderRadius !== undefined) {
      drawWorldBorder(state.worldBorderRadius, false);
    }
    state.selections.forEach((selection) => {
      if (selection.kind === 'area') {
        addSelection(
          { x: selection.cornerA[0], z: selection.cornerA[1] },
          { x: selection.cornerB[0], z: selection.cornerB[1] },
          { color: selection.color, updateUi: false },
        );
      } else {
        addShardSelection(
          {
            id: selection.assignmentId,
            shard: selection.shard,
            points: selection.points.map(([x, z]) => ({ x, z })),
          },
          { color: selection.color, updateUi: false },
        );
      }
    });
    worldBorder?.bringToBack();
    renderSelectionList();
    if (selections.length > 0) {
      inspector.classList.add('is-open');
      app.classList.add('inspector-open');
    }
    map.setView(blockToLatLng(state.view.x, state.view.z), state.view.zoom, {
      animate: false,
    });
    showShareToast('Shared setup loaded.');
  } catch (error) {
    showShareToast(
      error instanceof Error ? error.message : 'The shared setup could not be loaded.',
      true,
    );
  }
};

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
restoreSharedSetup();

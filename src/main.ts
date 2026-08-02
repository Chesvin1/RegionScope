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
} from './coordinates';
import { RegionGridLayer } from './grid-layer';
import { parseSearch } from './search';

type Theme = 'light' | 'dark';

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
  minZoom: -7,
  maxZoom: 3,
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
const blockBounds = getElement<HTMLElement>('block-bounds');
const chunkBounds = getElement<HTMLElement>('chunk-bounds');
const themeButton = getElement<HTMLButtonElement>('theme-button');
const themeIcon = getElement<HTMLElement>('theme-icon');
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

let highlight: L.Rectangle | undefined;

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
  inspector.classList.remove('is-open');
  app.classList.remove('inspector-open');
  inspectorEmpty.hidden = false;
  inspectorDetails.hidden = true;
};

const showRegion = (regionX: number, regionZ: number, shouldCenter: boolean): void => {
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
});

map.on('click', (event: L.LeafletMouseEvent) => {
  const block = latLngToBlock(event.latlng);
  const region = getRegionForBlock(block.x, block.z);
  showRegion(region.x, region.z, false);
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
  showRegion(result.region.x, result.region.z, true);
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

themeButton.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('regionscope-theme', theme);
  applyTheme();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeInspector();
  }
});

applyTheme();

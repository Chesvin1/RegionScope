import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { RegionGridLayer } from './grid-layer';

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

const gridLayer = new RegionGridLayer();
gridLayer.addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';

const map = L.map('map', {
  crs: L.CRS.Simple,
  center: [0, 0],
  zoom: -2,
  minZoom: -7,
  maxZoom: 3,
  attributionControl: false,
  zoomControl: false,
});

L.control.zoom({ position: 'bottomright' }).addTo(map);

void map;

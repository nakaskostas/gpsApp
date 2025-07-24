/* 100 % client-side route planner
 * Author: AI assistant
 * SPDX-License-Identifier: MIT
 */

const ORS_KEY = '5b3ce3597851110001cf6248c3f9f8d9e1f9466ca5a9d4b2b0cbe86e'; // demo key
const MAX_PINS = 20;

// --- Leaflet map ---
const map = L.map('map').fitWorld();
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OSM contributors'
}).addTo(map);

// Locate user on load
map.locate({ setView: true, maxZoom: 13 });

// --- State ---
let pins = [];            // {marker, latlng}
let routeLine = null;     // polyline
let elevationData = [];   // {lat, lng, ele, dist}
let totalGain = 0, totalLoss = 0;

// --- Canvas & chart ---
const canvas = document.getElementById('elevation');
const ctx = canvas.getContext('2d');
window.addEventListener('resize', () => drawElevation());

// --- Controls ---
document.getElementById('clearBtn').onclick = clearRoute;
document.getElementById('downloadBtn').onclick = downloadGPX;

// --- Map click handler ---
map.on('click', (e) => {
  if (pins.length >= MAX_PINS) return;
  addPin(e.latlng);
});

function addPin(latlng) {
  const isStart = pins.length === 0;
  const marker = L.circleMarker(latlng, {
    radius: 8,
    color: isStart ? '#22c55e' : '#3b82f6',
    fillOpacity: 1
  }).addTo(map);

  marker.bindTooltip(`${pins.length + 1}`, { permanent: true, direction: 'center', className: 'text-white font-bold' });

  pins.push({ marker, latlng });
  if (pins.length > 1) fetchRoute();
}

map.on('contextmenu', (e) => {
  // Remove nearest pin
  let closest = null, min = Infinity;
  pins.forEach((p, i) => {
    const d = e.latlng.distanceTo(p.latlng);
    if (d < min) { min = d; closest = i; }
  });
  if (closest !== null && min < 50) {
    map.removeLayer(pins[closest].marker);
    pins.splice(closest, 1);
    if (pins.length <= 1) clearRoute();
    else fetchRoute();
  }
});

// --- Routing ---
async function fetchRoute() {
  if (pins.length < 2) return;
  const coords = pins.map(p => [p.latlng.lng, p.latlng.lat]);
  const url = `https://api.openrouteservice.org/v2/directions/driving-car/geojson`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': ORS_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: coords })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    drawRoute(data);
    await fetchElevation(data.features[0].geometry.coordinates);
  } catch (err) {
    alert('Routing failed: ' + err.message);
  }
}

function drawRoute(data) {
  if (routeLine) map.removeLayer(routeLine);
  routeLine = L.geoJSON(data, {
    style: { color: '#8b5cf6', weight: 5 }
  }).addTo(map);
}

// --- Elevation ---
async function fetchElevation(coords) {
  // Batch Open-Elevation API (max 512 pts) – simplify long routes
  const max = 500;
  const step = Math.ceil(coords.length / max);
  const sampled = coords.filter((_, i) => i % step === 0);
  const payload = { locations: sampled.map(([lng, lat]) => ({ latitude: lat, longitude: lng })) };

  const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  const elevations = json.results;

  // Reconstruct distance
  let dist = 0;
  elevationData = [];
  for (let i = 0; i < elevations.length; i++) {
    if (i > 0) {
      const [lng1, lat1] = sampled[i - 1];
      const [lng2, lat2] = sampled[i];
      dist += L.latLng(lat1, lng1).distanceTo([lat2, lng2]);
    }
    const prev = elevationData[i - 1];
    if (prev) {
      const diff = elevations[i].elevation - prev.ele;
      if (diff > 0) totalGain += diff;
      else totalLoss -= diff;
    }
    elevationData.push({ lat: elevations[i].latitude, lng: elevations[i].longitude, ele: elevations[i].elevation, dist });
  }
  updateStats();
  drawElevation();
}

function drawElevation() {
  if (!elevationData.length) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);

  const minEle = Math.min(...elevationData.map(p => p.ele));
  const maxEle = Math.max(...elevationData.map(p => p.ele));
  const totalDist = elevationData[elevationData.length - 1].dist;

  const mapX = d => (d / totalDist) * width;
  const mapY = ele => height - ((ele - minEle) / (maxEle - minEle)) * height;

  // Draw area
  ctx.beginPath();
  ctx.moveTo(mapX(0), mapY(elevationData[0].ele));
  elevationData.forEach(p => ctx.lineTo(mapX(p.dist), mapY(p.ele)));
  ctx.lineTo(mapX(totalDist), height);
  ctx.lineTo(mapX(0), height);
  ctx.closePath();
  ctx.fillStyle = '#374151';
  ctx.fill();

  // Draw gradient line
  ctx.beginPath();
  for (let i = 0; i < elevationData.length - 1; i++) {
    const p1 = elevationData[i];
    const p2 = elevationData[i + 1];
    const slope = Math.atan2(p2.ele - p1.ele, p2.dist - p1.dist) * 180 / Math.PI;
    ctx.strokeStyle = Math.abs(slope) > 5 ? '#ef4444' : '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mapX(p1.dist), mapY(p1.ele));
    ctx.lineTo(mapX(p2.dist), mapY(p2.ele));
    ctx.stroke();
  }

  // Hover interaction
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / width;
    const dist = ratio * totalDist;
    const idx = elevationData.findIndex(p => p.dist >= dist);
    if (idx === -1) return;
    const p = elevationData[idx];
    const marker = L.circleMarker([p.lat, p.lng], { radius: 6, color: '#facc15', fillOpacity: 1 }).addTo(map);
    marker.bindTooltip(`${Math.round(p.ele)} m @ ${Math.round(p.dist / 1000 * 10) / 10} km`);
    canvas.onmouseleave = () => map.removeLayer(marker);
  };
}

function updateStats() {
  document.getElementById('dist').textContent = (elevationData.length ? (elevationData[elevationData.length - 1].dist / 1000).toFixed(1) : 0) + ' km';
  document.getElementById('gain').textContent = Math.round(totalGain) + ' m';
  document.getElementById('loss').textContent = Math.round(totalLoss) + ' m';
  document.getElementById('downloadBtn').classList.toggle('hidden', pins.length < 2);
}

function clearRoute() {
  pins.forEach(p => map.removeLayer(p.marker));
  if (routeLine) map.removeLayer(routeLine);
  pins = [];
  elevationData = [];
  totalGain = totalLoss = 0;
  updateStats();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// --- GPX Export ---
function downloadGPX() {
  if (!elevationData.length) return;
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RoutePlanner">
<trk><trkseg>`;
  elevationData.forEach(p => {
    gpx += `<trkpt lat="${p.lat}" lon="${p.lng}"><ele>${Math.round(p.ele)}</ele></trkpt>`;
  });
  gpx += `</trkseg></trk></gpx>`;
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'route.gpx';
  a.click();
  URL.revokeObjectURL(url);
}
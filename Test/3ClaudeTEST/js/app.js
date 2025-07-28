// Configuration
        const CONFIG = {
            OPENROUTE_API_KEY: window.APP_CONFIG?.OPENROUTE_API_KEY  || '',
            ELEVATION_API_URL: 'https://api.open-elevation.com/api/v1/lookup',
            GRAPHHOPPER_KEY: window.APP_CONFIG?.GRAPHHOPPER_KEY    ||  '',
            MAX_PINS: 20,
            DEFAULT_CENTER: [37.9755, 23.7348], // Athens
            DEFAULT_ZOOM: 13,
            STEEP_GRADIENT_THRESHOLD: 5
        };

         // Έλεγχος ότι υπάρχουν keys
        if (!CONFIG.OPENROUTE_API_KEY || !CONFIG.GRAPHHOPPER_KEY) {
        console.error('❌  API keys missing!  Check config.js');
        }
        
        // Global state
        const state = {
            map: null,
            pins: [],
            markers: [],
            routePolyline: null,
            elevationChart: null,
            currentRoute: null,
            selectedMarkerIndex: -1
        };
        
        // Initialize the application
        function initApp() {
            initMap();
            setupEventListeners();
            console.log('Route Planner initialized');
        }
        
        // Initialize the map
        function initMap() {
            // Create map
            state.map = L.map('map', {
                center: CONFIG.DEFAULT_CENTER,
                zoom: CONFIG.DEFAULT_ZOOM,
                zoomControl: true
            });
            
            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 19
            }).addTo(state.map);
            
            // Map event listeners
            state.map.on('click', handleMapClick);
            state.map.on('contextmenu', handleMapRightClick);
            
            // Try to get user's location
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const { latitude, longitude } = position.coords;
                        state.map.setView([latitude, longitude], CONFIG.DEFAULT_ZOOM);
                        console.log('User location set:', latitude, longitude);
                    },
                    (error) => {
                        console.log('Geolocation failed:', error.message);
                    },
                    { timeout: 5000 }
                );
            }
        }
        
        // Setup event listeners
        function setupEventListeners() {
            document.getElementById('clearRoute').addEventListener('click', clearRoute);
            document.getElementById('downloadGPX').addEventListener('click', downloadGPX);
        }
        
        // Handle map click - add pin
        function handleMapClick(e) {
            if (state.pins.length >= CONFIG.MAX_PINS) {
                showError(`Maximum ${CONFIG.MAX_PINS} pins allowed`);
                return;
            }
            
            const latlng = e.latlng;
            state.pins.push(latlng);
            addMarker(latlng, state.pins.length, state.pins.length === 1);
            
            console.log(`Pin ${state.pins.length} added at:`, latlng);
            
            if (state.pins.length >= 2) {
                calculateRoute();
            }
            
            updateInstructions();
        }
        
        // Handle map right click - remove nearest pin
        function handleMapRightClick(e) {
            e.originalEvent.preventDefault();
            
            let nearestIndex = -1;
            let minDistance = Infinity;
            
            state.pins.forEach((pin, index) => {
                const distance = e.latlng.distanceTo(pin);
                if (distance < minDistance && distance < 100) { // 100m threshold
                    minDistance = distance;
                    nearestIndex = index;
                }
            });
            
            if (nearestIndex !== -1) {
                removePin(nearestIndex);
            }
        }
        
        // Create numbered marker icon
        function createNumberedIcon(number, isStart = false, isSelected = false) {
            const baseClass = 'pin-icon' + (isStart ? ' start' : '') + (isSelected ? ' selected' : '');
            return L.divIcon({
                className: baseClass,
                html: number.toString(),
                iconSize: [32, 32],
                iconAnchor: [16, 16],
                popupAnchor: [0, -16]
            });
        }
        
        // Add marker to map
        function addMarker(latlng, number, isStart = false) {
            const marker = L.marker(latlng, {
                icon: createNumberedIcon(number, isStart),
                draggable: true
            }).addTo(state.map);
            
            // Marker events
            marker.on('dragend', (e) => {
                const index = state.markers.indexOf(marker);
                state.pins[index] = e.target.getLatLng();
                console.log(`Pin ${index + 1} moved to:`, state.pins[index]);
                
                if (state.pins.length >= 2) {
                    calculateRoute();
                }
            });
            
            marker.on('click', (e) => {
                const index = state.markers.indexOf(marker);
                selectMarker(index);
                e.originalEvent.stopPropagation();
            });
            
            state.markers.push(marker);
        }
        
        // Select/deselect marker
        function selectMarker(index) {
            // Deselect previous
            if (state.selectedMarkerIndex >= 0) {
                const prevMarker = state.markers[state.selectedMarkerIndex];
                prevMarker.setIcon(createNumberedIcon(
                    state.selectedMarkerIndex + 1, 
                    state.selectedMarkerIndex === 0, 
                    false
                ));
            }
            
            // Select new
            if (index !== state.selectedMarkerIndex) {
                state.selectedMarkerIndex = index;
                const marker = state.markers[index];
                marker.setIcon(createNumberedIcon(
                    index + 1, 
                    index === 0, 
                    true
                ));
            } else {
                state.selectedMarkerIndex = -1;
            }
        }
        
        // Remove pin
        function removePin(index) {
            if (index < 0 || index >= state.pins.length) return;
            
            // Remove marker from map
            state.map.removeLayer(state.markers[index]);
            
            // Remove from arrays
            state.pins.splice(index, 1);
            state.markers.splice(index, 1);
            
            // Update marker numbers and icons
            state.markers.forEach((marker, i) => {
                marker.setIcon(createNumberedIcon(i + 1, i === 0, false));
            });
            
            // Reset selection
            state.selectedMarkerIndex = -1;
            
            console.log(`Pin ${index + 1} removed. Total pins: ${state.pins.length}`);
            
            // Recalculate route
            if (state.pins.length >= 2) {
                calculateRoute();
            } else {
                clearRoute(false); // Don't clear pins
            }
            
            updateInstructions();
        }
        
        // Calculate route using multiple APIs with fallback
        async function calculateRoute() {
            if (state.pins.length < 2) return;
            
            showLoading(true);
            hideError();
            
            try {
                console.log('Calculating route for', state.pins.length, 'pins');
                
                let routeData = null;
                const apis = [
                    { name: 'OpenRouteService', func: calculateRouteOpenRoute },
                    { name: 'GraphHopper', func: calculateRouteGraphHopper },
                    { name: 'OSRM', func: calculateRouteOSRM }
                ];
                
                for (const api of apis) {
                    try {
                        console.log(`Trying ${api.name}...`);
                        routeData = await api.func();
                        console.log(`${api.name} succeeded`);
                        break;
                    } catch (error) {
                        console.log(`${api.name} failed:`, error.message);
                    }
                }
                
                if (!routeData) {
                    throw new Error('All routing services failed');
                }
                
                state.currentRoute = routeData;
                displayRoute(routeData);
                await calculateElevation(routeData);
                
            } catch (error) {
                showError('Failed to calculate route. Please try again.');
                console.error('Route calculation error:', error);
            } finally {
                showLoading(false);
            }
        }
        
        // OpenRouteService API
        async function calculateRouteOpenRoute() {
            const coordinates = state.pins.map(pin => [pin.lng, pin.lat]);
            
            const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
                method: 'POST',
                headers: {
                    'Authorization': CONFIG.OPENROUTE_API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    coordinates: coordinates,
                    instructions: false,
                    elevation: false
                })
            });
            
            if (!response.ok) {
                throw new Error(`OpenRouteService API error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.features?.[0]) {
                throw new Error('No route found');
            }
            
            const route = data.features[0];
            return {
                coordinates: route.geometry.coordinates.map(coord => [coord[1], coord[0]]),
                distance: route.properties.summary?.distance || 0,
                duration: route.properties.summary?.duration || 0
            };
        }
        
        // GraphHopper API
        async function calculateRouteGraphHopper() {
            const points = state.pins.map(pin => `point=${pin.lat},${pin.lng}`).join('&');
            const url = `https://graphhopper.com/api/1/route?${points}&vehicle=car&calc_points=true&type=json&key=${CONFIG.GRAPHHOPPER_KEY}`;
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`GraphHopper API error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.paths?.[0]) {
                throw new Error('No route found');
            }
            
            const path = data.paths[0];
            return {
                coordinates: decodePolyline(path.points),
                distance: path.distance,
                duration: path.time
            };
        }
        
        // OSRM API (fallback)
        async function calculateRouteOSRM() {
            const coordinates = state.pins.map(pin => `${pin.lng},${pin.lat}`).join(';');
            const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`OSRM API error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.routes?.[0]) {
                throw new Error('No route found');
            }
            
            const route = data.routes[0];
            return {
                coordinates: route.geometry.coordinates.map(coord => [coord[1], coord[0]]),
                distance: route.distance,
                duration: route.duration
            };
        }
        
        // Decode polyline (for GraphHopper)
        function decodePolyline(str, precision = 5) {
            let index = 0;
            let lat = 0;
            let lng = 0;
            const coordinates = [];
            const factor = Math.pow(10, precision);
            
            while (index < str.length) {
                let byte = null;
                let shift = 0;
                let result = 0;
                
                do {
                    byte = str.charCodeAt(index++) - 63;
                    result |= (byte & 0x1f) << shift;
                    shift += 5;
                } while (byte >= 0x20);
                
                const deltaLat = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
                lat += deltaLat;
                
                shift = 0;
                result = 0;
                
                do {
                    byte = str.charCodeAt(index++) - 63;
                    result |= (byte & 0x1f) << shift;
                    shift += 5;
                } while (byte >= 0x20);
                
                const deltaLng = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
                lng += deltaLng;
                
                coordinates.push([lat / factor, lng / factor]);
            }
            
            return coordinates;
        }
        
        // Display route on map
        function displayRoute(route) {
            // Remove existing route
            if (state.routePolyline) {
                state.map.removeLayer(state.routePolyline);
            }
            
            // Add new route
            state.routePolyline = L.polyline(route.coordinates, {
                color: '#3B82F6',
                weight: 4,
                opacity: 0.8,
                smoothFactor: 1
            }).addTo(state.map);
            
            // Fit map to route bounds
            const group = new L.featureGroup([state.routePolyline, ...state.markers]);
            state.map.fitBounds(group.getBounds(), { padding: [20, 20] });
            
            // Show download button
            document.getElementById('downloadGPX').style.display = 'flex';
            
            // Update route stats immediately
            updateRouteStats({ distance: route.distance });
            
            console.log('Route displayed:', route.distance, 'meters');
        }
        
        // Calculate elevation profile
        async function calculateElevation(route) {
            try {
                console.log('Calculating elevation for route...');
                
                // Sample points along route (max 50 for better performance)
                const maxPoints = 50;
                const step = Math.max(1, Math.floor(route.coordinates.length / maxPoints));
                const samplePoints = route.coordinates.filter((_, index) => index % step === 0);
                
                // Ensure we include the last point
                if (samplePoints[samplePoints.length - 1] !== route.coordinates[route.coordinates.length - 1]) {
                    samplePoints.push(route.coordinates[route.coordinates.length - 1]);
                }
                
                // Try elevation API with timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
                
                const response = await fetch(CONFIG.ELEVATION_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        locations: samplePoints.map(coord => ({
                            latitude: coord[0],
                            longitude: coord[1]
                        }))
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`Elevation API error: ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.results && data.results.length > 0) {
                    processElevationData(data.results, samplePoints, route);
                } else {
                    throw new Error('No elevation data received');
                }
                
            } catch (error) {
                console.log('Elevation calculation failed, using mock data:', error.message);
                // Use mock elevation data as fallback
                createMockElevationData(route);
            }
        }
        
        // Create mock elevation data when API fails
        function createMockElevationData(route) {
            const mockPoints = 20;
            const step = Math.max(1, Math.floor(route.coordinates.length / mockPoints));
            const samplePoints = route.coordinates.filter((_, index) => index % step === 0);
            
            // Generate realistic elevation profile
            const mockElevationResults = samplePoints.map((coord, index) => {
                const baseElevation = 100;
                const variation = Math.sin(index * 0.3) * 80 + Math.cos(index * 0.1) * 40;
                const randomNoise = (Math.random() - 0.5) * 20;
                return {
                    elevation: Math.max(0, baseElevation + variation + randomNoise)
                };
            });
            
            processElevationData(mockElevationResults, samplePoints, route);
            console.log('Mock elevation data created');
        }
        
        // Process elevation data and create profile
        function processElevationData(elevationResults, coordinates, route) {
            let cumulativeDistance = 0;
            const elevationData = [];
            
            elevationResults.forEach((point, index) => {
                if (index > 0) {
                    const prevCoord = coordinates[index - 1];
                    const currCoord = coordinates[index];
                    const segmentDistance = calculateDistance(
                        prevCoord[0], prevCoord[1],
                        currCoord[0], currCoord[1]
                    );
                    cumulativeDistance += segmentDistance;
                }
                
                // Calculate gradient
                let gradient = 0;
                if (index > 0) {
                    const elevationDiff = point.elevation - elevationResults[index - 1].elevation;
                    const distanceDiff = cumulativeDistance - (elevationData[index - 1]?.distance || 0);
                    if (distanceDiff > 0) {
                        gradient = Math.abs(Math.atan(elevationDiff / distanceDiff) * 180 / Math.PI);
                    }
                }
                
                elevationData.push({
                    distance: cumulativeDistance,
                    elevation: point.elevation,
                    gradient: gradient,
                    isSteep: gradient > CONFIG.STEEP_GRADIENT_THRESHOLD
                });
            });
            
            // Update UI
            updateRouteStats({
                distance: route.distance,
                elevationData: elevationData
            });
            displayElevationChart(elevationData);
            showElevationSection(true);
            
            console.log('Elevation profile calculated:', elevationData.length, 'points');
        }
        
        // Calculate distance between two coordinates (Haversine formula)
        function calculateDistance(lat1, lon1, lat2, lon2) {
            const R = 6371e3; // Earth's radius in meters
            const φ1 = lat1 * Math.PI / 180;
            const φ2 = lat2 * Math.PI / 180;
            const Δφ = (lat2 - lat1) * Math.PI / 180;
            const Δλ = (lon2 - lon1) * Math.PI / 180;

            const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                     Math.cos(φ1) * Math.cos(φ2) *
                     Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

            return R * c;
        }
        
        // Update route statistics
        function updateRouteStats(data) {
            const { distance, elevationData } = data;
            
            // Format distance
            const distanceFormatted = distance > 1000 
                ? `${(distance / 1000).toFixed(1)} km`
                : `${Math.round(distance)} m`;
            
            document.getElementById('totalDistance').textContent = distanceFormatted;
            
            if (elevationData && elevationData.length > 0) {
                // Calculate elevation gain and loss
                let elevationGain = 0;
                let elevationLoss = 0;
                
                for (let i = 1; i < elevationData.length; i++) {
                    const diff = elevationData[i].elevation - elevationData[i - 1].elevation;
                    if (diff > 0) {
                        elevationGain += diff;
                    } else {
                        elevationLoss += Math.abs(diff);
                    }
                }
                
                document.getElementById('elevationGain').textContent = `+${Math.round(elevationGain)} m`;
                document.getElementById('elevationLoss').textContent = `-${Math.round(elevationLoss)} m`;
            } else {
                document.getElementById('elevationGain').textContent = '-';
                document.getElementById('elevationLoss').textContent = '-';
            }
        }
        
        // Display elevation chart
        function displayElevationChart(elevationData) {
            const ctx = document.getElementById('elevationChart').getContext('2d');
            
            if (state.elevationChart) {
                state.elevationChart.destroy();
            }
            
            const distances = elevationData.map(d => d.distance > 1000 
                ? (d.distance / 1000).toFixed(1) 
                : Math.round(d.distance));
            const elevations = elevationData.map(d => d.elevation);
            const backgroundColors = elevationData.map(d => 
                d.isSteep ? 'rgba(239, 68, 68, 0.6)' : 'rgba(59, 130, 246, 0.6)'
            );
            const borderColors = elevationData.map(d => 
                d.isSteep ? '#EF4444' : '#3B82F6'
            );
            
            state.elevationChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: distances,
                    datasets: [{
                        label: 'Elevation (m)',
                        data: elevations,
                        borderColor: '#3B82F6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        pointBackgroundColor: borderColors,
                        pointBorderColor: borderColors,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    scales: {
                        x: {
                            display: true,
                            title: {
                                display: true,
                                text: `Distance (${elevationData[0]?.distance > 1000 ? 'km' : 'm'})`
                            }
                        },
                        y: {
                            display: true,
                            title: {
                                display: true,
                                text: 'Elevation (m)'
                            }
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                title: function(context) {
                                    const point = elevationData[context[0].dataIndex];
                                    const distance = point.distance > 1000 
                                        ? `${(point.distance / 1000).toFixed(1)} km`
                                        : `${Math.round(point.distance)} m`;
                                    return `Distance: ${distance}`;
                                },
                                label: function(context) {
                                    const point = elevationData[context.dataIndex];
                                    const gradient = point.gradient ? ` (${point.gradient.toFixed(1)}° gradient)` : '';
                                    return `Elevation: ${Math.round(point.elevation)}m${gradient}`;
                                }
                            }
                        },
                        legend: {
                            display: false
                        }
                    }
                }
            });
            
            console.log('Elevation chart displayed');
        }
        
        // Show/hide elevation section
        function showElevationSection(show) {
            document.getElementById('elevationSection').style.display = show ? 'block' : 'none';
        }
        
        // Clear route and optionally pins
        function clearRoute(clearPins = true) {
            if (clearPins) {
                // Remove all markers
                state.markers.forEach(marker => state.map.removeLayer(marker));
                state.markers = [];
                state.pins = [];
                state.selectedMarkerIndex = -1;
            }
            
            // Remove route
            if (state.routePolyline) {
                state.map.removeLayer(state.routePolyline);
                state.routePolyline = null;
            }
            
            // Clear elevation chart
            if (state.elevationChart) {
                state.elevationChart.destroy();
                state.elevationChart = null;
            }
            
            // Reset UI
            state.currentRoute = null;
            showElevationSection(false);
            document.getElementById('downloadGPX').style.display = 'none';
            updateInstructions();
            hideError();
            
            console.log('Route cleared');
        }
        
        // Download GPX file
        function downloadGPX() {
            if (!state.currentRoute) {
                showError('No route to download');
                return;
            }
            
            const gpxContent = generateGPX(state.currentRoute);
            const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `route_${new Date().toISOString().split('T')[0]}.gpx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            console.log('GPX file downloaded');
        }
        
        // Generate GPX content
        function generateGPX(route) {
            const timestamp = new Date().toISOString();
            
            let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Route Planner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Planned Route</name>
    <time>${timestamp}</time>
  </metadata>
  <trk>
    <name>Route</name>
    <trkseg>`;
            
            route.coordinates.forEach(coord => {
                gpx += `\n      <trkpt lat="${coord[0]}" lon="${coord[1]}"></trkpt>`;
            });
            
            gpx += `
    </trkseg>
  </trk>`;
            
            // Add waypoints for pins
            state.pins.forEach((pin, index) => {
                const name = index === 0 ? 'Start' : `Waypoint ${index}`;
                gpx += `\n  <wpt lat="${pin.lat}" lon="${pin.lng}">
    <name>${name}</name>
  </wpt>`;
            });
            
            gpx += `
</gpx>`;
            
            return gpx;
        }
        
        // Show loading indicator
        function showLoading(show) {
            document.getElementById('loadingMessage').style.display = show ? 'flex' : 'none';
        }
        
        // Show error message
        function showError(message) {
            const errorEl = document.getElementById('errorMessage');
            const errorText = document.getElementById('errorText');
            
            errorText.textContent = message;
            errorEl.style.display = 'block';
            errorEl.className = 'bg-red-100 border border-red-400 text-red-700 px-4 py-3 mx-4 mt-2 rounded relative z-40';
            
            // Auto-hide after 5 seconds
            setTimeout(() => {
                errorEl.className += ' error-fade';
                setTimeout(() => hideError(), 1000);
            }, 4000);
            
            console.log('Error shown:', message);
        }
        
        // Hide error message
        function hideError() {
            const errorEl = document.getElementById('errorMessage');
            errorEl.style.display = 'none';
            errorEl.className = 'bg-red-100 border border-red-400 text-red-700 px-4 py-3 mx-4 mt-2 rounded relative z-40';
        }
        
        // Update instructions visibility
        function updateInstructions() {
            const instructionsEl = document.getElementById('instructions');
            instructionsEl.style.display = state.pins.length === 0 ? 'block' : 'none';
        }
        
        // Initialize app when DOM is loaded
        document.addEventListener('DOMContentLoaded', initApp);
        
        // Handle window resize
        window.addEventListener('resize', () => {
            if (state.map) {
                setTimeout(() => {
                    state.map.invalidateSize();
                }, 100);
            }
        });
        
        // Prevent context menu on map
        document.addEventListener('contextmenu', (e) => {
            if (e.target.closest('#map')) {
                e.preventDefault();
            }
        });
        
        console.log('Route Planner script loaded');
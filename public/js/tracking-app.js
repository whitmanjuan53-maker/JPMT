/**
 * JPMT Logistics - Advanced Tracking Application
 * Real-time shipment tracking with actual routing and live animation
 */

(function() {
  'use strict';

  const CONFIG = {
    API_BASE_URL: window.location.hostname === 'localhost' 
      ? 'http://localhost:3001/api' 
      : '/api',
    OSRM_URL: 'https://router.project-osrm.org/route/v1/driving/',
    MAP_CENTER: [39.8283, -98.5795],
    MAP_ZOOM: 5,
    ANIMATION_SPEED: 50, // ms between updates
    TRUCK_SPEED: 0.0002, // Progress increment per frame
  };

  // Demo shipments with real coordinates
  const DEMO_SHIPMENTS = {
    'in-transit': {
      trackingNumber: 'JPMT-2024-8842',
      status: 'in_transit',
      carrierType: 'jpmt_fleet',
      carrierName: 'JPMT Fleet',
      origin: {
        address: '4500 Logistics Parkway, Chicago, IL',
        city: 'Chicago',
        state: 'IL',
        coordinates: { lat: 41.8781, lng: -87.6298 }
      },
      destination: {
        address: '2500 Commerce Drive, Minneapolis, MN',
        city: 'Minneapolis',
        state: 'MN',
        coordinates: { lat: 44.9778, lng: -93.265 }
      },
      currentProgress: 0.45, // 45% complete
      estimatedDelivery: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
      events: [
        {
          status: 'in_transit',
          timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
          description: 'On schedule - Passing through Madison',
          location: { city: 'Madison', state: 'WI' }
        },
        {
          status: 'picked_up',
          timestamp: new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString(),
          description: 'Shipment picked up by driver Mike R.',
          location: { city: 'Chicago', state: 'IL' }
        },
        {
          status: 'created',
          timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          description: 'Shipment created',
          location: null
        }
      ]
    },
    'delivered': {
      trackingNumber: 'UPS-1Z999AA101234',
      status: 'delivered',
      carrierType: 'ups',
      carrierName: 'UPS',
      origin: {
        address: '123 Industrial Blvd, Detroit, MI',
        city: 'Detroit',
        state: 'MI',
        coordinates: { lat: 42.3314, lng: -83.0458 }
      },
      destination: {
        address: '456 Commerce St, Cleveland, OH',
        city: 'Cleveland',
        state: 'OH',
        coordinates: { lat: 41.4993, lng: -81.6944 }
      },
      currentProgress: 1.0,
      estimatedDelivery: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      actualDelivery: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      events: [
        {
          status: 'delivered',
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          description: 'Delivered - Signed by J. Smith',
          location: { city: 'Cleveland', state: 'OH' }
        },
        {
          status: 'out_for_delivery',
          timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
          description: 'Out for delivery',
          location: { city: 'Cleveland', state: 'OH' }
        },
        {
          status: 'in_transit',
          timestamp: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(),
          description: 'Arrived at Cleveland facility',
          location: { city: 'Cleveland', state: 'OH' }
        }
      ]
    },
    'delayed': {
      trackingNumber: 'FEDEX-784321569',
      status: 'delayed',
      carrierType: 'fedex',
      carrierName: 'FedEx Ground',
      origin: {
        address: '789 Warehouse Dr, Indianapolis, IN',
        city: 'Indianapolis',
        state: 'IN',
        coordinates: { lat: 39.7684, lng: -86.1581 }
      },
      destination: {
        address: '321 Business Pkwy, Columbus, OH',
        city: 'Columbus',
        state: 'OH',
        coordinates: { lat: 39.9612, lng: -82.9988 }
      },
      currentProgress: 0.25,
      estimatedDelivery: new Date(Date.now() + 28 * 60 * 60 * 1000).toISOString(),
      events: [
        {
          status: 'delayed',
          timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
          description: 'Delay due to severe weather - 24hr delay',
          location: { city: 'Indianapolis', state: 'IN' }
        },
        {
          status: 'in_transit',
          timestamp: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
          description: 'Departed Indianapolis hub',
          location: { city: 'Indianapolis', state: 'IN' }
        }
      ]
    },
    'out-for-delivery': {
      trackingNumber: 'USPS-940010000000',
      status: 'out_for_delivery',
      carrierType: 'usps',
      carrierName: 'USPS Priority',
      origin: {
        address: '555 Postal Way, Milwaukee, WI',
        city: 'Milwaukee',
        state: 'WI',
        coordinates: { lat: 43.0389, lng: -87.9065 }
      },
      destination: {
        address: '888 Residential Ave, Milwaukee, WI',
        city: 'Milwaukee',
        state: 'WI',
        coordinates: { lat: 43.0589, lng: -87.9265 }
      },
      currentProgress: 0.88,
      estimatedDelivery: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      events: [
        {
          status: 'out_for_delivery',
          timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          description: 'Out for delivery - arriving by 5:00 PM',
          location: { city: 'Milwaukee', state: 'WI' }
        },
        {
          status: 'in_transit',
          timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
          description: 'Arrived at Milwaukee distribution center',
          location: { city: 'Milwaukee', state: 'WI' }
        }
      ]
    }
  };

  // State
  const state = {
    map: null,
    routeLayer: null,
    truckMarker: null,
    markers: {},
    routeCoords: [],
    animationId: null,
    currentProgress: 0,
    isAnimating: false,
    shipment: null,
    isDemo: false,
  };

  // DOM Elements
  const els = {
    form: document.getElementById('tracking-form'),
    input: document.getElementById('tracking-input'),
    btn: document.getElementById('track-btn'),
    loading: document.getElementById('tracking-loading'),
    error: document.getElementById('tracking-error'),
    results: document.getElementById('tracking-results'),
    trackingNumber: document.getElementById('display-tracking-number'),
    statusBadge: document.getElementById('tracking-status'),
    statusText: document.getElementById('status-text'),
    connectionStatus: document.getElementById('connection-status'),
    progressLine: document.getElementById('progress-line'),
    infoEta: document.getElementById('info-eta'),
    infoOrigin: document.getElementById('info-origin'),
    infoDestination: document.getElementById('info-destination'),
    infoCarrier: document.getElementById('info-carrier'),
    timeline: document.getElementById('timeline'),
    mapDistance: document.getElementById('map-distance'),
    mapTime: document.getElementById('map-time'),
    mapProgress: document.getElementById('map-progress'),
  };

  function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const tn = urlParams.get('tn');
    if (tn) {
      els.input.value = tn;
      trackShipment(tn);
    }

    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const tn = els.input.value.trim();
      if (tn) {
        window.history.pushState({}, '', `?tn=${tn}`);
        trackShipment(tn);
      }
    });
  }

  window.loadDemo = function(type) {
    const demo = DEMO_SHIPMENTS[type];
    if (demo) {
      els.input.value = demo.trackingNumber;
      window.history.pushState({}, '', `?tn=${demo.trackingNumber}`);
      state.isDemo = true;
      displayShipment(demo);
      initMap(demo);
    }
  };

  async function trackShipment(trackingNumber) {
    resetState();
    showLoading();

    try {
      const response = await fetch(`${CONFIG.API_BASE_URL}/tracking/${trackingNumber}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          showError();
          return;
        }
        throw new Error('Failed to fetch');
      }

      const result = await response.json();
      
      if (result.success && result.data) {
        state.shipment = result.data;
        displayShipment(result.data);
        initMap(result.data);
      } else {
        showError();
      }
    } catch (error) {
      console.error('Tracking error:', error);
      showError();
    }
  }

  function displayShipment(data) {
    hideLoading();
    hideError();
    els.results.classList.add('active');

    els.trackingNumber.textContent = data.trackingNumber;
    updateStatus(data.status);
    updateProgressSteps(data.status);

    els.infoEta.textContent = data.estimatedDelivery 
      ? formatDate(new Date(data.estimatedDelivery))
      : 'Not available';
    els.infoOrigin.textContent = `${data.origin.city}, ${data.origin.state}`;
    els.infoDestination.textContent = `${data.destination.city}, ${data.destination.state}`;
    els.infoCarrier.textContent = data.carrierName;

    updateTimeline(data.events || []);
    updateConnectionStatus('live');
  }

  function updateStatus(status) {
    const config = {
      'created': { label: 'Created', class: 'status-created' },
      'picked_up': { label: 'Picked Up', class: 'status-picked-up' },
      'in_transit': { label: 'In Transit', class: 'status-in-transit' },
      'out_for_delivery': { label: 'Out for Delivery', class: 'status-out-for-delivery' },
      'delivered': { label: 'Delivered', class: 'status-delivered' },
      'delayed': { label: 'Delayed', class: 'status-delayed' },
      'exception': { label: 'Exception', class: 'status-exception' },
    };

    const c = config[status] || { label: status, class: '' };
    els.statusText.textContent = c.label;
    els.statusBadge.className = `status-badge ${c.class}`;
  }

  function updateProgressSteps(status) {
    const steps = ['created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'];
    const idx = steps.indexOf(status);

    steps.forEach((step, i) => {
      const el = document.querySelector(`[data-step="${step}"]`);
      if (!el) return;
      el.classList.remove('completed', 'active');
      if (i < idx) el.classList.add('completed');
      if (i === idx) el.classList.add('active');
    });

    els.progressLine.style.width = `${(idx / (steps.length - 1)) * 100}%`;
  }

  function updateTimeline(events) {
    if (!events.length) {
      els.timeline.innerHTML = '<p style="color: #64748b; text-align: center;">No events yet</p>';
      return;
    }

    const sorted = [...events].sort((a, b) => 
      new Date(b.timestamp || b.eventTimestamp) - new Date(a.timestamp || a.eventTimestamp)
    );

    els.timeline.innerHTML = sorted.map((e, i) => `
      <div class="timeline-item">
        <div class="timeline-dot ${i === 0 ? 'current' : 'completed'}"></div>
        <div class="timeline-content">
          <div class="timeline-header-row">
            <span class="timeline-event-title">${getStatusLabel(e.status)}</span>
            <span class="timeline-event-time">${timeAgo(new Date(e.timestamp || e.eventTimestamp))}</span>
          </div>
          <div style="color: #64748b; font-size: 0.85rem;">${e.description}</div>
          ${e.location?.city ? `<div class="timeline-location">📍 ${e.location.city}, ${e.location.state}</div>` : ''}
        </div>
      </div>
    `).join('');
  }

  async function initMap(data) {
    const container = document.getElementById('tracking-map');
    if (!container) return;

    if (state.map) {
      state.map.remove();
      state.map = null;
    }

    // Create map
    state.map = L.map('tracking-map', {
      zoomControl: false,
      attributionControl: false
    }).setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);

    // Add tile layer - using CartoDB Positron for clean look
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(state.map);

    // Add attribution manually in better position
    L.control.attribution({ position: 'bottomright' }).addTo(state.map);

    const origin = [data.origin.coordinates.lat, data.origin.coordinates.lng];
    const dest = [data.destination.coordinates.lat, data.destination.coordinates.lng];

    // Add markers
    const originIcon = L.divIcon({
      className: 'location-marker-icon origin',
      iconSize: [20, 20]
    });

    const destIcon = L.divIcon({
      className: 'location-marker-icon destination',
      iconSize: [20, 20]
    });

    L.marker(origin, { icon: originIcon })
      .addTo(state.map)
      .bindPopup(`<div class="route-popup"><div class="route-popup-title">Origin</div><div class="route-popup-desc">${data.origin.city}</div></div>`);

    L.marker(dest, { icon: destIcon })
      .addTo(state.map)
      .bindPopup(`<div class="route-popup"><div class="route-popup-title">Destination</div><div class="route-popup-desc">${data.destination.city}</div></div>`);

    // Fetch real route
    try {
      const route = await fetchRoute(origin, dest);
      state.routeCoords = route;

      // Draw route
      state.routeLayer = L.polyline(route, {
        color: '#0066FF',
        weight: 5,
        opacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(state.map);

      // Fit bounds
      state.map.fitBounds(state.routeLayer.getBounds(), { padding: [50, 50] });

      // Add truck marker
      const truckIcon = L.divIcon({
        className: 'truck-marker-icon',
        html: `<svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
        iconSize: [44, 44]
      });

      // Calculate initial position based on progress
      const progress = data.currentProgress || 0;
      const coordIndex = Math.floor(progress * (route.length - 1));
      const initialPos = route[Math.min(coordIndex, route.length - 1)];

      state.truckMarker = L.marker(initialPos, { icon: truckIcon, zIndexOffset: 1000 })
        .addTo(state.map)
        .bindPopup('<div class="route-popup"><div class="route-popup-title">Current Location</div><div class="route-popup-desc">Shipment in transit</div></div>');

      // Calculate stats
      const totalDistance = calculateRouteDistance(route);
      const remainingDistance = totalDistance * (1 - progress);
      const hoursLeft = Math.ceil(remainingDistance / 55);

      els.mapDistance.textContent = Math.round(totalDistance);
      els.mapTime.textContent = hoursLeft;
      els.mapProgress.textContent = Math.round(progress * 100) + '%';

      // Start animation if in transit
      if (data.status === 'in_transit' || data.status === 'out_for_delivery') {
        startTruckAnimation(route, progress);
      }

    } catch (err) {
      console.error('Route fetch failed:', err);
      // Fallback to straight line
      state.routeCoords = [origin, dest];
      state.routeLayer = L.polyline([origin, dest], {
        color: '#0066FF',
        weight: 4,
        opacity: 0.6,
        dashArray: '10, 10'
      }).addTo(state.map);
      state.map.fitBounds(state.routeLayer.getBounds(), { padding: [50, 50] });
    }
  }

  async function fetchRoute(start, end) {
    const url = `${CONFIG.OSRM_URL}${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.code === 'Ok' && data.routes.length > 0) {
      // Convert [lng, lat] to [lat, lng]
      return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    }
    throw new Error('No route found');
  }

  function calculateRouteDistance(coords) {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      total += haversineDistance(coords[i], coords[i + 1]);
    }
    return total;
  }

  function haversineDistance(p1, p2) {
    const R = 3959; // Earth's radius in miles
    const dLat = (p2[0] - p1[0]) * Math.PI / 180;
    const dLng = (p2[1] - p1[1]) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(p1[0] * Math.PI / 180) * Math.cos(p2[0] * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function startTruckAnimation(route, startProgress) {
    if (state.isAnimating) return;
    
    state.isAnimating = true;
    state.currentProgress = startProgress;

    function animate() {
      if (!state.isAnimating) return;

      state.currentProgress += CONFIG.TRUCK_SPEED;
      
      if (state.currentProgress >= 1) {
        state.currentProgress = 1;
        state.isAnimating = false;
      }

      const idx = Math.floor(state.currentProgress * (route.length - 1));
      const pos = route[Math.min(idx, route.length - 1)];
      
      if (state.truckMarker) {
        state.truckMarker.setLatLng(pos);
      }

      // Update stats
      els.mapProgress.textContent = Math.round(state.currentProgress * 100) + '%';

      if (state.isAnimating) {
        state.animationId = setTimeout(() => requestAnimationFrame(animate), CONFIG.ANIMATION_SPEED);
      }
    }

    animate();
  }

  // Map control functions
  window.zoomIn = function() {
    state.map?.zoomIn();
  };

  window.zoomOut = function() {
    state.map?.zoomOut();
  };

  window.fitBounds = function() {
    if (state.routeLayer && state.map) {
      state.map.fitBounds(state.routeLayer.getBounds(), { padding: [50, 50] });
    }
  };

  window.resetTracking = function() {
    hideError();
    els.input.value = '';
    els.input.focus();
  };

  function resetState() {
    state.isAnimating = false;
    if (state.animationId) {
      clearTimeout(state.animationId);
      state.animationId = null;
    }
    state.isDemo = false;
    state.shipment = null;
  }

  function showLoading() {
    els.results.classList.remove('active');
    els.error.classList.remove('active');
    els.loading.classList.add('active');
    els.btn.disabled = true;
    els.btn.innerHTML = '<span class="spinner" style="width: 20px; height: 20px; margin: 0; border-width: 2px; display: inline-block; vertical-align: middle;"></span> Loading...';
  }

  function hideLoading() {
    els.loading.classList.remove('active');
    els.btn.disabled = false;
    els.btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
      Track Shipment
    `;
  }

  function showError() {
    hideLoading();
    els.results.classList.remove('active');
    els.error.classList.add('active');
  }

  function hideError() {
    els.error.classList.remove('active');
  }

  function updateConnectionStatus(status) {
    const config = {
      live: { class: 'connection-live', text: 'Live Updates' },
      polling: { class: 'connection-polling', text: 'Updating...' },
      offline: { class: 'connection-offline', text: 'Reconnecting...' },
    };
    const c = config[status];
    if (c) {
      els.connectionStatus.className = `connection-status ${c.class}`;
      els.connectionStatus.querySelector('.status-text').textContent = c.text;
    }
  }

  function getStatusLabel(s) {
    const labels = {
      'created': 'Created', 'picked_up': 'Picked Up', 'in_transit': 'In Transit',
      'out_for_delivery': 'Out for Delivery', 'delivered': 'Delivered',
      'delayed': 'Delayed', 'exception': 'Exception', 'returned': 'Returned'
    };
    return labels[s] || s;
  }

  function formatDate(d) {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function timeAgo(date) {
    const now = new Date();
    const diff = now - date;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) {
      const mins = Math.floor(diff / (1000 * 60));
      return mins < 1 ? 'Just now' : `${mins}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else if (days < 7) {
      return `${days}d ago`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.JpmtTracking = { state, trackShipment };
})();

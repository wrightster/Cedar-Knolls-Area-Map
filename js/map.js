/* ============================================================
   Cedar Knolls Area Map — map.js
   ============================================================ */

(function () {
  'use strict';

  // --- State -----------------------------------------------
  let map;
  let allData;
  let layerGroups = {};      // { categoryId: L.LayerGroup }
  let activeCategories = new Set(['all']);
  let currentPlace = null;

  // --- DOM refs --------------------------------------------
  const filterBar   = document.getElementById('filter-bar');
  const sidePanel   = document.getElementById('side-panel');
  const panelClose  = document.getElementById('panel-close');
  const panelBadge  = document.getElementById('panel-category-badge');
  const panelName   = document.getElementById('panel-name');
  const panelMeta   = document.getElementById('panel-meta');
  const panelAddr   = document.getElementById('panel-address');
  const panelPhone  = document.getElementById('panel-phone');
  const panelWeb    = document.getElementById('panel-website');
  const panelGmaps  = document.getElementById('panel-gmaps');

  // --- Init map --------------------------------------------
  function initMap(center) {
    map = L.map('map', {
      center: [center.lat, center.lng],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
          '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }
    ).addTo(map);
  }

  // --- Home marker -----------------------------------------
  function addHomeMarker(center) {
    const homeIcon = L.divIcon({
      className: 'home-marker-icon',
      html: '<div style="' +
        'width:18px;height:18px;' +
        'background:#1a3a2a;' +
        'border:3px solid #fff;' +
        'border-radius:50%;' +
        'box-shadow:0 0 0 2px #1a3a2a,0 2px 6px rgba(0,0,0,0.35);' +
        '"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    L.marker([center.lat, center.lng], { icon: homeIcon, zIndexOffset: 1000 })
      .addTo(map)
      .bindTooltip(center.label, { permanent: false, direction: 'top', offset: [0, -10] });
  }

  // --- Build category filter buttons -----------------------
  function buildFilterButtons(categories) {
    categories.forEach(function (cat) {
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.dataset.category = cat.id;
      btn.setAttribute('aria-pressed', 'false');

      const dot = document.createElement('span');
      dot.className = 'filter-dot';
      dot.style.background = cat.color;

      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(cat.label));
      filterBar.appendChild(btn);
    });

    filterBar.addEventListener('click', function (e) {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      handleFilterClick(btn.dataset.category);
    });
  }

  // --- Filter logic ----------------------------------------
  function handleFilterClick(categoryId) {
    if (categoryId === 'all') {
      // Show all
      activeCategories = new Set(['all']);
      Object.values(layerGroups).forEach(function (lg) { map.addLayer(lg); });
    } else {
      // Remove 'all' from active set
      activeCategories.delete('all');

      if (activeCategories.has(categoryId)) {
        // Deselect this category
        activeCategories.delete(categoryId);
        map.removeLayer(layerGroups[categoryId]);

        // If nothing selected, go back to all
        if (activeCategories.size === 0) {
          activeCategories.add('all');
          Object.values(layerGroups).forEach(function (lg) { map.addLayer(lg); });
        }
      } else {
        // Select this category (hide others first if we're not in "all" mode)
        if (activeCategories.size === 0 ||
            (activeCategories.size === 1 && activeCategories.has('all'))) {
          // Coming from "all" — hide all, then show just this
          Object.values(layerGroups).forEach(function (lg) { map.removeLayer(lg); });
          activeCategories.clear();
        }
        activeCategories.add(categoryId);
        map.addLayer(layerGroups[categoryId]);
      }
    }

    updateFilterButtonStates();
  }

  function updateFilterButtonStates() {
    const isAll = activeCategories.has('all');
    filterBar.querySelectorAll('.filter-btn').forEach(function (btn) {
      const cat = btn.dataset.category;
      if (cat === 'all') {
        btn.classList.toggle('active', isAll);
        btn.setAttribute('aria-pressed', String(isAll));
        btn.classList.remove('dimmed');
      } else {
        const isActive = isAll || activeCategories.has(cat);
        btn.classList.toggle('active', activeCategories.has(cat));
        btn.classList.toggle('dimmed', !isAll && !activeCategories.has(cat));
        btn.setAttribute('aria-pressed', String(activeCategories.has(cat)));
      }
    });
  }

  // --- Place markers ---------------------------------------
  function buildMarkers(places, categories) {
    const colorMap = {};
    const labelMap = {};
    categories.forEach(function (c) {
      colorMap[c.id] = c.color;
      labelMap[c.id] = c.label;
    });

    // Create a layer group per category
    categories.forEach(function (c) {
      layerGroups[c.id] = L.layerGroup().addTo(map);
    });

    places.forEach(function (place) {
      const color = colorMap[place.category] || '#607D8B';
      const marker = L.circleMarker([place.lat, place.lng], {
        radius: 8,
        fillColor: color,
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9,
      });

      marker.bindTooltip(place.name, {
        direction: 'top',
        offset: [0, -8],
        sticky: false,
      });

      marker.on('click', function () {
        openPanel(place, colorMap, labelMap);
      });

      if (layerGroups[place.category]) {
        layerGroups[place.category].addLayer(marker);
      }
    });
  }

  // --- Side panel ------------------------------------------
  function openPanel(place, colorMap, labelMap) {
    currentPlace = place;
    const color = colorMap[place.category] || '#607D8B';
    const label = labelMap[place.category] || place.category;

    panelBadge.textContent = label;
    panelBadge.style.background = color;

    panelName.textContent = place.name;
    panelMeta.textContent = label + (place.distanceMiles ? ' · ' + place.distanceMiles + ' mi away' : '');

    panelAddr.textContent = place.address || '';

    if (place.phone) {
      panelPhone.textContent = place.phone;
      const tel = place.phone.replace(/\D/g, '');
      panelPhone.innerHTML = '<a href="tel:+1' + tel + '" style="color:inherit;text-decoration:none;">' +
        place.phone + '</a>';
      panelPhone.style.display = '';
    } else {
      panelPhone.textContent = '';
      panelPhone.style.display = 'none';
    }

    if (place.website) {
      const displayUrl = place.website.replace(/^https?:\/\//, '').replace(/\/$/, '');
      panelWeb.href = place.website;
      panelWeb.textContent = displayUrl;
      panelWeb.style.display = '';
    } else {
      panelWeb.textContent = '';
      panelWeb.style.display = 'none';
    }

    if (place.googleMapsUrl) {
      panelGmaps.href = place.googleMapsUrl;
      panelGmaps.style.display = '';
    } else {
      panelGmaps.style.display = 'none';
    }

    sidePanel.classList.add('open');
    sidePanel.setAttribute('aria-hidden', 'false');
  }

  function closePanel() {
    sidePanel.classList.remove('open');
    sidePanel.setAttribute('aria-hidden', 'true');
    currentPlace = null;
  }

  // --- Bootstrap -------------------------------------------
  fetch('amenities.json')
    .then(function (res) {
      if (!res.ok) throw new Error('Failed to load amenities.json: ' + res.status);
      return res.json();
    })
    .then(function (data) {
      allData = data;

      initMap(data.center);
      addHomeMarker(data.center);
      buildFilterButtons(data.categories);
      buildMarkers(data.places, data.categories);

      // Set initial active state on "All" button
      const allBtn = filterBar.querySelector('[data-category="all"]');
      if (allBtn) {
        allBtn.classList.add('active');
        allBtn.setAttribute('aria-pressed', 'true');
      }
    })
    .catch(function (err) {
      console.error('Cedar Knolls Map error:', err);
      document.getElementById('map').innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100%;' +
        'font-size:1rem;color:#666;padding:2rem;text-align:center;">' +
        'Unable to load map data. Please try refreshing the page.</div>';
    });

  // --- Close panel on button click / map click -------------
  panelClose.addEventListener('click', closePanel);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePanel();
  });

}());

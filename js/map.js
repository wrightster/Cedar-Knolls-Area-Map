/* ============================================================
   Cedar Knolls Area Map — map.js
   ============================================================ */

(function () {
  'use strict';

  // --- State -----------------------------------------------
  var map;
  var allData;
  var markerGroups = {};     // { categoryId: [ {marker, popup}, ... ] }
  var activeCategories = new Set(['all']);
  var currentPlace = null;
  var photosMap = {};
  var ckCenter = null;
  var distanceLabelMarker = null;
  var selectedMarkerEl = null;
  var spiderAnim = null;   // requestAnimationFrame id for spread animation
  var lastZoom = null;

  var STYLE_URL = 'https://api.maptiler.com/maps/019d2ac4-1b5c-7824-a78a-30cdcb276433/style.json?key=gctDBtFwdnIhG8N9CFpi';

  // --- DOM refs --------------------------------------------
  var filterBar     = document.getElementById('filter-bar');
  var filterToggle  = document.getElementById('filter-toggle');
  var filterOverlay = document.getElementById('filter-overlay');
  var sidePanel     = document.getElementById('side-panel');
  var panelToggle = document.getElementById('panel-toggle');
  var panelBadge = document.getElementById('panel-category-badge');
  var panelName  = document.getElementById('panel-name');
  var panelMeta  = document.getElementById('panel-meta');
  var panelAddr  = document.getElementById('panel-address');
  var panelPhone = document.getElementById('panel-phone');
  var panelWeb   = document.getElementById('panel-website');
  var panelGmaps = document.getElementById('panel-gmaps');
  var panelPhotoWrap = document.getElementById('panel-photo-wrap');
  var panelPhoto     = document.getElementById('panel-photo');

  // --- Custom place icons ----------------------------------
  var PLACE_ICONS = {
    // Grocery
    'Food Lion':            'assets/FoodLion.svg',
    'Harris Teeter':        'assets/HarrisTeeter.svg',
    'Lowes Foods':          'assets/LowesFoods.svg',
    'Publix Super Market':  'assets/Publix.svg',
    'Target':               'assets/Target.svg',
    'Walmart Supercenter':  'assets/Walmart.svg',
    'Wegmans':              'assets/Wegmans.svg',
    // Coffee
    'Starbucks':            'assets/Starbucks.svg',
    "Dunkin'":              'assets/Dunkin.svg',
    // Gym
    'Planet Fitness':       'assets/PlanetFitness.svg',
    // Restaurant
    'Chick-fil-A':          'assets/ChickFilA.svg',
    'Panera Bread':         'assets/PaneraBread.svg',
    // Medical
    'CVS Pharmacy':         'assets/CVS.svg',
    'Walgreens':            'assets/Walgreens.svg',
  };

  var CATEGORY_ICONS = {
    'park':       'assets/Park.svg',
    'gym':        'assets/Gym.svg',
    'church':     'assets/Church.svg',
    'restaurant': 'assets/Restaurant.svg',
    'school':     'assets/School.svg',
    'medical':    'assets/Medical.svg',
    'coffee':     'assets/Coffee.svg',
    'shopping':   'assets/Shopping.svg',
  };

  var MAX_PAN_MILES = 20;
  var zoomDisplay = document.getElementById('zoom-display');

  function haversineMiles(lat1, lon1, lat2, lon2) {
    var R = 3958.8;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function updateZoomDisplay() {
    if (zoomDisplay) zoomDisplay.textContent = 'Zoom ' + map.getZoom().toFixed(1);
  }

  function clampPan() {
    var center = map.getCenter();
    var dist = haversineMiles(ckCenter.lat, ckCenter.lng, center.lat, center.lng);
    if (dist > MAX_PAN_MILES) {
      // Project back onto the 20-mile circle
      var ratio = MAX_PAN_MILES / dist;
      var newLat = ckCenter.lat + (center.lat - ckCenter.lat) * ratio;
      var newLng = ckCenter.lng + (center.lng - ckCenter.lng) * ratio;
      map.easeTo({ center: [newLng, newLat], duration: 300 });
    }
  }

  // --- Init map --------------------------------------------
  function initMap(center) {
    map = new maplibregl.Map({
      container: 'map',
      style: STYLE_URL,
      center: [center.lng, center.lat],
      zoom: 11,
      minZoom: 9,
    });

    return new Promise(function (resolve) {
      map.on('load', resolve);
    });
  }

  // --- Marker element factories ----------------------------
  function makePinEl(iconUrl) {
    var el = document.createElement('div');
    el.style.width  = '40px';
    el.style.height = '50px';
    el.style.backgroundImage    = 'url(' + iconUrl + ')';
    el.style.backgroundSize     = 'contain';
    el.style.backgroundRepeat   = 'no-repeat';
    el.style.backgroundPosition = 'center bottom';
    el.style.cursor = 'pointer';
    return el;
  }

  function makeCircleEl(color) {
    var wrapper = document.createElement('div');
    wrapper.className           = 'dot-marker';
    wrapper.style.width         = '24px';
    wrapper.style.height        = '24px';
    wrapper.style.display       = 'flex';
    wrapper.style.alignItems    = 'center';
    wrapper.style.justifyContent = 'center';
    wrapper.style.cursor        = 'pointer';
    var dot = document.createElement('div');
    dot.className          = 'amenity-dot';
    dot.style.width        = '16px';
    dot.style.height       = '16px';
    dot.style.borderRadius = '50%';
    dot.style.background   = color;
    dot.style.border       = '2px solid #fff';
    dot.style.boxShadow    = '0 1px 4px rgba(0,0,0,0.3)';

    wrapper.appendChild(dot);
    return wrapper;
  }

  function getDot(markerEl) {
    return markerEl.querySelector('.amenity-dot');
  }

  // --- Home marker -----------------------------------------
  function addHomeMarker(center) {
    var el = document.createElement('div');
    el.style.width              = '146px';
    el.style.height             = '60px';
    el.style.backgroundImage    = 'url(assets/CedarKnolls.svg)';
    el.style.backgroundSize     = 'contain';
    el.style.backgroundRepeat   = 'no-repeat';
    el.style.pointerEvents      = 'none';

    new maplibregl.Marker({ element: el, anchor: 'bottom-right' })
      .setLngLat([center.lng, center.lat])
      .addTo(map);
  }

  // --- Build category filter buttons -----------------------
  function buildFilterButtons(categories) {
    categories.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.dataset.category = cat.id;
      btn.setAttribute('aria-pressed', 'false');

      var dot = document.createElement('span');
      dot.className = 'filter-dot';
      dot.style.background = cat.color;

      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(cat.label));
      filterBar.appendChild(btn);
    });

    filterBar.addEventListener('click', function (e) {
      var btn = e.target.closest('.filter-btn');
      if (!btn) return;
      handleFilterClick(btn.dataset.category);
    });
  }

  // --- Filter logic ----------------------------------------
  function showGroup(categoryId) {
    markerGroups[categoryId].forEach(function (item) {
      item.marker.addTo(map);
    });
  }

  function hideGroup(categoryId) {
    markerGroups[categoryId].forEach(function (item) {
      item.popup.remove();
      item.marker.setOffset([0, 0]);
      item._spiderOffset = null;
      item.marker.remove();
    });
  }

  function handleFilterClick(categoryId) {
    if (categoryId === 'all') {
      activeCategories = new Set(['all']);
      Object.keys(markerGroups).forEach(showGroup);
    } else {
      activeCategories.delete('all');

      if (activeCategories.has(categoryId)) {
        activeCategories.delete(categoryId);
        hideGroup(categoryId);

        if (activeCategories.size === 0) {
          activeCategories.add('all');
          Object.keys(markerGroups).forEach(showGroup);
        }
      } else {
        if (activeCategories.size === 0 ||
            (activeCategories.size === 1 && activeCategories.has('all'))) {
          Object.keys(markerGroups).forEach(hideGroup);
          activeCategories.clear();
        }
        activeCategories.add(categoryId);
        showGroup(categoryId);
      }
    }

    updateFilterButtonStates();
  }

  function updateFilterButtonStates() {
    var isAll = activeCategories.has('all');
    filterBar.querySelectorAll('.filter-btn').forEach(function (btn) {
      var cat = btn.dataset.category;
      if (cat === 'all') {
        btn.classList.toggle('active', isAll);
        btn.setAttribute('aria-pressed', String(isAll));
        btn.classList.remove('dimmed');
      } else {
        btn.classList.toggle('active', activeCategories.has(cat));
        btn.classList.toggle('dimmed', !isAll && !activeCategories.has(cat));
        btn.setAttribute('aria-pressed', String(activeCategories.has(cat)));
      }
    });
  }

  // --- Place markers ---------------------------------------
  function buildMarkers(places, categories) {
    var colorMap = {}, labelMap = {};
    categories.forEach(function (c) {
      colorMap[c.id] = c.color;
      labelMap[c.id] = c.label;
      markerGroups[c.id] = [];
    });

    places.forEach(function (place) {
      var color = colorMap[place.category] || '#738e99';
      var el    = makeCircleEl(color);

      var popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: 'place-tooltip',
      }).setText(place.name);

      el.addEventListener('mouseenter', function () {
        var pt  = map.project([place.lng, place.lat]);
        var off = marker.getOffset();
        popup.setLngLat(map.unproject([pt.x + off.x, pt.y + off.y])).addTo(map);
      });
      el.addEventListener('mouseleave', function () {
        var container = popup.getElement();
        if (container) {
          container.classList.add('is-hiding');
          setTimeout(function () { popup.remove(); }, 100);
        } else {
          popup.remove();
        }
      });
      el.addEventListener('click', function () {
        var pixel     = map.project([place.lng, place.lat]);
        var mapWidth  = map.getContainer().clientWidth;
        var mapHeight = map.getContainer().clientHeight;

        // Clamp pixel position to just inside the nearEdge zone boundary
        // In portrait orientation the panel opens as a bottom footer (~45vh),
        // so keep the amenity in the upper 55% of the map height instead.
        var portrait  = mapHeight > mapWidth;
        var targetX = Math.min(Math.max(pixel.x, mapWidth  * 0.25), mapWidth  * (portrait ? 0.75 : 0.65));
        var targetY = Math.min(Math.max(pixel.y, mapHeight * 0.20), mapHeight * (portrait ? 0.55 : 0.80));

        if (targetX !== pixel.x || targetY !== pixel.y) {
          // Shift the center by the same delta so the amenity lands on the boundary
          var newCenter = map.unproject([
            mapWidth  / 2 + (pixel.x - targetX),
            mapHeight / 2 + (pixel.y - targetY),
          ]);
          map.easeTo({ center: newCenter, duration: 500 });
        }

        openPanel(place, colorMap, labelMap, el);
      });

      var marker = new maplibregl.Marker({
        element: el,
        anchor: 'center',
      })
        .setLngLat([place.lng, place.lat])
        .addTo(map);

      markerGroups[place.category].push({ marker: marker, popup: popup });
    });
  }

  // --- Spiderfy --------------------------------------------
  function addSpiderLineLayer() {
    map.addSource('spider-lines', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'spider-lines',
      type: 'line',
      source: 'spider-lines',
      paint: {
        'line-color': 'rgba(80,80,80,0.45)',
        'line-width': 1.5,
      },
    });
  }

  function cancelSpiderAnim() {
    if (spiderAnim !== null) { cancelAnimationFrame(spiderAnim); spiderAnim = null; }
  }

  // Redraws lines to match current dot positions without recomputing the layout.
  // Called on every move frame so lines stay attached to their dots during scroll/zoom.
  function updateSpiderLines() {
    var features = [];
    Object.keys(markerGroups).forEach(function (catId) {
      markerGroups[catId].forEach(function (entry) {
        var off = entry._spiderOffset;
        if (!off || (Math.abs(off[0]) < 0.5 && Math.abs(off[1]) < 0.5)) return;
        if (!entry.marker.getElement().isConnected) return;
        var lngLat = entry.marker.getLngLat();
        var pt = map.project(lngLat);
        var spreadLngLat = map.unproject([pt.x + off[0], pt.y + off[1]]);
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [lngLat.lng, lngLat.lat],
              [spreadLngLat.lng, spreadLngLat.lat],
            ],
          },
        });
      });
    });
    map.getSource('spider-lines').setData({ type: 'FeatureCollection', features: features });
  }

  function runSpiderfy(anchorSelected, warmStart) {
    cancelSpiderAnim();

    var NORMAL_RADIUS   = 11;   // px — half of 22px min clearance between normal dots
    var SELECTED_RADIUS = 18;   // px — larger footprint for the selected dot
    var MAX_ITER = 100;
    var DURATION = 400;  // ms for the snap-in animation

    // Collect all items with their real map positions and current visual offsets.
    var items = [];
    Object.keys(markerGroups).forEach(function (catId) {
      markerGroups[catId].forEach(function (entry) {
        if (!entry.marker.getElement().isConnected) return;
        var lngLat = entry.marker.getLngLat();
        var pt = map.project(lngLat);
        var isSelected = entry.marker.getElement() === selectedMarkerEl;
        var prev = entry._spiderOffset || [0, 0];
        items.push({ entry: entry, marker: entry.marker, lngLat: lngLat,
                     origX: pt.x, origY: pt.y, isSelected: isSelected, prev: prev });
      });
    });

    // Pass 1 — natural layout: all dots cold-start with normal radius.
    // This gives each dot a "home" position to return to when not being pushed.
    var nat = items.map(function (item) { return { x: item.origX, y: item.origY }; });
    for (var iter = 0; iter < MAX_ITER; iter++) {
      var settled = true;
      for (var i = 0; i < items.length; i++) {
        for (var j = i + 1; j < items.length; j++) {
          var dx = nat[j].x - nat[i].x, dy = nat[j].y - nat[i].y;
          var distSq = dx * dx + dy * dy;
          var minDist = NORMAL_RADIUS * 2;
          if (distSq >= minDist * minDist) continue;
          settled = false;
          var dist = Math.sqrt(distSq);
          var push = (minDist - dist) / 2;
          var nx, ny;
          if (dist < 0.01) { var a = i + j * 2.399963; nx = Math.cos(a); ny = Math.sin(a); }
          else { nx = dx / dist; ny = dy / dist; }
          nat[i].x -= nx * push; nat[i].y -= ny * push;
          nat[j].x += nx * push; nat[j].y += ny * push;
        }
      }
      if (settled) break;
    }

    // Pass 2 — selection layout: non-selected start from their natural homes;
    // selected dot is anchored at its current visual position with a larger radius.
    // Only dots that collide with the selected dot get pushed further out.
    // For zoom-out: warm-start (dots hold position).
    // For selection: each dot uses its natural home if it's nearby, otherwise warm-starts.
    // This prevents scrambling at extreme zoom-out where nat and prev diverge significantly.
    var SNAP_THRESHOLD_SQ = (NORMAL_RADIUS * 4) * (NORMAL_RADIUS * 4);
    var fin = items.map(function (item, idx) {
      var prevX = item.origX + item.prev[0], prevY = item.origY + item.prev[1];
      if (warmStart) return { x: prevX, y: prevY };
      // Zoom-in always cold-starts so stuck dots can always return home.
      // Selection uses a threshold: only return to natural home if the displacement
      // is small (normal zoom); warm-start if it's large (extreme zoom-out) to avoid scrambling.
      if (!anchorSelected) return { x: nat[idx].x, y: nat[idx].y };
      var dx = nat[idx].x - prevX, dy = nat[idx].y - prevY;
      return (dx * dx + dy * dy <= SNAP_THRESHOLD_SQ)
        ? { x: nat[idx].x, y: nat[idx].y }
        : { x: prevX, y: prevY };
    });
    for (var iter2 = 0; iter2 < MAX_ITER; iter2++) {
      var settled2 = true;
      for (var i = 0; i < items.length; i++) {
        for (var j = i + 1; j < items.length; j++) {
          var dx = fin[j].x - fin[i].x, dy = fin[j].y - fin[i].y;
          var distSq = dx * dx + dy * dy;
          var minDist = (items[i].isSelected ? SELECTED_RADIUS : NORMAL_RADIUS)
                      + (items[j].isSelected ? SELECTED_RADIUS : NORMAL_RADIUS);
          if (distSq >= minDist * minDist) continue;
          settled2 = false;
          var dist = Math.sqrt(distSq);
          var push = (minDist - dist) / 2;
          var nx, ny;
          if (dist < 0.01) { var a = i + j * 2.399963; nx = Math.cos(a); ny = Math.sin(a); }
          else { nx = dx / dist; ny = dy / dist; }
          if (items[i].isSelected) {
            fin[j].x += nx * push * 2; fin[j].y += ny * push * 2;
          } else if (items[j].isSelected) {
            fin[i].x -= nx * push * 2; fin[i].y -= ny * push * 2;
          } else {
            fin[i].x -= nx * push; fin[i].y -= ny * push;
            fin[j].x += nx * push; fin[j].y += ny * push;
          }
        }
      }
      if (settled2) break;
    }

    // Animate from current visual offsets to the computed target offsets.
    items.forEach(function (item, idx) {
      item.startOx = item.prev[0];
      item.startOy = item.prev[1];
      item.targetOx = fin[idx].x - item.origX;
      item.targetOy = fin[idx].y - item.origY;
    });

    var startTime = performance.now();

    function frame(now) {
      var t = Math.min((now - startTime) / DURATION, 1);
      var ease = 1 - Math.pow(1 - t, 3);  // cubic ease-out

      var features = [];
      items.forEach(function (item) {
        var ox = item.startOx + (item.targetOx - item.startOx) * ease;
        var oy = item.startOy + (item.targetOy - item.startOy) * ease;
        if (Math.abs(ox) < 0.5 && Math.abs(oy) < 0.5) { ox = 0; oy = 0; }

        item.marker.setOffset([ox, oy]);
        item.entry._spiderOffset = [ox, oy];

        if (ox === 0 && oy === 0) return;
        var pt = map.project(item.lngLat);
        var spreadLngLat = map.unproject([pt.x + ox, pt.y + oy]);
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [item.lngLat.lng, item.lngLat.lat],
              [spreadLngLat.lng, spreadLngLat.lat],
            ],
          },
        });
      });

      map.getSource('spider-lines').setData({ type: 'FeatureCollection', features: features });
      spiderAnim = (t < 1) ? requestAnimationFrame(frame) : null;
    }

    spiderAnim = requestAnimationFrame(frame);
  }

  // --- Distance line ---------------------------------------
  function addDistanceLineLayer() {
    map.addSource('distance-line', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
    });
    map.addLayer({
      id: 'distance-line',
      type: 'line',
      source: 'distance-line',
      paint: {
        'line-color': '#1e5f63',
        'line-width': 2,
        'line-dasharray': [2, 1],
        'line-opacity': 1,
      },
    });
  }

  function drawDistanceLine(place) {
    map.getSource('distance-line').setData({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [ckCenter.lng, ckCenter.lat],
          [place.lng, place.lat],
        ],
      },
    });

    if (distanceLabelMarker) { distanceLabelMarker.remove(); distanceLabelMarker = null; }

    if (place.distanceMiles) {
      var el = document.createElement('div');
      el.className = 'distance-label';
      el.textContent = place.distanceMiles + ' mi';

      distanceLabelMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([(ckCenter.lng + place.lng) / 2, (ckCenter.lat + place.lat) / 2])
        .addTo(map);
    }
  }

  function clearDistanceLine() {
    map.getSource('distance-line').setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [] },
    });
    if (distanceLabelMarker) { distanceLabelMarker.remove(); distanceLabelMarker = null; }
  }

  // --- Side panel ------------------------------------------
  function openPanel(place, colorMap, labelMap, markerEl) {
    currentPlace = place;
    if (selectedMarkerEl) getDot(selectedMarkerEl).classList.remove('selected');
    selectedMarkerEl = markerEl || null;
    if (selectedMarkerEl) getDot(selectedMarkerEl).classList.add('selected');
    runSpiderfy(true);
    var color = colorMap[place.category] || '#738e99';
    var label = labelMap[place.category] || place.category;

    var photoPath = photosMap[place.id];
    if (photoPath) {
      panelPhoto.src = photoPath;
      panelPhoto.alt = place.name;
      panelPhotoWrap.style.display = '';
    } else {
      panelPhoto.src = '';
      panelPhoto.alt = '';
      panelPhotoWrap.style.display = 'none';
    }

    panelBadge.textContent = label;
    panelBadge.style.background = color;

    panelName.textContent = place.name;
    panelMeta.textContent = label + (place.distanceMiles ? ' · ' + place.distanceMiles + ' mi away' : '');

    panelAddr.textContent = place.address || '';

    if (place.phone) {
      var tel = place.phone.replace(/\D/g, '');
      panelPhone.innerHTML = '<a href="tel:+1' + tel + '" style="color:inherit;text-decoration:none;">' + place.phone + '</a>';
      panelPhone.style.display = '';
    } else {
      panelPhone.textContent = '';
      panelPhone.style.display = 'none';
    }

    if (place.website) {
      var displayUrl = place.website.replace(/^https?:\/\//, '').replace(/\/$/, '');
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
    document.body.classList.add('panel-open', 'panel-has-place');
    panelToggle.hidden = false;
    updateTogglePortraitPos();
    setTimeout(function () { map.resize(); }, 260);
    drawDistanceLine(place);
  }

  function updateTogglePortraitPos() {
    if (window.matchMedia('(orientation: portrait)').matches) {
      panelToggle.style.bottom = (sidePanel.offsetHeight + 10 + 8) + 'px';
    } else {
      panelToggle.style.bottom = '';
    }
  }

  function collapsePanel() {
    panelToggle.style.bottom = '';
    sidePanel.classList.remove('open');
    sidePanel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('panel-open');
    setTimeout(function () { map.resize(); }, 260);
  }

  function expandPanel() {
    updateTogglePortraitPos();
    sidePanel.classList.add('open');
    sidePanel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('panel-open');
    setTimeout(function () { map.resize(); }, 260);
  }

  function closePanel() {
    sidePanel.classList.remove('open');
    sidePanel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('panel-open', 'panel-has-place');
    panelToggle.hidden = true;
    currentPlace = null;
    if (selectedMarkerEl) { getDot(selectedMarkerEl).classList.remove('selected'); selectedMarkerEl = null; }
    runSpiderfy(true);
    clearDistanceLine();
    setTimeout(function () { map.resize(); }, 260);
  }

  // --- Bootstrap -------------------------------------------
  Promise.all([
    fetch('amenities.json').then(function (r) {
      if (!r.ok) throw new Error('Failed to load amenities.json: ' + r.status);
      return r.json();
    }),
    fetch('photos.json').then(function (r) {
      if (!r.ok) return {};   // graceful: photos.json absent before first workflow run
      return r.json();
    }),
  ])
    .then(function (results) {
      allData   = results[0];
      photosMap = results[1];

      initMap(allData.center).then(function () {
        ckCenter = allData.center;
        addSpiderLineLayer();
        addDistanceLineLayer();
        addHomeMarker(allData.center);
        buildFilterButtons(allData.categories);
        filterBar.classList.add('open');
        filterToggle.setAttribute('aria-expanded', 'true');
        filterBar.setAttribute('aria-hidden', 'false');
        buildMarkers(allData.places, allData.categories);
        updateZoomDisplay();
        map.on('zoom', updateZoomDisplay);
        map.on('moveend', clampPan);
        map.on('movestart', cancelSpiderAnim);
        map.on('move', updateSpiderLines);
        map.on('idle', function () {
          var zoom = map.getZoom();
          var zoomedIn = lastZoom !== null && zoom > lastZoom;
          lastZoom = zoom;
          runSpiderfy(false, !zoomedIn);
        });

        var allBtn = filterBar.querySelector('[data-category="all"]');
        if (allBtn) {
          allBtn.classList.add('active');
          allBtn.setAttribute('aria-pressed', 'true');
        }
      });
    })
    .catch(function (err) {
      console.error('Cedar Knolls Map error:', err);
      document.getElementById('map').innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100%;' +
        'font-size:1rem;color:#666;padding:2rem;text-align:center;">' +
        'Unable to load map data. Please try refreshing the page.</div>';
    });

  // --- Filter toggle ---------------------------------------
  filterToggle.addEventListener('click', function () {
    var open = filterBar.classList.toggle('open');
    filterToggle.setAttribute('aria-expanded', String(open));
    filterBar.setAttribute('aria-hidden', String(!open));
  });


  // --- Panel toggle (collapse / expand) --------------------
  panelToggle.addEventListener('click', function () {
    if (sidePanel.classList.contains('open')) {
      collapsePanel();
    } else {
      expandPanel();
    }
  });

  document.addEventListener('mousedown', function (e) {
    var attrib = document.querySelector('.maplibregl-ctrl-attrib');
    if (attrib && !attrib.contains(e.target)) {
      attrib.classList.remove('maplibregl-compact-show');
      var btn = attrib.querySelector('.maplibregl-ctrl-attrib-button');
      if (btn) btn.setAttribute('aria-pressed', 'false');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (filterBar.classList.contains('open')) {
        filterBar.classList.remove('open');
        filterToggle.setAttribute('aria-expanded', 'false');
        filterBar.setAttribute('aria-hidden', 'true');
      } else {
        closePanel();
      }
    }
  });

}());

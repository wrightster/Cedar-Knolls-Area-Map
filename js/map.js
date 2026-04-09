/* ============================================================
   Cedar Knolls Area Map — map.js
   ============================================================ */

(function () {
  'use strict';

  // --- State -----------------------------------------------
  var map;
  var allData;
  var allPlaceEntries = [];  // flat list — single source of truth for iteration
  var markerGroups = {};     // { categoryId: [entry, ...] } — entries may be shared
  var colorMap = {};         // { categoryId: hex }
  var labelMap = {};         // { categoryId: label }
  var activeCategories = new Set(['all']);
  var currentPlace = null;
  var photosMap = {};
  var ckCenter = null;
  var distanceLabelMarker = null;
  var distanceHover = { line: false, label: false };
  var labelMoveListener = null;
  var selectedMarkerEl = null;
  var spiderAnim = null;   // requestAnimationFrame id for spread animation
  var lastZoom = null;
  var mallDistances    = new Map(); // place → distance in miles to nearest mall
  var mallNearbyPlaces = new Map(); // mall place → Set of non-mall places for which it is nearest
  var activeMall          = null;  // entry of currently expanded mall (or null)
  var mallExpandedEntries = [];    // entries currently revealed by activeMall

  var STYLE_URL = 'https://api.maptiler.com/maps/019d2ac4-1b5c-7824-a78a-30cdcb276433/style.json?key=gctDBtFwdnIhG8N9CFpi';
  var MALL_ZOOM = 14; // malls visible at ≤ this zoom; individual stores visible above it

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

  // --- Custom place icons (reference only) -----------------
  var CATEGORY_ICONS = {
    'park':       'assets/Park.svg',
    'gym':        'assets/Gym.svg',
    'church':     'assets/Church.svg',
    'restaurant': 'assets/Restaurant.svg',
    'school':     'assets/School.svg',
    'medical':    'assets/Medical.svg',
    'cafe':       'assets/Coffee.svg',
    'shopping':   'assets/Shopping.svg',
    'gas':        'assets/Gas.svg',
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
      var ratio = MAX_PAN_MILES / dist;
      var newLat = ckCenter.lat + (center.lat - ckCenter.lat) * ratio;
      var newLng = ckCenter.lng + (center.lng - ckCenter.lng) * ratio;
      map.easeTo({ center: [newLng, newLat], duration: 300 });
    }
  }

  // --- Category helpers ------------------------------------

  // Normalise a place's category data into a priority-ordered array.
  // Supports both the new `categories` array and legacy `category` string.
  function getCategories(place) {
    if (Array.isArray(place.categories) && place.categories.length) return place.categories;
    if (place.category) return [place.category];
    return ['shopping'];
  }

  // Return the dot color for a place given the current active filters.
  // Uses the first category in priority order that is currently active.
  // Falls back to the primary (first) category when "all" is active.
  function getActiveColor(place) {
    var cats = getCategories(place);
    if (!activeCategories.has('all')) {
      for (var i = 0; i < cats.length; i++) {
        if (activeCategories.has(cats[i])) return colorMap[cats[i]] || '#738e99';
      }
    }
    return colorMap[cats[0]] || '#738e99';
  }

  // Refresh dot colors for all currently visible markers.
  function updateAllDotColors() {
    allPlaceEntries.forEach(function (item) {
      if (item.marker.getElement().isConnected) {
        var dot = getDot(item.marker.getElement());
        if (dot) dot.style.background = getActiveColor(item.place);
      }
    });
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
    dot.style.boxShadow    = 'none';

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
      if (cat.id === 'mall') return; // always enabled — no filter button
      var btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.dataset.category = cat.id;
      btn.setAttribute('aria-pressed', 'false');

      var dot = document.createElement('span');
      dot.className = 'filter-dot';
      dot.style.background = cat.color;
      if (cat.id === 'mall') dot.style.borderRadius = '35%';

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
  function isMall(place) {
    // Category-based (current) or tag-based (legacy candidates)
    return getCategories(place).includes('mall') ||
           (Array.isArray(place.tags) && place.tags.includes('mall'));
  }

  // Returns the hide-radius in miles for the given zoom level.
  // Linear: 0 at MALL_ZOOM, MAX_RADIUS at MIN_ZOOM_RADIUS, capped beyond.
  function mallRadius(zoom) {
    var MIN_ZOOM_RADIUS = 9, MAX_RADIUS = 2;
    if (zoom >= MALL_ZOOM) return 0;
    return MAX_RADIUS * Math.min(1, (MALL_ZOOM - zoom) / (MALL_ZOOM - MIN_ZOOM_RADIUS));
  }

  // A mall dot is visible only when radius > 0 AND at least one active-category place
  // exists within that radius for which this mall is the nearest.
  function isMallVisible(mallPlace, zoom) {
    var radius = mallRadius(zoom);
    if (radius === 0) return false;
    var nearby = mallNearbyPlaces.get(mallPlace);
    if (!nearby || nearby.size === 0) return false;
    for (var place of nearby) {
      var dist = mallDistances.get(place);
      if (dist <= radius) {
        var cats = getCategories(place);
        if (activeCategories.has('all') || cats.some(function (c) { return activeCategories.has(c); })) {
          return true;
        }
      }
    }
    return false;
  }

  // Malls use isMallVisible; all other places hide when within mallRadius of their nearest mall.
  // Always active — mall category has no filter button.
  function isZoomVisible(place, zoom) {
    if (isMall(place)) return isMallVisible(place, zoom);
    var dist = mallDistances.get(place);
    if (dist !== undefined) {
      var radius = mallRadius(zoom);
      if (radius > 0 && dist <= radius) return false;
    }
    return true;
  }

  function showGroup(categoryId) {
    var zoom = map.getZoom();
    (markerGroups[categoryId] || []).forEach(function (item) {
      if (!isZoomVisible(item.place, zoom)) return;
      item.marker.addTo(map);
      var dot = getDot(item.marker.getElement());
      if (dot) dot.style.background = getActiveColor(item.place);
    });
  }

  function updateMallZoomVisibility() {
    var zoom = map.getZoom();
    allPlaceEntries.forEach(function (item) {
      // Entries revealed by an active mall expansion are managed by expandMall/collapseMall.
      if (item._mallExpanded) return;

      var shouldShow = isZoomVisible(item.place, zoom);
      var el = item.marker.getElement();
      var onMap = el && el.isConnected;
      var cats = getCategories(item.place);
      // Mall markers are always enabled (no filter button); non-mall markers respect filters.
      var catActive = isMall(item.place) ||
                      activeCategories.has('all') ||
                      cats.some(function (c) { return activeCategories.has(c); });

      if (catActive && shouldShow && !onMap) {
        item.marker.addTo(map);
        var dot = getDot(item.marker.getElement());
        if (dot) dot.style.background = getActiveColor(item.place);
      } else if (!shouldShow && onMap) {
        // If this mall is being hidden while its expansion is active, inline-collapse
        // (avoids recursive call to updateMallZoomVisibility inside collapseMall).
        if (isMall(item.place) && activeMall === item) {
          mallExpandedEntries.forEach(function (e) {
            delete e._mallExpanded;
            e.popup.remove();
            e.marker.setOffset([0, 0]);
            e._spiderOffset = null;
            e.marker.remove();
          });
          mallExpandedEntries = [];
          activeMall = null;
          if (selectedMarkerEl === item.marker.getElement()) {
            getDot(item.marker.getElement()).classList.remove('selected');
            selectedMarkerEl = null;
            currentPlace = null;
          }
        }
        item.popup.remove();
        item.marker.setOffset([0, 0]);
        item._spiderOffset = null;
        item.marker.remove();
      }
    });
  }

  function hideGroup(categoryId) {
    (markerGroups[categoryId] || []).forEach(function (item) {
      // Keep visible if any other active category also claims this place
      var cats = getCategories(item.place);
      var claimedByOther = cats.some(function (c) {
        return c !== categoryId && activeCategories.has(c);
      });
      if (claimedByOther) {
        var dot = getDot(item.marker.getElement());
        if (dot) dot.style.background = getActiveColor(item.place);
        return;
      }
      item.popup.remove();
      item.marker.setOffset([0, 0]);
      item._spiderOffset = null;
      item.marker.remove();
    });
  }

  // --- Mall expansion ----------------------------------------
  function collapseMall() {
    if (!activeMall) return;
    cancelSpiderAnim();
    mallExpandedEntries.forEach(function (e) {
      delete e._mallExpanded;
      e.popup.remove();
      e.marker.setOffset([0, 0]);
      e._spiderOffset = null;
      e.marker.remove();
    });
    activeMall = null;
    mallExpandedEntries = [];
  }

  function expandMall(mallEntry, mallEl) {
    if (activeMall === mallEntry) {
      openPanel(mallEntry.place, mallEl);
      return;
    }
    collapseMall();
    activeMall = mallEntry;

    var zoom = map.getZoom();
    var radius = mallRadius(zoom);
    var nearby = mallNearbyPlaces.get(mallEntry.place);

    mallExpandedEntries = [];
    if (nearby && radius > 0) {
      nearby.forEach(function (place) {
        var dist = mallDistances.get(place);
        if (dist === undefined || dist > radius) return;
        var cats = getCategories(place);
        if (!activeCategories.has('all') && !cats.some(function (c) { return activeCategories.has(c); })) return;
        var e = allPlaceEntries.find(function (x) { return x.place === place; });
        if (!e) return;
        e._mallExpanded = mallEntry;
        mallExpandedEntries.push(e);
        if (!e.marker.getElement().isConnected) {
          e.marker.addTo(map);
          var dot = getDot(e.marker.getElement());
          if (dot) dot.style.background = getActiveColor(e.place);
        }
      });
    }

    openPanel(mallEntry.place, mallEl);
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
    updateAllDotColors();
    collapseMall();
    updateMallZoomVisibility();
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
    categories.forEach(function (c) {
      colorMap[c.id] = c.color;
      labelMap[c.id] = c.label;
      markerGroups[c.id] = [];
    });

    places.forEach(function (place) {
      var cats  = getCategories(place);
      var color = colorMap[cats[0]] || '#738e99';
      var el    = makeCircleEl(color);
      if (isMall(place)) {
        var d = getDot(el);
        if (d) d.style.borderRadius = '35%';
      }

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

        var portrait  = mapHeight > mapWidth;
        var targetX = Math.min(Math.max(pixel.x, mapWidth  * 0.25), mapWidth  * (portrait ? 0.75 : 0.65));
        var targetY = Math.min(Math.max(pixel.y, mapHeight * 0.20), mapHeight * (portrait ? 0.55 : 0.80));

        if (targetX !== pixel.x || targetY !== pixel.y) {
          var newCenter = map.unproject([
            mapWidth  / 2 + (pixel.x - targetX),
            mapHeight / 2 + (pixel.y - targetY),
          ]);
          map.easeTo({ center: newCenter, duration: 500 });
        }

        if (isMall(place)) {
          expandMall(entry, el);
        } else if (entry._mallExpanded) {
          openPanel(place, null, { keepSelection: true });
        } else {
          collapseMall();
          openPanel(place, el);
        }
      });

      var marker = new maplibregl.Marker({
        element: el,
        anchor: 'center',
      })
        .setLngLat([place.lng, place.lat])
        .addTo(map);

      // Register in all category groups — same entry object, shared reference
      var entry = { marker: marker, popup: popup, place: place };
      allPlaceEntries.push(entry);
      cats.forEach(function (cat) {
        if (markerGroups[cat]) markerGroups[cat].push(entry);
      });
    });

    // Precompute nearest-mall distance for each non-mall place, and
    // build mallNearbyPlaces so each mall knows which places it is nearest to.
    mallDistances    = new Map();
    mallNearbyPlaces = new Map();
    var mallPlaceObjs = places.filter(isMall);
    mallPlaceObjs.forEach(function (m) { mallNearbyPlaces.set(m, new Set()); });
    if (mallPlaceObjs.length) {
      places.forEach(function (place) {
        if (isMall(place)) return;
        var minDist = Infinity, nearest = null;
        for (var j = 0; j < mallPlaceObjs.length; j++) {
          var d = haversineMiles(place.lat, place.lng, mallPlaceObjs[j].lat, mallPlaceObjs[j].lng);
          if (d < minDist) { minDist = d; nearest = mallPlaceObjs[j]; }
        }
        mallDistances.set(place, minDist);
        if (nearest) mallNearbyPlaces.get(nearest).add(place);
      });
    }

    // Apply initial zoom-based visibility
    updateMallZoomVisibility();
  }

  // --- Spiderfy --------------------------------------------
  function addSpiderLineLayer() {
    var mapEl = document.getElementById('map');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'spider-lines-svg';
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    mapEl.appendChild(svg);
  }

  function drawSpiderPolygon(svg, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.5) return;
    var ux = dx / len, uy = dy / len;
    var px = -uy * 2, py = ux * 2;
    var bx = x2 - ux * 4, by = y2 - uy * 4;
    var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points',
      x1 + ',' + y1 + ' ' +
      (bx + px) + ',' + (by + py) + ' ' +
      (bx - px) + ',' + (by - py)
    );
    poly.setAttribute('fill', 'white');
    svg.appendChild(poly);
  }

  function cancelSpiderAnim() {
    if (spiderAnim !== null) { cancelAnimationFrame(spiderAnim); spiderAnim = null; }
  }

  // Redraws lines to match current dot positions without recomputing the layout.
  function updateSpiderLines() {
    var svg = document.getElementById('spider-lines-svg');
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Regular spider lines (skip mall-expanded entries — their lines come from the mall)
    allPlaceEntries.forEach(function (entry) {
      if (entry._mallExpanded) return;
      var off = entry._spiderOffset;
      if (!off || (Math.abs(off[0]) < 0.5 && Math.abs(off[1]) < 0.5)) return;
      if (!entry.marker.getElement().isConnected) return;
      var pt = map.project(entry.marker.getLngLat());
      drawSpiderPolygon(svg, pt.x, pt.y, pt.x + off[0], pt.y + off[1]);
    });

    // Mall expansion lines: from the mall dot to each revealed place dot
    if (activeMall && activeMall.marker.getElement().isConnected) {
      var mallPt  = map.project(activeMall.marker.getLngLat());
      var mallOff = activeMall._spiderOffset || [0, 0];
      var mx = mallPt.x + mallOff[0], my = mallPt.y + mallOff[1];
      mallExpandedEntries.forEach(function (e) {
        if (!e.marker.getElement().isConnected) return;
        var pt  = map.project(e.marker.getLngLat());
        var off = e._spiderOffset || [0, 0];
        drawSpiderPolygon(svg, mx, my, pt.x + off[0], pt.y + off[1]);
      });
    }
  }

  function runSpiderfy(anchorSelected, warmStart) {
    cancelSpiderAnim();

    var NORMAL_RADIUS   = 11;
    var SELECTED_RADIUS = 18;
    var MAX_ITER = 100;
    var DURATION = 400;

    var items = [];
    allPlaceEntries.forEach(function (entry) {
      if (!entry.marker.getElement().isConnected) return;
      var lngLat = entry.marker.getLngLat();
      var pt = map.project(lngLat);
      var isSelected = entry.marker.getElement() === selectedMarkerEl;
      var prev = entry._spiderOffset || [0, 0];
      items.push({ entry: entry, marker: entry.marker, lngLat: lngLat,
                   origX: pt.x, origY: pt.y, isSelected: isSelected, prev: prev });
    });

    // Pass 1 — natural layout
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

    // Pass 2 — selection layout
    var SNAP_THRESHOLD_SQ = (NORMAL_RADIUS * 4) * (NORMAL_RADIUS * 4);
    var fin = items.map(function (item, idx) {
      var prevX = item.origX + item.prev[0], prevY = item.origY + item.prev[1];
      if (warmStart) return { x: prevX, y: prevY };
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

    items.forEach(function (item, idx) {
      item.startOx = item.prev[0];
      item.startOy = item.prev[1];
      item.targetOx = fin[idx].x - item.origX;
      item.targetOy = fin[idx].y - item.origY;
    });

    var startTime = performance.now();

    function frame(now) {
      var t = Math.min((now - startTime) / DURATION, 1);
      var ease = 1 - Math.pow(1 - t, 3);

      items.forEach(function (item) {
        var ox = item.startOx + (item.targetOx - item.startOx) * ease;
        var oy = item.startOy + (item.targetOy - item.startOy) * ease;
        if (Math.abs(ox) < 0.5 && Math.abs(oy) < 0.5) { ox = 0; oy = 0; }

        item.marker.setOffset([ox, oy]);
        item.entry._spiderOffset = [ox, oy];
      });
      updateSpiderLines();
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
    map.on('mousemove', 'distance-line', function () { distanceHover.line = true;  applyDistanceFade(); });
    map.on('mouseleave', 'distance-line', function () { distanceHover.line = false; applyDistanceFade(); });
  }

  function applyDistanceFade() {
    var opacity = (distanceHover.line || distanceHover.label) ? 0.1 : 1;
    map.setPaintProperty('distance-line', 'line-opacity', opacity);
    if (distanceLabelMarker) distanceLabelMarker.getElement().style.opacity = opacity;
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
      labelMoveListener = function (e) {
        var rect = el.getBoundingClientRect();
        var over = e.clientX >= rect.left && e.clientX <= rect.right &&
                   e.clientY >= rect.top  && e.clientY <= rect.bottom;
        if (over !== distanceHover.label) {
          distanceHover.label = over;
          applyDistanceFade();
        }
      };
      map.getContainer().addEventListener('mousemove', labelMoveListener);

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
    if (labelMoveListener) { map.getContainer().removeEventListener('mousemove', labelMoveListener); labelMoveListener = null; }
    distanceHover.line = false;
    distanceHover.label = false;
  }

  // --- Side panel ------------------------------------------
  function openPanel(place, markerEl, opts) {
    opts = opts || {};
    currentPlace = place;
    if (!opts.keepSelection) {
      if (selectedMarkerEl) getDot(selectedMarkerEl).classList.remove('selected');
      selectedMarkerEl = markerEl || null;
      if (selectedMarkerEl) getDot(selectedMarkerEl).classList.add('selected');
      runSpiderfy(true);
    }

    // Determine which category label/color to show: first active category in priority order
    var cats = getCategories(place);
    var activeCatId = cats[0];
    if (!activeCategories.has('all')) {
      for (var i = 0; i < cats.length; i++) {
        if (activeCategories.has(cats[i])) { activeCatId = cats[i]; break; }
      }
    }
    var color = colorMap[activeCatId] || '#738e99';
    var label = labelMap[activeCatId] || activeCatId;

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
    collapseMall();
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
      if (!r.ok) return {};
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
          var zoomChanged = lastZoom === null || zoom !== lastZoom;
          lastZoom = zoom;
          if (zoomChanged) updateMallZoomVisibility();
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

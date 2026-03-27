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

  var STYLE_URL = 'https://api.maptiler.com/maps/019d2ac4-1b5c-7824-a78a-30cdcb276433/style.json?key=gctDBtFwdnIhG8N9CFpi';

  // --- DOM refs --------------------------------------------
  var filterBar     = document.getElementById('filter-bar');
  var filterToggle  = document.getElementById('filter-toggle');
  var filterOverlay = document.getElementById('filter-overlay');
  var sidePanel     = document.getElementById('side-panel');
  var panelClose = document.getElementById('panel-close');
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

  // --- Init map --------------------------------------------
  function initMap(center) {
    map = new maplibregl.Map({
      container: 'map',
      style: STYLE_URL,
      center: [center.lng, center.lat],
      zoom: 11,
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
    var el = document.createElement('div');
    el.style.width        = '16px';
    el.style.height       = '16px';
    el.style.borderRadius = '50%';
    el.style.background   = color;
    el.style.border       = '2px solid #fff';
    el.style.boxShadow    = '0 1px 4px rgba(0,0,0,0.3)';
    el.style.cursor       = 'pointer';
    return el;
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
      var color   = colorMap[place.category] || '#607D8B';
      var iconUrl = PLACE_ICONS[place.name] || CATEGORY_ICONS[place.category];
      var el      = iconUrl ? makePinEl(iconUrl) : makeCircleEl(color);

      var popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: iconUrl ? 25 : 12,
        className: 'place-tooltip',
      }).setText(place.name);

      el.addEventListener('mouseenter', function () {
        popup.setLngLat([place.lng, place.lat]).addTo(map);
      });
      el.addEventListener('mouseleave', function () {
        popup.remove();
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

        openPanel(place, colorMap, labelMap);
      });

      var marker = new maplibregl.Marker({
        element: el,
        anchor: iconUrl ? 'bottom' : 'center',
      })
        .setLngLat([place.lng, place.lat])
        .addTo(map);

      markerGroups[place.category].push({ marker: marker, popup: popup });
    });
  }

  // --- Side panel ------------------------------------------
  function openPanel(place, colorMap, labelMap) {
    currentPlace = place;
    var color = colorMap[place.category] || '#607D8B';
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
    setTimeout(function () { map.resize(); }, 260);
  }

  function closePanel() {
    sidePanel.classList.remove('open');
    sidePanel.setAttribute('aria-hidden', 'true');
    currentPlace = null;
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
        addHomeMarker(allData.center);
        buildFilterButtons(allData.categories);
        buildMarkers(allData.places, allData.categories);

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

  document.addEventListener('click', function (e) {
    if (!filterOverlay.contains(e.target)) {
      filterBar.classList.remove('open');
      filterToggle.setAttribute('aria-expanded', 'false');
      filterBar.setAttribute('aria-hidden', 'true');
    }
  });

  // --- Close panel -----------------------------------------
  panelClose.addEventListener('click', closePanel);

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

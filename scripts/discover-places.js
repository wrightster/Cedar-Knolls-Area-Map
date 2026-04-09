/* ============================================================
   discover-places.js
   Discovers new POI candidates via Google Places Nearby Search
   and merges approved ones into amenities.json.

   Modes:
     --discover   Query the API, write candidates.json
     --merge      Append candidates.json entries to amenities.json
     --overwrite  Replace all places in amenities.json with candidates.json

   Usage:
     GOOGLE_PLACES_API_KEY=xxx node scripts/discover-places.js --discover
     # review candidates.json, delete unwanted entries
     node scripts/discover-places.js --merge
     node scripts/discover-places.js --overwrite

   Requires Node >= 18 (built-in fetch).
   ============================================================ */

'use strict';

const fs   = require('fs');
const path = require('path');

const AMENITIES_PATH  = path.join(__dirname, '..', 'amenities.json');
const CANDIDATES_PATH = path.join(__dirname, '..', 'candidates.json');
const DELAY_MS        = 300;
const PAGE_DELAY_MS   = 2000; // Google requires a pause before fetching next_page_token
const MAX_PAGES       = 3;

const KEY = process.env.GOOGLE_PLACES_API_KEY;

// Optional --radius=N override (miles). Falls back to amenities.json radiusMiles or 15.
const _radiusArg = process.argv.find(a => a.startsWith('--radius='));
const RADIUS_OVERRIDE = _radiusArg ? parseFloat(_radiusArg.split('=')[1]) : null;


// Category → Google Places type mappings (one entry per API query)
const CATEGORY_QUERIES = [
  { category: 'grocery',    type: 'supermarket'           },
  { category: 'grocery',    type: 'grocery_or_supermarket'},
  { category: 'restaurant', type: 'restaurant'            },
  { category: 'restaurant', type: 'meal_takeaway'         },
  { category: 'restaurant', type: 'fast_food'             },
  { category: 'cafe',       type: 'cafe'                  },
  { category: 'cafe',       type: 'bakery'                },
  { category: 'gym',        type: 'gym'                   },
  { category: 'park',       type: 'park'                  },
  { category: 'school',     type: 'school'                },
  { category: 'school',     type: 'primary_school'        },
  { category: 'school',     type: 'secondary_school'      },
  { category: 'school',     type: 'university'            },
  { category: 'medical',    type: 'hospital'              },
  { category: 'medical',    type: 'pharmacy'              },
  { category: 'medical',    type: 'doctor'                },
  { category: 'medical',    type: 'dentist'               },
  { category: 'church',     type: 'church'                },
  { category: 'church',     type: 'place_of_worship'      },
  { category: 'shopping',   type: 'shopping_mall'         },
  { category: 'shopping',   type: 'department_store'      },
  { category: 'shopping',   type: 'hardware_store'        },
  { category: 'shopping',   type: 'book_store'            },
  { category: 'gas',        type: 'gas_station'           },
  { category: 'shopping',   type: 'liquor_store'          },
  { category: 'bar',        type: 'bar'                   },
  { category: 'bar',        type: 'night_club'            },
];

// Reverse lookup: Google Places type → our category.
// Built from CATEGORY_QUERIES so the mapping stays in sync automatically.
// Earlier entries win when a type appears under multiple categories (unlikely but safe).
const TYPE_TO_CATEGORY = {};
for (const { category, type } of CATEGORY_QUERIES) {
  if (!(type in TYPE_TO_CATEGORY)) TYPE_TO_CATEGORY[type] = category;
}

// Re-order `categories` so the entry whose Google type appears earliest in
// place.types comes first. place.types is ordered most-specific-first by Google.
function sortByPlaceTypes(categories, placeTypes) {
  if (categories.length <= 1 || !placeTypes || !placeTypes.length) return categories;
  return [...categories].sort((a, b) => {
    const posA = placeTypes.findIndex(t => TYPE_TO_CATEGORY[t] === a);
    const posB = placeTypes.findIndex(t => TYPE_TO_CATEGORY[t] === b);
    return (posA === -1 ? Infinity : posA) - (posB === -1 ? Infinity : posB);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
          * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function nearbySearch(lat, lng, radiusMeters, type, pageToken) {
  let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`
          + `?location=${lat},${lng}&radius=${radiusMeters}&type=${type}&key=${KEY}`;
  if (pageToken) url += `&pagetoken=${pageToken}`;
  const res  = await fetch(url);
  const json = await res.json();
  if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
    console.warn(`  API warning [${type}]: ${json.status} — ${json.error_message ?? ''}`);
  }
  return json;
}

async function discover() {
  if (!KEY) {
    console.error('Error: GOOGLE_PLACES_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const data         = JSON.parse(fs.readFileSync(AMENITIES_PATH, 'utf8'));
  const { lat, lng } = data.center;
  const radiusMiles  = RADIUS_OVERRIDE ?? data.radiusMiles ?? 15;
  const radiusMeters = Math.round(radiusMiles * 1609.344);
  console.log(`Search radius: ${radiusMiles} miles (${radiusMeters} m)`);
  const existingIds  = new Set(data.places.map(p => p.placeId).filter(Boolean));
  const maxId        = Math.max(...data.places.map(p => parseInt(p.id, 10)));

  let nextId     = maxId + 1;
  const candidates = [];
  // Map from placeId → index in candidates array.
  // Existing amenities are pre-seeded with sentinel -1 so they're always skipped.
  // New candidates use their array index so later searches can append extra categories.
  const seen = new Map();
  for (const id of existingIds) seen.set(id, -1);

  for (const { category, type } of CATEGORY_QUERIES) {
    process.stdout.write(`Searching ${category} (${type})... `);
    let pageToken = null;
    let pageCount = 0;
    let found     = 0;

    do {
      if (pageToken) await sleep(PAGE_DELAY_MS);
      const json = await nearbySearch(lat, lng, radiusMeters, type, pageToken);
      await sleep(DELAY_MS);

      for (const place of json.results ?? []) {
        if (seen.has(place.place_id)) {
          // Already discovered — append this category if it's new, then re-sort
          const idx = seen.get(place.place_id);
          if (idx >= 0) {
            if (!candidates[idx].categories.includes(category)) {
              candidates[idx].categories.push(category);
              candidates[idx].categories = sortByPlaceTypes(candidates[idx].categories, place.types);
            }
            if ((place.types || []).includes('shopping_mall') &&
                !(candidates[idx].tags || []).includes('mall')) {
              candidates[idx].tags = [...(candidates[idx].tags || []), 'mall'];
            }
          }
          continue;
        }

        const pLat = place.geometry.location.lat;
        const pLng = place.geometry.location.lng;
        const dist = haversineMiles(lat, lng, pLat, pLng);

        const isMallPlace = (place.types || []).includes('shopping_mall');
        seen.set(place.place_id, candidates.length);
        candidates.push({
          id:            String(nextId++),
          name:          place.name,
          categories:    sortByPlaceTypes([category], place.types),
          tags:          isMallPlace ? ['mall'] : [],
          lat:           pLat,
          lng:           pLng,
          address:       place.vicinity ?? '',
          phone:         '',
          website:       '',
          distanceMiles: Math.round(dist * 10) / 10,
          googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
          placeId:       place.place_id,
        });
        found++;
      }

      pageToken = json.next_page_token ?? null;
      pageCount++;
    } while (pageToken && pageCount < MAX_PAGES);

    console.log(`${found} new`);
  }

  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(candidates, null, 2) + '\n');
  console.log(`\nDone. ${candidates.length} candidates written to candidates.json`);
  console.log('Review the file, remove unwanted entries, then run:');
  console.log('  node scripts/discover-places.js --merge');
}

function merge() {
  if (!fs.existsSync(CANDIDATES_PATH)) {
    console.error('Error: candidates.json not found. Run --discover first.');
    process.exit(1);
  }

  const data       = JSON.parse(fs.readFileSync(AMENITIES_PATH, 'utf8'));
  const candidates = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));

  if (!Array.isArray(candidates) || candidates.length === 0) {
    console.log('candidates.json is empty — nothing to merge.');
    return;
  }

  const existingIds = new Set(data.places.map(p => p.placeId).filter(Boolean));
  const toAdd       = candidates.filter(c => !existingIds.has(c.placeId));
  const skipped     = candidates.length - toAdd.length;

  data.places.push(...toAdd);
  fs.writeFileSync(AMENITIES_PATH, JSON.stringify(data, null, 2) + '\n');

  console.log(`Merged ${toAdd.length} entries into amenities.json.`);
  if (skipped > 0) console.log(`Skipped ${skipped} already-present entries.`);
}

function overwrite() {
  if (!fs.existsSync(CANDIDATES_PATH)) {
    console.error('Error: candidates.json not found. Run --discover first.');
    process.exit(1);
  }

  const data       = JSON.parse(fs.readFileSync(AMENITIES_PATH, 'utf8'));
  const candidates = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));

  if (!Array.isArray(candidates) || candidates.length === 0) {
    console.log('candidates.json is empty — nothing to overwrite with.');
    return;
  }

  data.places = candidates;
  fs.writeFileSync(AMENITIES_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`Overwrote amenities.json with ${candidates.length} entries from candidates.json.`);
}

const mode = process.argv[2];
if (mode === '--discover') {
  discover().catch(err => { console.error('Fatal:', err); process.exit(1); });
} else if (mode === '--merge') {
  merge();
} else if (mode === '--overwrite') {
  overwrite();
} else {
  console.error('Usage: node scripts/discover-places.js [--discover | --merge | --overwrite]');
  process.exit(1);
}

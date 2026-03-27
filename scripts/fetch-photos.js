/* ============================================================
   fetch-photos.js
   Downloads one Google Places photo per amenity and writes:
     - assets/photos/{placeId}.jpg  (the image files)
     - photos.json                  (manifest: amenity id → file path)
   Also updates amenities.json in-place with placeId fields.

   Requires Node >= 18 (built-in fetch).
   Usage: GOOGLE_PLACES_API_KEY=xxx node scripts/fetch-photos.js
   ============================================================ */

'use strict';

const fs   = require('fs');
const path = require('path');

const KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!KEY) {
  console.error('Error: GOOGLE_PLACES_API_KEY environment variable is not set.');
  process.exit(1);
}

const AMENITIES_PATH = path.join(__dirname, '..', 'amenities.json');
const PHOTOS_DIR     = path.join(__dirname, '..', 'assets', 'photos');
const PHOTOS_JSON    = path.join(__dirname, '..', 'photos.json');
const DELAY_MS       = 200;  // 5 QPS — well inside Google's default 10 QPS limit

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findPlaceId(name, address) {
  const query = encodeURIComponent(`${name} ${address}`);
  const url   = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json`
              + `?input=${query}&inputtype=textquery&fields=place_id&key=${KEY}`;
  const res  = await fetch(url);
  const json = await res.json();
  return json.candidates?.[0]?.place_id ?? null;
}

async function getPhotoReference(placeId) {
  const url  = `https://maps.googleapis.com/maps/api/place/details/json`
             + `?place_id=${placeId}&fields=photos&key=${KEY}`;
  const res  = await fetch(url);
  const json = await res.json();
  return json.result?.photos?.[0]?.photo_reference ?? null;
}

async function downloadPhoto(photoRef, destPath) {
  const url = `https://maps.googleapis.com/maps/api/place/photo`
            + `?maxwidth=800&photo_reference=${photoRef}&key=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return true;
}

async function main() {
  const data   = JSON.parse(fs.readFileSync(AMENITIES_PATH, 'utf8'));
  const places = data.places;
  const photosMap = {};

  console.log(`Processing ${places.length} places...\n`);

  for (const place of places) {
    process.stdout.write(`[${place.id}] ${place.name} ... `);

    // Step 1: resolve place_id (cached in amenities.json after first run)
    if (!place.placeId) {
      place.placeId = await findPlaceId(place.name, place.address);
      await sleep(DELAY_MS);
    }

    if (!place.placeId) {
      console.log('no place found, skipping.');
      continue;
    }

    // Step 2: get photo reference
    const photoRef = await getPhotoReference(place.placeId);
    await sleep(DELAY_MS);

    if (!photoRef) {
      console.log('no photo reference, skipping.');
      continue;
    }

    // Step 3: download photo
    const fileName = `${place.placeId}.jpg`;
    const destPath = path.join(PHOTOS_DIR, fileName);
    const ok = await downloadPhoto(photoRef, destPath);
    await sleep(DELAY_MS);

    if (!ok) {
      console.log('photo download failed, skipping.');
      continue;
    }

    const relPath = `assets/photos/${fileName}`;
    photosMap[place.id] = relPath;
    console.log(`saved → ${relPath}`);
  }

  // Write updated amenities.json (with placeId fields)
  fs.writeFileSync(AMENITIES_PATH, JSON.stringify(data, null, 2) + '\n');

  // Write photos.json manifest
  fs.writeFileSync(PHOTOS_JSON, JSON.stringify(photosMap, null, 2) + '\n');

  const count = Object.keys(photosMap).length;
  console.log(`\nDone. ${count} of ${places.length} places have photos.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

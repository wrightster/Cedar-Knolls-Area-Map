# Cedar Knolls Area Map

An interactive web map that shows local amenities near the **Cedar Knolls subdivision** in Youngsville, NC. Residents can browse nearby grocery stores, restaurants, parks, schools, gyms, churches, coffee shops, medical facilities, and shopping centers — all within about 15 miles of the neighborhood.

## What it does

- Displays pins on a map for each place of interest
- Filter by category (Grocery, Parks, Schools, etc.) using the buttons at the top
- Click any pin to open a side panel with the place's name, address, phone number, website, and a photo
- Photos are sourced from Google and automatically refreshed every month

## Project structure

```
Cedar-Knolls-Area-Map/
├── index.html            # The map page — open this in a browser
├── amenities.json        # The list of all places shown on the map
├── photos.json           # Tracks which places have photos downloaded
├── assets/
│   └── photos/           # Downloaded place photos (one per location)
├── css/
│   └── style.css         # Visual styling
├── js/
│   └── map.js            # All map logic (pins, filters, side panel)
└── scripts/
    ├── fetch-photos.js   # Downloads photos from Google for each place
    └── discover-places.js  # Searches Google for new nearby places to add
```

## Running the map locally

You need [Node.js](https://nodejs.org) installed (version 18 or newer).

**First time only** — install the local dev server:

```bash
npm install
```

**Start the map:**

```bash
npm run dev
```

Then open your browser and go to `http://localhost:3000`. The map will load automatically.

> You can also open `index.html` directly in a browser, but some browsers block local file requests — using the dev server avoids that.

---

## Managing places (`amenities.json`)

All the pins on the map come from `amenities.json`. It's a plain text file you can open in any text editor. Each place looks like this:

```json
{
  "id": "1",
  "name": "Food Lion",
  "category": "grocery",
  "lat": 36.039,
  "lng": -78.496,
  "address": "1160 US-1 N, Youngsville, NC 27596",
  "phone": "(919) 554-1639",
  "website": "https://www.foodlion.com",
  "distanceMiles": 4,
  "googleMapsUrl": "https://maps.google.com/?q=...",
  "placeId": "ChIJFQ_N57lSrIkRCZuFGx0mnTg"
}
```

**To add a place manually:** copy an existing entry, paste it at the end of the `"places"` array, and fill in the details. Make sure the `id` is unique (just use the next number in sequence). The `placeId` is optional but needed for photo fetching — you can find it via the [Google Places API](https://developers.google.com/maps/documentation/places/web-service/place-id) or leave it blank.

**Categories available:** `grocery`, `restaurant`, `coffee`, `gym`, `park`, `school`, `medical`, `church`, `shopping`

---

## Scripts

Both scripts require a **Google Places API key**. You set it as an environment variable before running the command — it is never stored in any file.

### Getting a Google Places API key

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or select an existing one)
3. Enable the **Places API**
4. Under "Credentials", create an API key
5. Copy the key — you'll paste it into the commands below

---

### Script 1: `fetch-photos.js` — Download place photos

This script goes through every place in `amenities.json`, looks it up on Google, and downloads one photo for it. Photos are saved in `assets/photos/` and the map displays them in the side panel when you click a pin.

**This script runs automatically** on the 1st of every month via GitHub Actions. You only need to run it manually if you've just added new places and want their photos right away.

**Run it:**

```bash
GOOGLE_PLACES_API_KEY=your_key_here node scripts/fetch-photos.js
```

On Windows (Command Prompt):
```cmd
set GOOGLE_PLACES_API_KEY=your_key_here && node scripts/fetch-photos.js
```

On Windows (PowerShell):
```powershell
$env:GOOGLE_PLACES_API_KEY="your_key_here"; node scripts/fetch-photos.js
```

**What happens:**
- For each place, it looks up the place on Google using the name and address
- It saves the `placeId` back into `amenities.json` (so future runs skip the lookup step)
- It downloads one photo and saves it as `assets/photos/{placeId}.jpg`
- It writes a `photos.json` file that tells the map which photos are available
- Places with no Google listing or no photo are skipped with a message

---

### Script 2: `discover-places.js` — Find new nearby places

This script searches Google for places near Cedar Knolls that aren't already in `amenities.json`. It's useful for discovering businesses you might have missed — especially in areas like Creedmoor or Franklinton.

The process has two steps so you can **review before anything is added to the map.**

---

#### Step 1: Discover candidates

```bash
GOOGLE_PLACES_API_KEY=your_key_here node scripts/discover-places.js --discover
```

On Windows (Command Prompt):
```cmd
set GOOGLE_PLACES_API_KEY=your_key_here && node scripts/discover-places.js --discover
```

On Windows (PowerShell):
```powershell
$env:GOOGLE_PLACES_API_KEY="your_key_here"; node scripts/discover-places.js --discover
```

**What happens:**
- Searches Google Places for each category (grocery, restaurants, gyms, etc.) within 15 miles of Cedar Knolls
- Skips any places already in `amenities.json`
- Writes the results to a new file called `candidates.json`
- Nothing in `amenities.json` is changed yet

**Example output:**
```
Searching grocery (supermarket)... 14 new
Searching restaurant (restaurant)... 51 new
Searching coffee (cafe)... 18 new
...
Done. 183 candidates written to candidates.json
```

---

#### Step 2: Review `candidates.json`

Open `candidates.json` in a text editor. It contains a list of places Google found. Go through it and **delete any entries you don't want** — chains you don't care about, duplicate names, places outside the area, etc.

Each entry looks like:
```json
{
  "id": "40",
  "name": "Creedmoor Grocery",
  "category": "grocery",
  "lat": 36.118,
  "lng": -78.683,
  "address": "123 Main St, Creedmoor, NC",
  "phone": "",
  "website": "",
  "distanceMiles": 11.4,
  "googleMapsUrl": "https://www.google.com/maps/place/?q=place_id:ChIJ...",
  "placeId": "ChIJ..."
}
```

> Note: `phone` and `website` are left blank by the discovery script. You can fill them in manually if you want them to appear in the side panel, or leave them empty.

---

#### Step 3: Merge into the map

Once you're happy with what's in `candidates.json`, run:

```bash
node scripts/discover-places.js --merge
```

**What happens:**
- Reads `candidates.json`
- Appends all remaining entries to `amenities.json`
- Skips any that already exist (safe to run multiple times)
- Prints how many were added

After merging, reload the map in your browser — the new pins will appear immediately.

---

#### Step 4: Download photos for the new places

Run the photo script to get images for your newly added places:

```bash
GOOGLE_PLACES_API_KEY=your_key_here node scripts/fetch-photos.js
```

---

## Automated photo updates (GitHub Actions)

Photos are automatically refreshed on the **1st of every month** by a GitHub Actions workflow (`.github/workflows/update-photos.yml`). It runs `fetch-photos.js`, then commits any new or updated photos back to the repository.

To set this up, you need to add your API key as a repository secret:

1. Go to your repository on GitHub
2. Click **Settings → Secrets and variables → Actions**
3. Click **New repository secret**
4. Name: `GOOGLE_PLACES_API_KEY`, Value: your API key
5. Save

You can also trigger the workflow manually at any time from the **Actions** tab on GitHub.

---

## License

[AGPL-3.0](LICENSE)

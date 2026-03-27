# Security Review — Cedar Knolls Area Map

_Reviewed: 2026-03-27_

## Summary

This is a static web application with no server-side code and no user input. The attack surface is small, but there are a few issues to address before live deployment.

---

## Findings

### Critical

**MapTiler API key hardcoded in `js/map.js:21`**

The key `gctDBtFwdnIhG8N9CFpi` is visible in source code and the public GitHub repo. Anyone can find it via DevTools or the repo and abuse your MapTiler quota.

Actions:
1. Rotate the key immediately in the MapTiler dashboard
2. Add a domain restriction to the new key (MapTiler supports "allowed origins")
3. Since this is a static site with no server, domain restriction is the most practical mitigation — the key will still be visible in source, but unusable from other domains

---

### High

**`innerHTML` used for phone number rendering (`js/map.js:555`)**

```js
panelPhone.innerHTML = '<a href="tel:+1' + tel + '"...>' + place.phone + '</a>';
```

`place.phone` is injected unescaped into the DOM. The data source is a checked-in JSON file (trusted), but this is an unsafe pattern. Recommended fix:

```js
const a = document.createElement('a');
a.href = 'tel:+1' + tel;
a.style.cssText = 'color:inherit;text-decoration:none;';
a.textContent = place.phone;
panelPhone.replaceChildren(a);
```

**No Content Security Policy or Subresource Integrity**

MapLibre GL is loaded from `unpkg.com` with no `integrity` attribute. If the CDN is compromised, arbitrary JS runs in the page. SRI hashes should be added to the `<link>` and `<script>` tags for MapLibre, and a Content Security Policy header (or `<meta>` tag) should be added to `index.html`.

---

### Medium

**GitHub Actions workflow has `contents: write` permission** — the photo update bot can push commits to `main`. Low practical risk for a solo project, but broader than necessary.

---

### Low / Non-issues

- No user input, no forms, no URL parameter parsing — minimal attack surface
- Google Places API key is properly stored in GitHub Secrets, not in code
- All external resources use HTTPS; no mixed content
- No localStorage, no cookies, no analytics or tracking
- `textContent` is used correctly everywhere else in the JS — only the one phone number field uses `innerHTML`

---

## Prioritized Actions

1. **Rotate the MapTiler key + add domain restriction** — do this before deploying
2. **Fix the `innerHTML` phone number pattern** (`js/map.js:555`)
3. **Add SRI hashes** to MapLibre CDN `<link>` and `<script>` tags in `index.html`
4. **Add a Content Security Policy** — even a permissive one blocks the worst CDN-compromise scenarios

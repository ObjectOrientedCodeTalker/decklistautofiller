// Hosted data: extension info (latest set), the card manifest (passcode -> official name,
// alternate arts, card type) and each site's name overrides:
//   overrides_tsd.json     The Side Deck and Konami's registration site (same card database)
// overrides.json is what 2.0 reads; The Side Deck falls back to it until overrides_tsd.json exists.
//
// Every page load asks GitHub for the current files, so updates reach players right away
// (after GitHub Pages' own ~10-minute edge cache). The request revalidates the browser's
// HTTP cache with the file's ETag, so an unchanged file costs a "304 Not Modified" and no
// download. A copy is kept in chrome.storage only as a fallback for when GitHub can't be
// reached.
var DAF = globalThis.DAF || (globalThis.DAF = {});

(function (DAF) {
  "use strict";

  const API = "https://objectorientedcodetalker.github.io/decklistautofiller_api/";
  const SOURCES = {
    info: { url: API + "info.json" },
    manifest: { url: API + "manifest.json" },
    overrides: { url: API + "overrides.json", optional: true },
    overrides_tsd: { url: API + "overrides_tsd.json", optional: true, missing: "overrides" },
  };
  const FETCH_TIMEOUT_MS = 10000;

  async function readBackup(key) {
    try {
      const stored = await chrome.storage.local.get(key);
      return stored[key] || null;
    } catch (e) {
      return null;
    }
  }

  async function writeBackup(key, value, version) {
    try {
      await chrome.storage.local.set({ [key]: { value, version, at: Date.now() } });
    } catch (e) {
      /* storage full or unavailable: the fresh copy still works for this page */
    }
  }

  const loading = new Map(); // one request per file per page

  function load(name) {
    if (!loading.has(name)) {
      const promise = fetchFresh(name);
      promise.catch(() => loading.delete(name)); // allow a retry after a failure
      loading.set(name, promise);
    }
    return loading.get(name);
  }

  async function fetchFresh(name) {
    const { url, optional, missing } = SOURCES[name];
    const key = "daf:" + name;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { cache: "no-cache", signal: timeout.signal });
      if (response.status === 404 && missing) return load(missing);
      if (response.status === 404 && optional) return {};
      if (!response.ok) throw new Error("HTTP " + response.status);
      const version = response.headers.get("ETag") || response.headers.get("Last-Modified") || "";
      const value = await response.json();
      // Only rewrite the fallback copy when the file actually changed.
      const backup = await readBackup(key);
      if (!backup || !version || backup.version !== version) await writeBackup(key, value, version);
      return value;
    } catch (error) {
      const backup = await readBackup(key);
      if (backup) return backup.value;
      if (optional) return {};
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  const catalogs = new Map(); // overrides file -> catalog promise

  // Earlier builds remembered "Find it on the site" picks; nothing is remembered now, so
  // clear any saved picks rather than let a wrong one fill again.
  try {
    chrome.storage.local.remove("daf:learned").catch(() => {});
  } catch (e) {
    /* storage unavailable */
  }

  DAF.data = {
    getInfo: () => load("info"),

    imageUrl: (passcode) => API + "card_images_small/" + passcode + ".jpg",

    // The card catalog (see match.js) for a site, built once per page.
    // site: { overrides: "overrides_tsd" } or { overrides: null } for a site that fills by
    // Konami ID and doesn't search names (Neuron).
    getCatalog(site = { overrides: "overrides_tsd" }) {
      const key = site.overrides || "";
      if (!catalogs.has(key)) {
        const promise = Promise.all([load("manifest"), key ? load(key) : {}])
          .then(([manifest, overrides]) => DAF.buildCatalog(manifest, overrides))
          .catch((error) => {
            catalogs.delete(key); // allow a retry
            throw error;
          });
        catalogs.set(key, promise);
      }
      return catalogs.get(key);
    },
  };
})(DAF);

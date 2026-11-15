// Card-name matching between official names (the card manifest) and the names the
// registration site's database uses. No site card values are needed: cards are found by
// searching the site and picking the result whose name matches.
//
// A result matches an official name:
//   1. If overrides.json has the name (official name -> site name), only that site name
//      matches. Used for renames and site typos, and for cards a simulator has swapped:
//      both names listed, each pointing at the other.
//   2. Otherwise exactly, ignoring only case and spacing.
//   3. Otherwise by reduced form: accents folded, ASCII punctuation and spaces ignored, and each
//      special character in the official name (☆ ★ Ω α Ø …) allowed to be any one letter
//      or digit, or nothing (the site writes ☆ as "*", "?" or drops it; Ω as "O"), and
//      each Greek letter written as a word (Omega, Beta) allowed to be that word, its
//      letter or a symbol ("Fiendish Engine Omega" = "Fiendish Engine O", "Falchion Beta"
//      = "Falchionß").
//      Step 3 is skipped for names whose reduced form is shared by another official card
//      (e.g. "Rai-Mei" / "Raimei"), and never accepts a result that is exactly another
//      official card's name.
// Anything else is left for the player to add by hand. Nothing is guessed.
var DAF = globalThis.DAF || (globalThis.DAF = {});

(function (DAF) {
  "use strict";

  const fold = (s) => String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const norm = (s) => String(s).normalize("NFC").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const reduce = (s) => fold(s).replace(/[^a-z0-9]/g, "");
  // Like reduce, but keeps non-ASCII characters the site may have left in (ß, ☆).
  const siteKey = (s) => fold(s).replace(/[\x00-\x7f]/g, (c) => (/[a-z0-9]/.test(c) ? c : ""));

  // Greek letters spelled out in official names, and the Latin letter the site may use.
  const GREEK = {
    alpha: "a", beta: "b", gamma: "g", delta: "d", epsilon: "e", zeta: "z", iota: "i", kappa: "k",
    lambda: "l", mu: "m", nu: "n", xi: "x", omicron: "o", pi: "p", rho: "r", sigma: "s", tau: "t",
    upsilon: "u", omega: "o",
  };
  const tokens = (name) => fold(name).match(/[a-z0-9]+|[^\x00-\x7f]|[\x00-\x7f]/g) || [];
  const hasSpecial = (name) => tokens(name).some((t) => t in GREEK || /[^\x00-\x7f]/.test(t));

  // Pattern for step 3, matched against siteKey(result).
  function specialPattern(name) {
    let out = "";
    for (const t of tokens(name)) {
      if (/^[a-z0-9]+$/.test(t)) out += t in GREEK ? `(?:${t}|${GREEK[t]}|[^\x00-\x7f])` : t;
      else if (/[^\x00-\x7f]/.test(t)) out += "(?:[a-z0-9]|[^\x00-\x7f])?";
    }
    return new RegExp("^" + out + "$");
  }

  const isPlaceholder = (name) => !name || /^\?+$/.test(String(name).trim());

  const TYPES = new Set(["monster", "spell", "trap"]);

  // manifest: { passcode: { card_id, name, alt_art, type, konami_id } }
  // overrides: { officialName: siteName }
  DAF.buildCatalog = function buildCatalog(manifest, overrides) {
    const byPasscode = new Map(); // passcode -> official name
    const typeOf = new Map(); // passcode -> "monster" | "spell" | "trap"
    const konamiIdOf = new Map(); // passcode -> Konami database ID (Neuron's card ID)
    const byName = new Map(); // norm(name) -> { name, passcodes: [base art first] }
    const reducedIndex = new Map(); // reduced -> Set(official names)
    const specials = []; // { name, re }

    for (const [passcode, card] of Object.entries(manifest || {})) {
      if (!card || isPlaceholder(card.name)) continue;
      const name = String(card.name);
      byPasscode.set(String(passcode), name);
      if (TYPES.has(card.type)) typeOf.set(String(passcode), card.type);
      if (Number.isInteger(card.konami_id) && card.konami_id > 0) konamiIdOf.set(String(passcode), card.konami_id);
      const k = norm(name);
      if (!byName.has(k)) byName.set(k, { name, base: [], alt: [] });
      byName.get(k)[card.alt_art ? "alt" : "base"].push(String(passcode));
    }

    for (const entry of byName.values()) {
      const sort = (a, b) => Number(a) - Number(b);
      entry.passcodes = [...entry.base.sort(sort), ...entry.alt.sort(sort)];
      delete entry.base;
      delete entry.alt;
      const r = reduce(entry.name);
      if (!reducedIndex.has(r)) reducedIndex.set(r, new Set());
      reducedIndex.get(r).add(entry.name);
      if (hasSpecial(entry.name)) specials.push({ name: entry.name, re: specialPattern(entry.name) });
    }

    const sharedReduced = new Set([...reducedIndex].filter(([, names]) => names.size > 1).map(([r]) => r));

    const siteNameOf = new Map(); // norm(official) -> site name
    const officialOfSite = new Map(); // norm(site name) -> official name
    for (const [official, site] of Object.entries(overrides || {})) {
      if (typeof site !== "string" || official.startsWith("_")) continue;
      siteNameOf.set(norm(official), site);
      officialOfSite.set(norm(site), official);
    }

    const officialFor = (name) => (byName.get(norm(name)) || {}).name || null;

    // Step 3 test: could this site text be a rendering of this official name?
    function reducedMatch(official, text) {
      if (sharedReduced.has(reduce(official))) return false;
      const exact = officialFor(text);
      if (exact && norm(exact) !== norm(official)) return false;
      return hasSpecial(official) ? specialPattern(official).test(siteKey(text)) : reduce(text) === reduce(official);
    }

    function choose(candidates) {
      const names = [...new Set(candidates.map((c) => norm(c.text)))];
      if (names.length === 1) return { ok: true, option: candidates[0] };
      return { ok: false, reason: "ambiguous", candidates: [...new Set(candidates.map((c) => c.text))] };
    }

    return {
      size: byName.size,

      // Official name for a passcode, or null.
      nameOf: (passcode) => byPasscode.get(String(passcode)) || null,

      // "monster", "spell" or "trap", or null when the card data doesn't say.
      typeOf: (passcode) => typeOf.get(String(passcode)) || null,

      // Konami's database ID for the card, or null.
      konamiIdOf: (passcode) => konamiIdOf.get(String(passcode)) || null,

      // Image passcodes for an official name, preferred art first.
      passcodesFor(officialName, preferred) {
        const entry = byName.get(norm(officialName));
        const list = entry ? entry.passcodes : [];
        return preferred ? [String(preferred), ...list.filter((p) => p !== String(preferred))] : list;
      },

      // What to type into the site's search box, best first (at most three searches).
      searchTerms(officialName) {
        const site = siteNameOf.get(norm(officialName));
        if (site) return [site];
        const terms = [];
        const add = (t, min = 3) => {
          t = t.trim();
          if (t.length >= min && !terms.some((x) => x.toLowerCase() === t.toLowerCase())) terms.push(t);
        };
        // Accented letters only (no symbols): the site may store the name as-is, at any length ("7").
        if (!/[^\x00-\x7f]/.test(fold(officialName))) add(officialName, 1);
        // Otherwise the longest stretch of plain characters; the site matches anywhere in a name.
        officialName
          .split(/[^\x20-\x7e]+/)
          .sort((a, b) => b.trim().length - a.trim().length)
          .forEach(add);
        // Last resort: the longest single word, in case the site spells accents differently.
        const words = fold(officialName)
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 4)
          .sort((a, b) => b.length - a.length);
        if (words[0]) add(words[0]);
        return terms.slice(0, 3);
      },

      // Picks the site search result for an official name.
      // results: [{ value, text }]. Returns { ok, option } or { ok: false, reason, candidates }.
      pickResult(officialName, results) {
        // An override is the whole answer: it also covers cards a simulator has swapped
        // (each name pointing at the other), where taking the official name would undo it.
        const site = siteNameOf.get(norm(officialName));
        if (site) {
          const viaOverride = results.filter((r) => norm(r.text) === norm(site));
          return viaOverride.length ? choose(viaOverride) : { ok: false, reason: "not-found", candidates: [] };
        }
        const exact = results.filter((r) => norm(r.text) === norm(officialName));
        if (exact.length) return choose(exact);
        const close = results.filter((r) => reducedMatch(officialName, r.text));
        if (close.length) return choose(close);
        return { ok: false, reason: "not-found", candidates: [] };
      },

      // Official name for a name shown on the site's deck list (for images), or null.
      officialForSiteName(text) {
        const exact = officialFor(text);
        if (exact) return exact;
        const viaOverride = officialOfSite.get(norm(text));
        if (viaOverride) return viaOverride;
        const r = reduce(text);
        const found = new Set();
        for (const name of reducedIndex.get(r) || []) if (!hasSpecial(name) && !sharedReduced.has(r)) found.add(name);
        const k = siteKey(text);
        for (const s of specials) if (!sharedReduced.has(reduce(s.name)) && s.re.test(k)) found.add(s.name);
        return found.size === 1 ? [...found][0] : null;
      },
    };
  };

  DAF.match = { fold, norm, reduce, hasSpecial };
})(DAF);

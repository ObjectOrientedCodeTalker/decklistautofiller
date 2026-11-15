// Deck input parsing (YDKE links and .ydk files) and fill-plan building.
// Content scripts share one isolated world, so modules hang off a single namespace.
var DAF = globalThis.DAF || (globalThis.DAF = {});

(function (DAF) {
  "use strict";

  class DeckError extends Error {}
  DAF.DeckError = DeckError;

  const MAX_COPIES_PER_ADD = 3; // the site's quantity dropdown offers 1-3

  function base64ToPasscodes(b64) {
    if (!b64) return [];
    let bytes;
    try {
      bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    } catch (e) {
      throw new DeckError("The YDKE link is damaged. Export it again and paste the whole link.");
    }
    if (bytes.length % 4 !== 0) {
      throw new DeckError("The YDKE link is cut off. Export it again and paste the whole link.");
    }
    return Array.from(new Uint32Array(bytes.buffer));
  }

  function parseYdke(text) {
    const match = text.match(/ydke:\/\/([A-Za-z0-9+/=]*)!([A-Za-z0-9+/=]*)!([A-Za-z0-9+/=]*)!?/);
    if (!match) {
      throw new DeckError("The YDKE link is incomplete. It needs main, extra and side sections, each ending in “!”.");
    }
    return {
      format: "YDKE link",
      main: base64ToPasscodes(match[1]),
      extra: base64ToPasscodes(match[2]),
      side: base64ToPasscodes(match[3]),
    };
  }

  function parseYdk(text) {
    const deck = { format: ".ydk file", main: [], extra: [], side: [] };
    let section = null;
    // Token-based so .ydk text still parses after a single-line field flattens its newlines.
    for (const token of text.split(/\s+/)) {
      const lower = token.toLowerCase();
      if (lower === "#main") section = "main";
      else if (lower === "#extra") section = "extra";
      else if (lower === "!side") section = "side";
      else if (/^\d+$/.test(token) && section) deck[section].push(Number(token));
    }
    return deck;
  }

  // Accepts whatever the player pasted or dropped and returns passcode lists.
  DAF.parseDeck = function parseDeck(input) {
    const text = String(input || "").trim();
    if (!text) throw new DeckError("Paste a deck first.");
    let deck;
    if (/ydke:\/\//i.test(text)) deck = parseYdke(text);
    else if (/(^|\s)(#main|#extra|!side)(\s|$)/i.test(text)) deck = parseYdk(text);
    else {
      throw new DeckError(
        "This isn’t a YDKE link or .ydk file. Export the deck from Duelingbook, EDOPro or YGO Omega as YDKE and paste it here."
      );
    }
    if (deck.main.length + deck.extra.length + deck.side.length === 0) {
      throw new DeckError("That deck is empty.");
    }
    return deck;
  };

  // Turns passcodes into the rows the site's form needs: one row per distinct card name
  // per section (alternate artworks merge), with the site search terms to use.
  DAF.buildPlan = function buildPlan(deck, catalog) {
    const rows = [];
    const missing = [];
    const sections = [
      ["main", deck.main, false],
      ["extra", deck.extra, false],
      ["side", deck.side, true],
    ];
    for (const [section, passcodes, isSide] of sections) {
      const merged = new Map();
      for (const code of passcodes) {
        const name = catalog.nameOf(code);
        if (!name) {
          const known = missing.find((m) => m.passcode === code && m.section === section);
          if (known) known.copies++;
          else missing.push({ passcode: code, section, copies: 1 });
          continue;
        }
        const key = DAF.match.norm(name);
        if (merged.has(key)) merged.get(key).copies++;
        else {
          merged.set(key, {
            name, passcode: code, type: catalog.typeOf(code), konamiId: catalog.konamiIdOf(code), terms: catalog.searchTerms(name), copies: 1, side: isSide, section,
          });
        }
      }
      for (const card of merged.values()) {
        for (let left = card.copies; left > 0; left -= MAX_COPIES_PER_ADD) {
          rows.push({ ...card, qty: Math.min(left, MAX_COPIES_PER_ADD) });
        }
      }
    }
    return {
      rows,
      missing,
      expected: { main: deck.main.length, extra: deck.extra.length, side: deck.side.length },
    };
  };

  DAF.countCopies = (rows) => rows.reduce((n, r) => n + r.qty, 0);
})(DAF);

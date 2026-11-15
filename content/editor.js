// Adapter for the ASP.NET deck-list editor used by The Side Deck (standard and Genesys
// pages). Everything that depends on the site's markup lives here, so a site change
// means editing one file.
//
// Deck entries render as:
//   <dl id="dlMonsters" location="1">
//     <span class="draggable1 …"><dt>3</dt><dd>Card Name&nbsp;<img class="fake-button" src="…/trash32.png" value="<entry guid>"></dd></span>
//   </dl>
// Locations: 1 Monsters, 2 Spells, 3 Traps, 4 Side, 5 Extra.
var DAF = globalThis.DAF || (globalThis.DAF = {});

(function (DAF) {
  "use strict";

  const SEARCH_TIMEOUT_MS = 10000;
  const CONFIRM_TIMEOUT_MS = 6000;
  const POLL_MS = 40;

  const $ = (sel) => document.querySelector(sel);

  const LISTS = [
    { id: "dlMonsters", section: "main", group: "Monsters" },
    { id: "dlSpells", section: "main", group: "Spells" },
    { id: "dlTraps", section: "main", group: "Traps" },
    { id: "dlSide", section: "side", group: "Side" },
    { id: "dlExtra", section: "extra", group: "Extra" },
  ];

  const el = {
    root: () => $("#MainContent_lblContent"),
    search: () => $("#txtSearch"),
    searchButton: () => $("#btnSearch"),
    results: () => $("#lstCards"),
    quantity: () => $("#cboQuantity") || $("#txtQuantity"),
    sideDeck: () => $("#chkSideDeck"),
    addButton: () => $('input[type="button"][value="Add Card"], button[value="Add Card"]'),
    count: (id) => $("#MainContent_lbl" + id),
  };

  class FillStepError extends Error {
    constructor(reason, message) {
      super(message);
      this.reason = reason;
    }
  }
  DAF.FillStepError = FillStepError;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(test, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (test()) return true;
      await sleep(POLL_MS);
    }
    return false;
  }

  const isBusy = () => document.body.classList.contains("loading");

  function readCount(id) {
    const node = el.count(id);
    const n = node ? parseInt(node.textContent, 10) : NaN;
    return Number.isFinite(n) ? n : 0;
  }

  // The search result list as [{ value, text }].
  function readResults() {
    const list = el.results();
    // Genesys pages show "Trickstar Candina (0 Points)" but carry the bare name in cname.
    return list ? Array.from(list.options).map((o) => ({ value: o.value, text: o.getAttribute("cname") || cleanName(o.textContent) })) : [];
  }

  // Runs one site search and waits for it to finish. The site marks requests with
  // body.loading; an observer catches that even when the request is very quick.
  async function runSearch(term) {
    let activity = false;
    const observer = new MutationObserver(() => (activity = true));
    observer.observe(el.results(), { childList: true, subtree: true, characterData: true });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    setField(el.search(), (n) => (n.value = term));
    el.searchButton().click();
    await waitFor(() => activity && !isBusy(), SEARCH_TIMEOUT_MS);
    await sleep(POLL_MS);
    await waitFor(() => !isBusy(), SEARCH_TIMEOUT_MS);
    observer.disconnect();
    return readResults();
  }

  function setField(node, apply) {
    apply(node);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Card name as shown on the page, minus spacing quirks and a Genesys "(3 Points)" suffix.
  const cleanName = (text) =>
    text
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s*\(\s*-?\d+\s+points?\s*\)$/i, "");

  // Signature of the page's own state, used to confirm an add or remove actually landed
  // even if the counters are slow: total counts plus the number of rendered entries.
  function pageSignature() {
    const c = DAF.editors.tsd.counts();
    return c.main + c.extra + c.side + "|" + DAF.editors.tsd.entries().length;
  }

  DAF.editors = DAF.editors || {};
  DAF.editors.tsd = {
    // Which overrides file this site's card names need (see data.js).
    data: { overrides: "overrides_tsd" },
    // What the player presses once the list is filled.
    nextStep: "Verify this Deck List",
    // The site's written list shows names only, so the extension adds a visual deck list.
    hasVisualList: true,

    detect() {
      return !!(el.root() && el.search() && el.searchButton() && el.results() && el.sideDeck() && el.addButton() && el.quantity());
    },

    variant() {
      return $("#MainContent_cboPoints") ? "genesys" : "standard";
    },

    // Where the fill panel goes: right above the manual card search, since it replaces it.
    mountPoint() {
      const searchRow = el.search().closest(".col-sm-6");
      const row = searchRow && searchRow.parentElement && searchRow.parentElement.classList.contains("row") ? searchRow.parentElement : null;
      return row ? { parent: row.parentElement, before: row } : { parent: el.root(), before: el.root().firstChild };
    },

    // Where the visual deck list goes: between the search/add controls and the written list.
    deckListMountPoint() {
      const root = el.root();
      let node = $("#dlMonsters");
      if (!node || !root.contains(node)) return null;
      while (node.parentElement && node.parentElement !== root) node = node.parentElement;
      return node.parentElement === root ? { parent: root, before: node } : null;
    },

    counts() {
      const main = readCount("Monsters") + readCount("Spells") + readCount("Traps");
      return { main, extra: readCount("Extra"), side: readCount("SideDeck") };
    },

    // Every entry in the written list, in page order.
    entries() {
      const out = [];
      for (const list of LISTS) {
        const dl = document.getElementById(list.id);
        if (!dl) continue;
        for (const dd of dl.querySelectorAll("dd")) {
          const dt = dd.previousElementSibling && dd.previousElementSibling.tagName === "DT" ? dd.previousElementSibling : null;
          const qty = dt ? parseInt(dt.textContent, 10) : 1;
          out.push({
            name: cleanName(dd.textContent),
            qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
            section: list.section,
            group: list.group,
            remove: dd.querySelector("img.fake-button, img[src*='trash']"),
          });
        }
      }
      return out;
    },

    // Calls back (debounced) whenever the written list or its counters change.
    observe(callback) {
      let timer = null;
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(callback, 60);
      });
      observer.observe(el.root(), { childList: true, subtree: true, characterData: true });
      return () => observer.disconnect();
    },

    get canClear() {
      return true;
    },

    // row: { name (official), terms (site search terms), qty, side }; catalog from match.js.
    async addCard(row, catalog) {
      await waitFor(() => !isBusy(), SEARCH_TIMEOUT_MS);

      // The previous search's results often already hold this card (e.g. Dark Magician
      // after Dark Magician Girl), which saves a search.
      let pick = catalog.pickResult(row.name, readResults());
      for (const term of row.terms) {
        if (pick.ok) break;
        pick = catalog.pickResult(row.name, await runSearch(term));
        if (pick.reason === "ambiguous") break;
      }
      if (!pick.ok) {
        if (pick.reason === "ambiguous") {
          throw new FillStepError(
            "ambiguous",
            `More than one card on the site fits this name: ${pick.candidates.join(", ")}.`
          );
        }
        throw new FillStepError("not-found", `The site’s card search didn’t find it (searched “${row.terms[0] || row.name}”).`);
      }

      await this.addResult(pick.option.value, row);
    },

    // Adds the search result with this value, in row.qty copies, to the main or side deck.
    async addResult(value, row) {
      if (!readResults().some((r) => r.value === value)) {
        throw new FillStepError("not-found", "That result is no longer in the card search.");
      }
      setField(el.results(), (n) => (n.value = value));
      setField(el.quantity(), (n) => (n.value = String(row.qty)));
      setField(el.sideDeck(), (n) => (n.checked = row.side));

      const before = pageSignature();
      el.addButton().click();
      const changed = await waitFor(() => !isBusy() && pageSignature() !== before, CONFIRM_TIMEOUT_MS);
      if (!changed) throw new FillStepError("unconfirmed", "Clicked Add Card, but the list didn’t change.");
    },

    // Removes every entry using the site's own trash buttons, one at a time.
    // Stops between entries when the signal aborts. Returns how many cards were removed.
    async clearAll({ signal, onProgress } = {}) {
      const startTotal = this.entries().reduce((n, e) => n + e.qty, 0);
      let stalls = 0;
      while (!(signal && signal.aborted)) {
        await waitFor(() => !isBusy(), SEARCH_TIMEOUT_MS);
        const entries = this.entries();
        const left = entries.reduce((n, e) => n + e.qty, 0);
        onProgress && onProgress({ left, total: startTotal, entry: entries[0] });
        if (!entries.length) break;
        const target = entries.find((e) => e.remove);
        if (!target) throw new FillStepError("no-remove", "Couldn’t find the remove buttons on this page.");
        const before = pageSignature();
        target.remove.click();
        const changed = await waitFor(() => !isBusy() && pageSignature() !== before, CONFIRM_TIMEOUT_MS);
        if (!changed && ++stalls >= 2) {
          throw new FillStepError("unconfirmed", "Clicked remove, but the list didn’t change.");
        }
      }
      const left = this.entries().reduce((n, e) => n + e.qty, 0);
      return startTotal - left;
    },
  };
})(DAF);

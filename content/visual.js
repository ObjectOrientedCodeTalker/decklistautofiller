// Visual deck list: card images for every copy in the written list, kept in sync with
// the page, plus the Clear deck control. Sits between the card search and the written list.
var DAF = globalThis.DAF || (globalThis.DAF = {});

(function (DAF) {
  "use strict";

  const h = DAF.h;
  const COLLAPSE_KEY = "daf:visualCollapsed";
  const SECTIONS = [
    { key: "main", title: "Main Deck" },
    { key: "side", title: "Side Deck" },
    { key: "extra", title: "Extra Deck" },
  ];

  // Art chosen by the player's own deck file wins over the database's first match.
  DAF.preferredArt = DAF.preferredArt || new Map();

  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");

  DAF.mountVisualDeck = function mountVisualDeck(editor) {
    const spot = editor.deckListMountPoint();
    if (!spot) return null;

    const state = {
      collapsed: false,
      confirming: false,
      clearing: null, // { left, total }
      error: "",
      catalog: null,
      controller: null,
    };

    const { host, shadow } = DAF.makeHost("decklist-auto-filler-visual", ["content/panel.css", "content/visual.css"]);
    if (editor.visualGaps) {
      host.style.setProperty("--daf-gap-top", editor.visualGaps.above);
      host.style.setProperty("--daf-gap", editor.visualGaps.below);
    }    const panel = h("section", { class: "panel visual", "aria-labelledby": "daf-visual-title" });
    const peek = h("div", { class: "peek", "aria-hidden": "true" }, h("img", { alt: "" }), h("p", { class: "peek-name" }));
    shadow.append(panel, peek);
    spot.parent.insertBefore(host, spot.before);

    const tiles = new Map(); // key -> tile element, reused so images don't reload
    let rendered = false;

    // ---- data -------------------------------------------------------------

    // A catalog that fails to load leaves tiles showing card names instead of images.
    const emptyCatalog = { officialForSiteName: () => null, passcodesFor: () => [] };
    DAF.data
      .getCatalog(editor.data)
      .then((catalog) => {
        state.catalog = catalog;
        for (const tile of tiles.values()) tile._resolved = false;
        render();
      })
      .catch(() => {
        state.catalog = emptyCatalog;
        render();
      });

    chrome.storage.local
      .get(COLLAPSE_KEY)
      .then((s) => {
        if (s[COLLAPSE_KEY]) {
          state.collapsed = true;
          render();
        }
      })
      .catch(() => {});

    editor.observe(() => render());
    DAF.page.onBusyChange(() => render());

    // ---- images -----------------------------------------------------------

    // The page shows the site's spelling (e.g. "Cooky*Yummy"); images are filed by passcode
    // under the official name (Cooky☆Yummy). Art from the player's own deck file comes first.
    function candidatesFor(siteName) {
      if (!state.catalog) return null;
      const official = state.catalog.officialForSiteName(siteName);
      if (!official) return [];
      return state.catalog.passcodesFor(official, DAF.preferredArt.get(DAF.match.norm(official)));
    }

    function resolveTile(tile) {
      if (tile._resolved) return;
      const candidates = candidatesFor(tile._name);
      if (!candidates) return; // catalog still loading; tile stays a placeholder
      tile._resolved = true;
      const img = tile.querySelector("img");
      let i = 0;
      const next = () => {
        if (i >= candidates.length) {
          img.removeAttribute("src");
          tile.classList.add("missing");
          tile.classList.remove("loading");
          return;
        }
        img.src = DAF.data.imageUrl(candidates[i++]);
      };
      img.onerror = next;
      img.onload = () => tile.classList.remove("loading");
      next();
    }

    function makeTile(key, name, isNew) {
      const tile = h(
        "div",
        { class: "card loading" + (isNew ? " enter" : "") },
        h("img", { alt: "", width: "268", height: "391", loading: "lazy", decoding: "async", draggable: "false" }),
        h("span", { class: "fallback-name" }, name)
      );
      tile._name = name;
      tile._key = key;
      return tile;
    }

    // ---- hover preview ----------------------------------------------------

    function showPeek(tile) {
      const img = tile.querySelector("img");
      const peekImg = peek.querySelector("img");
      const peekName = peek.querySelector(".peek-name");
      const missing = tile.classList.contains("missing") || !img.currentSrc;
      peek.classList.toggle("text-only", missing);
      if (!missing) peekImg.src = img.currentSrc;
      peekName.textContent = tile._name;

      const r = tile.getBoundingClientRect();
      const width = 220;
      const height = missing ? 64 : Math.round((width * 391) / 268);
      let left = r.right + 12;
      if (left + width > window.innerWidth - 8) left = r.left - 12 - width;
      left = Math.max(8, left);
      const top = Math.min(Math.max(8, r.top + r.height / 2 - height / 2), window.innerHeight - height - 8);
      peek.style.left = left + "px";
      peek.style.top = top + "px";
      peek.classList.add("on");
    }

    const hidePeek = () => peek.classList.remove("on");

    panel.addEventListener("pointerover", (e) => {
      const tile = e.target.closest && e.target.closest(".card");
      if (tile && e.pointerType === "mouse") showPeek(tile);
    });
    panel.addEventListener("pointerout", (e) => {
      const tile = e.target.closest && e.target.closest(".card");
      if (tile && !(e.relatedTarget && tile.contains(e.relatedTarget))) hidePeek();
    });
    window.addEventListener("scroll", hidePeek, { passive: true });
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.confirming) cancelClear();
    });

    // ---- clearing ---------------------------------------------------------

    function askToClear() {
      state.confirming = true;
      state.error = "";
      render();
      panel.querySelector("[data-cancel]")?.focus();
    }

    function cancelClear() {
      state.confirming = false;
      render();
      panel.querySelector("[data-clear]")?.focus();
    }

    async function clearList() {
      state.confirming = false;
      state.controller = new AbortController();
      state.clearing = { left: total(), total: total() };
      DAF.page.setBusy("clearing");
      render();
      try {
        await editor.clearAll({
          signal: state.controller.signal,
          onProgress: (p) => {
            state.clearing = p;
            renderHead();
          },
        });
      } catch (e) {
        state.error = e instanceof DAF.FillStepError ? e.message : "Something went wrong while clearing the list.";
      } finally {
        state.clearing = null;
        state.controller = null;
        DAF.page.setBusy(null);
        render();
        panel.querySelector("[data-clear]")?.focus();
      }
    }

    function stopClear() {
      if (state.controller) state.controller.abort();
      const stop = panel.querySelector("[data-stop-clear]");
      if (stop) {
        stop.disabled = true;
        stop.textContent = "Stopping…";
      }
    }

    function toggleCollapsed() {
      state.collapsed = !state.collapsed;
      hidePeek();
      chrome.storage.local.set({ [COLLAPSE_KEY]: state.collapsed }).catch(() => {});
      render();
    }

    // ---- views ------------------------------------------------------------

    const total = () => editor.entries().reduce((n, e) => n + e.qty, 0);

    function clearControl(count) {
      if (state.clearing) {
        const { left } = state.clearing;
        return [
          h("span", { class: "head-status", role: "status" }, `Removing cards… ${left} left`),
          h("button", { type: "button", class: "text-button", "data-stop-clear": "", onclick: stopClear }, "Stop"),
        ];
      }
      if (state.confirming) {
        return h(
          "span",
          { class: "confirm", role: "group", "aria-label": "Confirm clearing the deck" },
          h("span", { class: "confirm-q" }, `Remove all ${plural(count, "card")} from this list?`),
          h("button", { type: "button", class: "btn btn-sm danger", onclick: clearList }, "Remove all"),
          h("button", { type: "button", class: "btn btn-sm", "data-cancel": "", onclick: cancelClear }, "Cancel")
        );
      }
      if (!count) return null;
      return h(
        "button",
        {
          type: "button",
          class: "text-button danger-text",
          "data-clear": "",
          disabled: DAF.page.busy ? true : null,
          onclick: askToClear,
        },
        "Clear deck"
      );
    }

    function header(entries) {
      const sums = { main: 0, extra: 0, side: 0 };
      for (const e of entries) sums[e.section] += e.qty;
      const count = sums.main + sums.extra + sums.side;
      return h(
        "header",
        { class: "head" },
        h("img", { class: "mark", src: chrome.runtime.getURL("icons/icon32.png"), alt: "", width: 20, height: 20 }),
        h("h3", { id: "daf-visual-title", class: "counts" }, `Main: ${sums.main} • Side: ${sums.side} • Extra: ${sums.extra}`),
        h("span", { class: "tag" }, "Browser extension"),
        h(
          "div",
          { class: "head-links" },
          clearControl(count),
          state.clearing || state.confirming
            ? null
            : h(
                "button",
                {
                  type: "button",
                  class: "collapse",
                  "aria-expanded": String(!state.collapsed),
                  "aria-controls": "daf-visual-body",
                  onclick: toggleCollapsed,
                },
                state.collapsed ? "Show" : "Hide"
              )
        )
      );
    }

    function sectionView(section, entries, seen) {
      const own = entries.filter((e) => e.section === section.key);
      const count = own.reduce((n, e) => n + e.qty, 0);
      // The header carries the counts; sections only need their names.
      const cards = [];
      const labels = [];
      const copyCount = new Map();
      for (const entry of own) {
        labels.push(`${entry.qty} ${entry.name}`);
        for (let c = 0; c < entry.qty; c++) {
          const n = (copyCount.get(entry.name) || 0) + 1;
          copyCount.set(entry.name, n);
          const key = section.key + "|" + entry.name + "|" + n;
          seen.add(key);
          let tile = tiles.get(key);
          if (!tile) {
            tile = makeTile(key, entry.name, rendered);
            tiles.set(key, tile);
          }
          resolveTile(tile);
          cards.push(tile);
        }
      }
      return h(
        "section",
        { class: "deck-section " + section.key },
        h("h4", null, section.title),
        count
          ? h("div", { class: "grid", role: "img", "aria-label": `${section.title}: ${labels.join(", ")}` }, cards)
          : null
      );
    }

    function body(entries) {
      const seen = new Set();
      const content = [];
      if (state.error) content.push(h("div", { class: "notice danger", role: "alert" }, h("p", null, state.error)));
      if (entries.length) {
        const [main, side, extra] = SECTIONS;
        content.push(
          h(
            "div",
            { class: "layout" },
            sectionView(main, entries, seen),
            sectionView(side, entries, seen),
            sectionView(extra, entries, seen)
          )
        );
      }
      for (const key of tiles.keys()) if (!seen.has(key)) tiles.delete(key);
      // An empty list shows only the header (Main: 0 • Side: 0 • Extra: 0), no body.
      const hide = state.collapsed || !content.length;
      return h("div", { class: "body", id: "daf-visual-body", hidden: hide ? true : null }, content);
    }

    function renderHead() {
      const old = panel.querySelector(".head");
      if (old) old.replaceWith(header(editor.entries()));
    }

    function render() {
      const entries = editor.entries();
      panel.classList.toggle("is-collapsed", state.collapsed);
      panel.replaceChildren(header(entries), body(entries));
      rendered = true;
      // Entrance plays once per newly added card.
      requestAnimationFrame(() => panel.querySelectorAll(".card.enter").forEach((t) => t.classList.remove("enter")));
    }

    render();
    return { host, state };
  };
})(DAF);

// The in-page fill panel. Rendered in a shadow root so the site's CSS and ours never mix.
var DAF = globalThis.DAF || (globalThis.DAF = {});

(function (DAF) {
  "use strict";

  const SECTION_LABEL = { main: "Main", extra: "Extra", side: "Side" };
  const COLLAPSE_KEY = "daf:panelCollapsed";

  const h = DAF.h;

  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  const sectionSummary = (c) => `Main ${c.main} · Extra ${c.extra} · Side ${c.side}`;

  DAF.mountPanel = function mountPanel(editor) {
    const state = {
      view: "idle", // idle | loading | filling | done | error
      deckText: "",
      parsed: null,
      parseError: null,
      info: null,
      progress: null,
      result: null,
      errorMessage: "",
      collapsed: false,
      controller: null,
      clearFirst: true, // when the list already has cards, replace them by default
      confirmingClear: false, // the Clear deck button is asking for confirmation
      cleared: null, // { removed, error } after Clear deck
    };

    const { host, shadow } = DAF.makeHost("decklist-auto-filler", ["content/panel.css"]);
    if (editor.panelGap) host.style.setProperty("--daf-gap", editor.panelGap);
    const panel = h("section", { class: "panel", "aria-labelledby": "daf-title" });
    shadow.append(panel);

    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.confirmingClear) cancelClear();
    });

    const { parent, before } = editor.mountPoint();
    parent.insertBefore(host, before);

    // Keep the "already has cards" notice current as the list changes, and lock the
    // Fill button while the visual list is clearing.
    editor.observe(() => {
      if (state.view === "idle") render();
    });
    DAF.page.onBusyChange(() => {
      if (state.view === "idle") render();
    });

    // ---- data -------------------------------------------------------------

    DAF.data
      .getInfo()
      .then((info) => {
        state.info = info;
        render();
      })
      .catch(() => {
        /* links and set name are optional; the fill still works */
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

    // ---- actions ----------------------------------------------------------

    // fileName is set when the text came from a chosen or dropped .ydk file.
    function setDeckText(text, fileName = null) {
      state.deckText = text;
      state.fileName = fileName;
      if (!text.trim()) {
        state.parsed = null;
        state.parseError = null;
        return;
      }
      try {
        state.parsed = DAF.parseDeck(text);
        state.parseError = null;
      } catch (e) {
        state.parsed = null;
        state.parseError = e instanceof DAF.DeckError ? e.message : "Couldn’t read that deck.";
      }
    }

    async function readFile(file) {
      if (!file) return;
      const text = await file.text();
      setDeckText(text, file.name);
      render();
      panel.querySelector("[data-choose]")?.focus();
    }

    function removeFile() {
      setDeckText("");
      render();
      panel.querySelector("[data-choose]")?.focus();
    }

    async function startFill() {
      if (DAF.page.busy) return;
      state.confirmingClear = false;
      state.cleared = null;
      setDeckText(state.deckText, state.fileName);
      if (!state.parsed) {
        if (!state.parseError) state.parseError = "Paste a deck first.";
        render();
        focusDeckInput();
        return;
      }

      state.view = "loading";
      render();
      let catalog;
      try {
        catalog = await DAF.data.getCatalog(editor.data);
      } catch (e) {
        state.view = "error";
        state.errorMessage = "Couldn’t load the card database. Check your connection, then try again.";
        render();
        return;
      }

      const plan = DAF.buildPlan(state.parsed, catalog);
      // The visual list shows the artwork from the player's own deck file.
      for (const row of plan.rows) DAF.preferredArt.set(DAF.match.norm(row.name), String(row.passcode));

      const c = editor.counts();
      const replacing = state.clearFirst && c.main + c.extra + c.side > 0;

      state.controller = new AbortController();
      const signal = state.controller.signal;
      state.view = "filling";
      state.progress = replacing
        ? { phase: "clear", left: c.main + c.extra + c.side, total: c.main + c.extra + c.side }
        : { phase: "add", index: 0, total: plan.rows.length, row: plan.rows[0], added: 0 };
      render();
      DAF.page.setBusy("filling");

      try {
        let clearError = null;
        if (replacing) {
          try {
            await editor.clearAll({
              signal,
              onProgress: (p) => {
                state.progress = { phase: "clear", ...p };
                updateProgress();
              },
            });
          } catch (e) {
            clearError = e;
          }
        }
        if (clearError || signal.aborted) {
          // Don't add on top of a half-cleared list.
          const cleared = !clearError;
          state.result = {
            added: 0, failed: [], stopped: cleared, clearFailed: !cleared,
            delta: { main: 0, extra: 0, side: 0 }, expected: plan.expected, missing: [],
          };
        } else {
          state.result = await DAF.runFill(plan, {
            catalog,
            signal,
            onProgress: (p) => {
              state.progress = { phase: "add", ...p };
              updateProgress();
            },
          });
        }
      } finally {
        DAF.page.setBusy(null);
      }
      state.view = "done";
      render();
      panel.querySelector(".outcome")?.focus();
    }

    // ---- Clear deck ---------------------------------------------------------

    function askToClear() {
      state.confirmingClear = true;
      state.cleared = null;
      render();
      panel.querySelector("[data-cancel-clear]")?.focus();
    }

    function cancelClear() {
      state.confirmingClear = false;
      render();
      panel.querySelector("[data-clear]")?.focus();
    }

    async function clearDeck() {
      if (DAF.page.busy) return;
      const startTotal = existingTotal();
      state.confirmingClear = false;
      state.controller = new AbortController();
      state.view = "filling";
      state.progress = { phase: "clear", left: startTotal, total: startTotal };
      render();
      DAF.page.setBusy("clearing");
      let error = null;
      try {
        await editor.clearAll({
          signal: state.controller.signal,
          onProgress: (p) => {
            state.progress = { phase: "clear", ...p };
            updateProgress();
          },
        });
      } catch (e) {
        error = e instanceof DAF.FillStepError ? e.message : "Something went wrong while clearing the list.";
      } finally {
        DAF.page.setBusy(null);
      }
      state.cleared = { removed: startTotal - existingTotal(), error };
      state.view = "idle";
      render();
      panel.querySelector("[data-cleared]")?.focus();
    }

    function stopFill() {
      if (state.controller) state.controller.abort();
      const stop = panel.querySelector("[data-stop]");
      if (stop) {
        stop.disabled = true;
        stop.textContent = "Stopping after this card…";
      }
    }

    function reset() {
      state.view = "idle";
      state.cleared = null;
      state.confirmingClear = false;
      state.result = null;
      render();
      focusDeckInput();
    }

    function toggleCollapsed() {
      state.collapsed = !state.collapsed;
      chrome.storage.local.set({ [COLLAPSE_KEY]: state.collapsed }).catch(() => {});
      render();
    }

    function focusDeckInput() {
      panel.querySelector("#daf-deck")?.focus();
    }

    // ---- views ------------------------------------------------------------

    function header() {
      const busy = state.view === "filling" || state.view === "loading";
      return h(
        "header",
        { class: "head" },
        h("img", { class: "mark", src: chrome.runtime.getURL("icons/icon32.png"), alt: "", width: 20, height: 20 }),
        h("h3", { id: "daf-title" }, "Decklist Auto-Filler"),
        h("span", { class: "tag" }, "Browser extension"),
        h(
          "div",
          { class: "head-links" },
          h(
            "button",
            {
              type: "button",
              class: "collapse",
              "aria-expanded": String(!state.collapsed),
              "aria-controls": "daf-body",
              disabled: busy && !state.collapsed ? true : null,
              onclick: toggleCollapsed,
            },
            state.collapsed ? "Show" : "Hide"
          )
        )
      );
    }

    const existingTotal = () => {
      const c = editor.counts();
      return c.main + c.extra + c.side;
    };

    function existingNotice() {
      const c = editor.counts();
      const total = existingTotal();
      if (!total) return null;
      return h(
        "div",
        { class: "notice warn" },
        h("p", null, h("b", null, `This list already has ${plural(total, "card")}`), ` (${sectionSummary(c)}).`),
        h(
          "label",
          { class: "check" },
          h("input", {
            type: "checkbox",
            checked: state.clearFirst ? true : null,
            onchange: (e) => {
              state.clearFirst = e.target.checked;
              render();
            },
          }),
          " Remove them before filling, so the list matches your deck exactly"
        ),
        state.clearFirst ? null : h("p", null, "Unchecked: your deck’s cards are added on top of the ones already there.")
      );
    }

    // Clear deck: a button while the list has cards, then an inline confirmation.
    function clearControl() {
      const total = existingTotal();
      if (state.confirmingClear && total) {
        return h(
          "span",
          { class: "confirm", role: "group", "aria-label": "Confirm clearing the deck" },
          h("span", { class: "confirm-q" }, `Remove all ${plural(total, "card")} from this list?`),
          h("button", { type: "button", class: "btn btn-sm danger", onclick: clearDeck }, "Remove all"),
          h("button", { type: "button", class: "btn btn-sm", "data-cancel-clear": "", onclick: cancelClear }, "Cancel")
        );
      }
      if (!total) return null;
      return h(
        "button",
        { type: "button", class: "btn danger-quiet", "data-clear": "", onclick: askToClear, disabled: DAF.page.busy ? true : null },
        "Clear deck"
      );
    }

    function clearedNotice() {
      const c = state.cleared;
      if (!c) return null;
      if (c.error) {
        return h("div", { class: "notice danger", role: "alert", tabindex: "-1", "data-cleared": "" }, h("p", null, c.error));
      }
      return h(
        "p",
        { class: "deck-status is-ok", role: "status", tabindex: "-1", "data-cleared": "" },
        `Removed ${plural(c.removed, "card")}.`,
        editor.needsSave ? h("span", { class: "cleared-next" }, " Press ", h("b", null, "Save"), " to keep the change.") : null
      );
    }

    function idleView() {
      const fileInput = h("input", {
        type: "file",
        accept: ".ydk,.txt",
        class: "visually-hidden",
        id: "daf-file",
        tabindex: "-1",
        onchange: (e) => readFile(e.target.files[0]),
      });

      const fromFile = !!state.fileName;

      const input = h("input", {
        type: "text",
        id: "daf-deck",
        class: "deck-input",
        spellcheck: "false",
        autocomplete: "off",
        placeholder: "ydke://…",
        "aria-describedby": "daf-deck-status",
        "aria-invalid": state.parseError && !fromFile ? "true" : null,
        oninput: (e) => {
          // Typing a link replaces a chosen file.
          const hadFile = !!state.fileName;
          setDeckText(e.target.value);
          if (hadFile) render();
          else renderDeckStatus();
        },
        onkeydown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            startFill();
          }
        },
      });
      input.value = fromFile ? "" : state.deckText;

      const setName = state.info && state.info.latest_set;

      // A .ydk file can be dropped anywhere on the inputs.
      const dropZone = h(
        "div",
        {
          class: "sources",
          ondragover: (e) => {
            if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
              e.preventDefault();
              e.currentTarget.classList.add("dragging");
            }
          },
          ondragleave: (e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove("dragging");
          },
          ondrop: (e) => {
            e.currentTarget.classList.remove("dragging");
            const file = e.dataTransfer && e.dataTransfer.files[0];
            if (file) {
              e.preventDefault();
              readFile(file);
            }
          },
        },
        h("label", { for: "daf-deck", class: "label" }, "Paste YDKE:"),
        input,
        h("p", { class: "or", "aria-hidden": "true" }, "or"),
        h("p", { class: "label", id: "daf-file-label" }, "Choose .ydk file:"),
        h(
          "div",
          { class: "file-row" },
          h(
            "button",
            {
              type: "button",
              class: "btn",
              "data-choose": "",
              "aria-labelledby": "daf-file-label",
              "aria-describedby": "daf-file-name",
              onclick: () => fileInput.click(),
            },
            fromFile ? "Choose another…" : "Choose file…"
          ),
          fileInput,
          fromFile
            ? h(
                "p",
                { class: "file-name", id: "daf-file-name" },
                h("span", { class: "file-name-text", title: state.fileName }, state.fileName),
                h("button", { type: "button", class: "text-button", onclick: removeFile }, "Remove")
              )
            : h("p", { class: "file-name is-empty", id: "daf-file-name" }, "No file chosen. You can also drop one here.")
        )
      );

      return [
        dropZone,
        h("p", { id: "daf-deck-status", class: "deck-status", "aria-live": "polite" }),
        clearedNotice(),
        existingNotice(),
        h(
          "div",
          { class: "actions" },
          h(
            "button",
            { type: "button", class: "btn primary", onclick: startFill, disabled: DAF.page.busy ? true : null },
            state.clearFirst && existingTotal() ? "Replace list with this deck" : "Fill deck list"
          ),
          clearControl(),
          setName &&
            h(
              "p",
              { class: "fineprint" },
              "Latest set: ",
              h("b", null, setName.trim().split(/\s+/)[0]),
              " ",
              setName.trim().split(/\s+/).slice(1).join(" ")
            )
        ),
      ];
    }

    function renderDeckStatus() {
      const status = panel.querySelector("#daf-deck-status");
      const input = panel.querySelector("#daf-deck");
      if (!status) return;
      status.className = "deck-status";
      input && input.removeAttribute("aria-invalid");
      if (state.parseError) {
        status.classList.add("is-error");
        status.textContent = state.fileName ? `${state.fileName}: ${state.parseError}` : state.parseError;
        if (input && !state.fileName) input.setAttribute("aria-invalid", "true");
      } else if (state.parsed) {
        const p = state.parsed;
        status.classList.add("is-ok");
        status.textContent = `Main: ${p.main.length} • Side: ${p.side.length} • Extra: ${p.extra.length}`;
      } else {
        status.textContent = "";
      }
      status.hidden = !status.textContent;
    }

    function loadingView() {
      return h("p", { class: "status-line", role: "status" }, "Loading the card database…");
    }

    function fillingView() {
      return [
        h(
          "div",
          { class: "progress-head" },
          h("p", { class: "progress-title", "data-title": "" }, "Adding cards"),
          h("p", { class: "progress-count", role: "status", "data-count": "" })
        ),
        h(
          "div",
          { class: "bar", role: "progressbar", "aria-label": "Cards added", "aria-valuemin": "0" },
          h("span", { class: "bar-fill" })
        ),
        h("p", { class: "current", "data-current": "" }),
        h("p", { class: "fineprint" }, "Keep this tab open and leave the deck list alone until it finishes."),
        h("div", { class: "actions" }, h("button", { type: "button", class: "btn", "data-stop": "", onclick: stopFill }, "Stop")),
      ];
    }

    function updateProgress() {
      const p = state.progress;
      if (!p || state.view !== "filling") return;
      const count = panel.querySelector("[data-count]");
      const bar = panel.querySelector(".bar");
      const fill = panel.querySelector(".bar-fill");
      const current = panel.querySelector("[data-current]");
      const title = panel.querySelector("[data-title]");

      if (p.phase === "clear") {
        const done = p.total - p.left;
        if (title) title.textContent = "Removing the cards already on the list";
        if (count) count.textContent = `${p.left} left`;
        if (bar) {
          bar.setAttribute("aria-label", "Cards removed");
          bar.setAttribute("aria-valuemax", String(p.total));
          bar.setAttribute("aria-valuenow", String(done));
        }
        if (fill) fill.style.width = (p.total ? Math.round((done / p.total) * 100) : 0) + "%";
        if (current) current.replaceChildren(p.entry ? h("span", { class: "card-meta" }, p.entry.name) : "");
        return;
      }

      if (title) title.textContent = "Adding cards";
      if (bar) bar.setAttribute("aria-label", "Cards added");
      const pct = p.total ? Math.round((p.index / p.total) * 100) : 0;
      if (count) count.textContent = `${p.index + 1} of ${p.total}`;
      if (bar) {
        bar.setAttribute("aria-valuemax", String(p.total));
        bar.setAttribute("aria-valuenow", String(p.index));
      }
      if (fill) fill.style.width = pct + "%";
      if (current && p.row) {
        current.replaceChildren(
          h("span", { class: "card-name" }, p.row.name),
          h("span", { class: "card-meta" }, ` ×${p.row.qty} · ${SECTION_LABEL[p.row.section]}`)
        );
      }
    }

    // ---- report on GitHub ---------------------------------------------------

    const ISSUES_URL = "https://github.com/ObjectOrientedCodeTalker/decklistautofiller_api/issues/new";

    // A link to a pre-filled GitHub issue. Nothing is sent until the player submits it.
    function reportLink(title, facts, label) {
      const info = state.info || {};
      const lines = [
        ...facts.filter(Boolean),
        `**Site:** ${location.hostname}`,
        info.latest_set ? `**Card data:** ${info.latest_set}` : null,
        `**Extension version:** ${chrome.runtime.getManifest().version}`,
        "",
        "<!-- Anything else that would help? Add it below. -->",
        "",
      ].filter((l) => l !== null);
      const url = `${ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(lines.join("\n"))}`;
      return h(
        "a",
        {
          class: "report",
          href: url,
          target: "_blank",
          rel: "noopener",
          title: "Opens a pre-filled issue on GitHub (needs a GitHub account)",
        },
        label
      );
    }

    function reportFailed(f) {
      const facts = [
        `**Card:** ${f.row.name}`,
        `**Passcode:** ${f.row.passcode}`,
        `**Deck section:** ${SECTION_LABEL[f.row.section]}`,
        `**Searched for:** ${f.row.terms.map((t) => `"${t}"`).join(", ") || "(nothing)"}`,
      ];
      const title = f.reason === "ambiguous" ? `Card matches more than one site name: ${f.row.name}` : `Card not found on the site: ${f.row.name}`;
      return reportLink(title, [...facts, `**Problem:** ${f.message}`], "Report this card as missing");
    }

    function reportMissing(m) {
      return reportLink(
        `Card missing from the card data: passcode ${m.passcode}`,
        [`**Passcode:** ${m.passcode}`, `**Deck section:** ${SECTION_LABEL[m.section]}`, "**Problem:** This passcode isn’t in manifest.json."],
        "Report this card as missing"
      );
    }

    function doneView() {
      const r = state.result;
      const wanted = r.expected.main + r.expected.extra + r.expected.side;
      const problems = r.failed.length + r.missing.length;
      let tone = "ok";
      let headline;
      if (r.clearFailed) {
        tone = "warn";
        headline = "Couldn’t remove the cards already on the list, so nothing was added.";
      } else if (r.stopped && r.added === 0) {
        tone = "warn";
        headline = "Stopped before any cards were added.";
      } else if (r.stopped) {
        tone = "warn";
        headline = `Stopped after ${plural(r.added, "card")}. The rest weren’t added.`;
      } else if (!problems && r.added === wanted) {
        headline = `All ${plural(wanted, "card")} added.`;
      } else {
        tone = "warn";
        headline = `${r.added} of ${plural(wanted, "card")} added. ${problems === 1 ? "1 card needs" : problems + " cards need"} adding by hand.`;
      }

      const rows = ["main", "extra", "side"].map((key) => {
        const want = r.expected[key];
        const got = r.delta[key];
        const diff = got - want;
        const note = diff === 0 ? "Matches" : diff < 0 ? `${-diff} short` : `${diff} extra`;
        return h(
          "tr",
          { class: diff === 0 ? "" : "off" },
          h("th", { scope: "row" }, SECTION_LABEL[key]),
          h("td", null, want),
          h("td", null, got),
          h("td", { class: "note" }, note)
        );
      });

      const issues = [
        ...r.failed.map((f) =>
          h(
            "li",
            null,
            h("span", { class: "card-name" }, f.row.name),
            h("span", { class: "card-meta" }, ` ×${f.row.qty} · ${SECTION_LABEL[f.row.section]}`),
            h("span", { class: "why" }, f.message),
            h("div", { class: "item-actions" }, reportFailed(f))
          )
        ),
        ...r.missing.map((m) =>
          h(
            "li",
            null,
            h("span", { class: "card-name" }, `Passcode ${m.passcode}`),
            h("span", { class: "card-meta" }, ` ×${m.copies} · ${SECTION_LABEL[m.section]}`),
            h(
              "span",
              { class: "why" },
              "Not in the card database yet",
              state.info && state.info.latest_set ? `; it may be newer than ${state.info.latest_set}.` : "."
            ),
            h("div", { class: "item-actions" }, reportMissing(m))
          )
        ),
      ];

      return [
        h("p", { class: "outcome " + tone, tabindex: "-1" }, headline),
        h(
          "table",
          { class: "tally" },
          h("thead", null, h("tr", null, h("th", { scope: "col" }, "Section"), h("th", { scope: "col" }, "In your deck"),
            h("th", { scope: "col" }, "Added"), h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, "Result")))),
          h("tbody", null, rows)
        ),
        issues.length
          ? h("div", { class: "issues" }, h("h4", null, "Add these by hand"), h("ul", null, issues))
          : null,
        h(
          "p",
          { class: "next" },
          "Next, check the list and press ",
          h("b", null, editor.nextStep),
          "."
        ),
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", class: "btn", onclick: reset }, "Fill another deck"),
          clearControl()
        ),
      ];
    }

    function errorView() {
      return [
        h("div", { class: "notice danger", role: "alert" }, h("p", null, state.errorMessage)),
        h(
          "div",
          { class: "actions" },
          h("button", { type: "button", class: "btn primary", onclick: startFill }, "Try again"),
          h("button", { type: "button", class: "btn", onclick: reset }, "Back")
        ),
      ];
    }

    function render() {
      const views = { idle: idleView, loading: loadingView, filling: fillingView, done: doneView, error: errorView };
      // Keep the caret where it was if the player is typing when hosted info arrives.
      const active = shadow.activeElement;
      const focusId = active && active.id;
      const selection = active && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;

      const body = h("div", { class: "body", id: "daf-body", hidden: state.collapsed ? true : null }, views[state.view]());
      panel.classList.toggle("is-collapsed", state.collapsed);
      panel.replaceChildren(header(), body);
      if (state.view === "idle") renderDeckStatus();

      if (focusId) {
        const again = shadow.getElementById(focusId);
        if (again) {
          again.focus();
          if (selection && again.setSelectionRange) again.setSelectionRange(selection[0], selection[1]);
        }
      }
      if (state.view === "filling") updateProgress();
    }

    render();
    return { host, state };
  };
})(DAF);

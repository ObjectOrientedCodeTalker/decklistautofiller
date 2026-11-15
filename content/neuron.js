// Adapter for Konami's Neuron deck builder (db.yugioh-card.com, member_deck.action, editing
// a deck). Everything that depends on Neuron's markup lives here.
//
// The deck is five tables of rows. Each row has a card name box, a quantity box and hidden
// inputs holding the card's Konami ID and artwork choice:
//   <table id="monster_list">… <tr class="row"> …
//     <input name="monm" class="keyword" alt="MONSTER">       card name
//     <input name="monum" class="cnum" value="0">               quantity
//     <input type="hidden" name="monsterCardId">                Konami ID (what Save reads)
//     <input type="hidden" class="imgs">                        artwork, "<kid>_1_1_1"
// Monster, Spell and Trap tables have 65 rows but show about 20 until the table's open arrow
// (img.list_open) is clicked; Extra and Side have 20 rows.
//
// Picking a card from Neuron's name suggestions fills the Konami ID. Like Cost Down, the
// extension writes the rows directly instead: name, quantity, Konami ID (from the card
// data) and artwork. Nothing is sent to Konami until the player presses Save.
var DAF = globalThis.DAF || (globalThis.DAF = {});

(function (DAF) {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const TABLES = {
    monster: { sel: "#monster_list", name: "monm", num: "monum", id: "monsterCardId", section: "main", label: "Monster" },
    spell: { sel: "#spell_list", name: "spnm", num: "spnum", id: "spellCardId", section: "main", label: "Spell" },
    trap: { sel: "#trap_list", name: "trnm", num: "trnum", id: "trapCardId", section: "main", label: "Trap" },
    extra: { sel: "#extra_list", name: "exnm", num: "exnum", id: "extraCardId", section: "extra", label: "Extra Deck" },
    side: { sel: "#side_list", name: "sinm", num: "sinum", id: "sideCardId", section: "side", label: "Side Deck" },
  };
  const NO_ART = "null_null_null_null";

  const fail = (reason, message) => new DAF.FillStepError(reason, message);
  const table = (key) => $(TABLES[key].sel);

  // Every row of a table, as { tr, name, num, id, imgs }.
  function rowsOf(key) {
    const t = table(key);
    if (!t) return [];
    const c = TABLES[key];
    return Array.from(t.querySelectorAll(`input[name="${c.name}"]`)).map((name) => {
      const tr = name.closest("tr");
      return {
        tr,
        name,
        num: tr.querySelector(`input[name="${c.num}"]`),
        id: tr.querySelector(`input[name="${c.id}"]`),
        imgs: tr.querySelector("input.imgs"),
      };
    });
  }

  const qtyOf = (row) => {
    const n = parseInt(row.num && row.num.value, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const hasCard = (row) => !!(row.id && /^\d+$/.test(row.id.value.trim()) && Number(row.id.value) > 0);
  const isUsed = (row) => hasCard(row) || !!row.name.value.trim() || qtyOf(row) > 0;

  // Copies in a table, counted from the rows themselves (what Save sends).
  const tableCount = (key) => rowsOf(key).reduce((n, row) => n + (hasCard(row) ? qtyOf(row) : 0), 0);

  function writeRow(row, { name, qty, kid }) {
    row.name.value = name;
    if (row.num) row.num.value = String(qty);
    if (row.id) row.id.value = kid ? String(kid) : "";
    if (row.imgs) row.imgs.value = kid ? `${kid}_1_1_1` : NO_ART;
    // Neuron's own markers for a mistyped name and for Forbidden/Limited status belong to
    // whatever was in the row before; Neuron sets them again when it checks the deck.
    row.tr.classList.remove("forbidden", "limited", "semi_limited");
    row.tr.querySelectorAll(".inpError").forEach((n) => n.classList.remove("inpError"));
  }

  const emptyRow = (row) => writeRow(row, { name: "", qty: 0, kid: null });

  // Lets Neuron update its counters after rows were written directly.
  function recount(row) {
    if (row && row.num) row.num.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Opens the rest of a table (rows past ~20) so the player can see every card, using the
  // table's own arrow. Rows are written whether or not they're shown.
  function reveal(key, row) {
    if (row.tr.getClientRects().length) return;
    const open = table(key) && table(key).querySelector("img.list_open");
    if (open && open.getClientRects().length) open.click();
  }

  DAF.editors = DAF.editors || {};
  DAF.editors.neuron = {
    data: { overrides: null }, // cards are placed by Konami ID; names aren't searched
    nextStep: "Save",
    needsSave: true, // changes stay on the page until the player presses Save
    // Neuron's tables show names only, so the extension adds the same visual deck list as
    // on The Side Deck, right above them.
    hasVisualList: true,
    // Neuron's page leaves ~15px above the panel and its deck box adds ~5px below, so a
    // 10px gap makes the space above and below the panel match.
    panelGap: "10px",
    // The visual deck list sits between the Save box and the deck totals. Above it, the same
    // 10px gap as between the fill panel and the deck header. Below it, nothing: the totals
    // keep their own spacing, exactly as Neuron lays them out.
    visualGaps: { above: "10px", below: "0" },
    // With the visual deck list above them, Neuron's 50px under the deck totals looks
    // lopsided, so it matches the 20px above them while the extension is on (25px between
    // boxes, with each total's own 5px). The rows of deck tables (Monster/Spell/Trap, then
    // Extra/Side) get the same 25px between them: each table keeps its 10px, plus 15px.
    // The empty spacer after the Trap table (div.nodeck) wraps onto its own line and would
    // add another 10px, so it loses its margin while empty.
    pageStyle:
      "html:not(.daf-off) #num_total { margin-bottom: 20px; }" +
      "html:not(.daf-off) #deck_text .deck_set { margin-bottom: 15px; }" +
      "html:not(.daf-off) #deck_text .deck_set > .nodeck:empty { margin: 0; }",

    detect() {
      return !!($("#deck_text") && $('#monster_list input[name="monm"]') && $('#side_list input[name="sinm"]'));
    },

    variant() {
      return "neuron";
    },

    // At the top of the editor, above the deck name and Save button, so it's the first
    // thing the player sees.
    mountPoint() {
      const anchor = $("#deck_header") || $("#num_total") || $("#deck_text");
      return { parent: anchor.parentElement, before: anchor };
    },

    // Above the Main/Extra/Side Deck totals, below the deck name and Save button.
    deckListMountPoint() {
      const anchor = $("#num_total") || $("#deck_text");
      return anchor ? { parent: anchor.parentElement, before: anchor } : null;
    },

    // Every card in the tables, in page order. Neuron's names are the official English
    // names, which is what the visual deck list looks images up by.
    entries() {
      const out = [];
      for (const key of Object.keys(TABLES)) {
        for (const row of rowsOf(key)) {
          if (!hasCard(row) || !qtyOf(row) || !row.name.value.trim()) continue;
          out.push({ name: row.name.value.trim(), qty: qtyOf(row), section: TABLES[key].section, group: TABLES[key].label });
        }
      }
      return out;
    },

    counts() {
      return {
        main: tableCount("monster") + tableCount("spell") + tableCount("trap"),
        extra: tableCount("extra"),
        side: tableCount("side"),
      };
    },

    observe(callback) {
      let timer = null;
      const fire = () => {
        clearTimeout(timer);
        timer = setTimeout(callback, 60);
      };
      const observer = new MutationObserver(fire);
      const root = $("#deck_text");
      observer.observe($("#num_total") || root, { childList: true, subtree: true, characterData: true });
      // Typing in the deck doesn't change the DOM, so also listen for edits.
      root.addEventListener("change", fire);
      return () => {
        observer.disconnect();
        root.removeEventListener("change", fire);
      };
    },

    // card: { name, konamiId, qty, section, type }.
    async addCard(card) {
      // Main Deck cards go in the table for their type from the card data; nothing is
      // guessed. Extra and Side Deck cards of every type share one table.
      let key = card.section;
      if (card.section === "main") {
        if (!TABLES[card.type] || TABLES[card.type].section !== "main") {
          throw fail("no-type", "The card data doesn’t say whether this is a Monster, Spell or Trap, so it wasn’t placed.");
        }
        key = card.type;
      }
      if (!card.konamiId) {
        throw fail("no-konami-id", "The card data doesn’t have this card’s Konami ID yet, so it wasn’t placed.");
      }

      const row = rowsOf(key).find((r) => !isUsed(r));
      if (!row) throw fail("full", `The ${TABLES[key].label} table has no empty rows left.`);
      if (!row.id) throw fail("unconfirmed", "Couldn’t find where Neuron keeps the card ID on this page.");

      const before = tableCount(key);
      writeRow(row, { name: card.name, qty: card.qty, kid: card.konamiId });
      reveal(key, row);
      recount(row);
      if (tableCount(key) !== before + card.qty) {
        emptyRow(row);
        recount(row);
        throw fail("unconfirmed", "Wrote the card into the deck, but the row didn’t keep it.");
      }
    },

    // Empties every row, as Cost Down does. Instant: nothing is sent to Konami until Save.
    async clearAll({ signal, onProgress } = {}) {
      const c = this.counts();
      const startTotal = c.main + c.extra + c.side;
      for (const key of Object.keys(TABLES)) {
        if (signal && signal.aborted) break;
        const used = rowsOf(key).filter(isUsed);
        used.forEach(emptyRow);
        recount(used[0]);
        const now = this.counts();
        onProgress && onProgress({ left: now.main + now.extra + now.side, total: startTotal });
      }
      const now = this.counts();
      return startTotal - (now.main + now.extra + now.side);
    },
  };
})(DAF);

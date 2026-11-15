// Entry point: mount the fill panel and visual deck list on deck-list editor pages,
// following the on/off switch in the toolbar popup.
var DAF = globalThis.DAF || (globalThis.DAF = {});

(function (DAF) {
  "use strict";
  if (document.getElementById("decklist-auto-filler")) return;
  // The first site adapter that recognizes this page drives it.
  DAF.editor = Object.values(DAF.editors || {}).find((editor) => editor.detect());
  if (!DAF.editor) return;

  const ENABLED_KEY = "daf:enabled";
  let mounted = false;
  let wanted = true;

  function apply(enabled) {
    wanted = enabled;
    // A fill or clear in progress finishes first; switching off mid-run would hide its progress.
    if (!enabled && DAF.page.busy) return;
    document.documentElement.classList.toggle("daf-off", !enabled);
    if (enabled && !mounted) {
      mounted = true;
      DAF.mountPanel(DAF.editor);
      if (DAF.editor.hasVisualList) DAF.mountVisualDeck(DAF.editor);
      // Small layout fixes to the site's own page; they lift when the extension is off.
      if (DAF.editor.pageStyle) document.head.append(DAF.h("style", null, DAF.editor.pageStyle));
    }
  }

  DAF.page.onBusyChange((busy) => {
    if (!busy && !wanted) apply(false);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && ENABLED_KEY in changes) apply(changes[ENABLED_KEY].newValue !== false);
  });

  chrome.storage.local
    .get(ENABLED_KEY)
    .then((s) => apply(s[ENABLED_KEY] !== false))
    .catch(() => apply(true));
})(DAF);

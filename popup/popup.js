// Toolbar popup: the on/off switch and the latest set the card data covers.
(function () {
  "use strict";

  const ENABLED_KEY = "daf:enabled";
  const toggle = document.getElementById("toggle");
  const stateText = document.getElementById("state");

  function show(enabled) {
    toggle.setAttribute("aria-checked", String(enabled));
    stateText.textContent = enabled ? "Enabled" : "Disabled";
  }

  chrome.storage.local
    .get(ENABLED_KEY)
    .then((s) => show(s[ENABLED_KEY] !== false))
    .catch(() => show(true));

  toggle.addEventListener("click", () => {
    const enabled = toggle.getAttribute("aria-checked") !== "true";
    show(enabled);
    chrome.storage.local.set({ [ENABLED_KEY]: enabled }).catch(() => {});
  });

  // latest_set looks like "CORI (Updated 07/10/26)": bold the set code, keep the note plain.
  DAF.data
    .getInfo()
    .then((info) => {
      const match = String(info.latest_set || "").match(/^\s*(\S+)\s*(.*)$/);
      document.getElementById("set-code").textContent = match ? match[1] : "Unknown";
      document.getElementById("set-note").textContent = match ? match[2] : "";
    })
    .catch(() => {
      document.getElementById("set-code").textContent = "Couldn’t check";
    });
})();

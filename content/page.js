// Page-level coordination shared by the fill panel and the visual deck list:
// one "busy" state (filling or clearing) that both components respect.
var DAF = globalThis.DAF || (globalThis.DAF = {});

(function (DAF) {
  "use strict";

  const listeners = new Set();

  function warnBeforeLeaving(event) {
    event.preventDefault();
    event.returnValue = "";
  }

  // The site flashes a full-page white loading overlay on every request. While we work
  // through a list that would strobe once per card, so swap it for one steady dim and
  // lift our components above it. The steady layer also keeps clicks off the form.
  const style = document.createElement("style");
  style.textContent = `
    html.daf-busy .overlay { display: none !important; }
    html.daf-busy body > .overlay { display: block !important; background: rgba(255, 255, 255, 0.6) !important; }
    html.daf-busy .daf-host { position: relative; z-index: 1000; }
    html.daf-off .daf-host { display: none !important; }
  `;
  document.head.append(style);

  DAF.page = {
    busy: null, // null | "filling" | "clearing"

    setBusy(reason) {
      this.busy = reason || null;
      document.documentElement.classList.toggle("daf-busy", !!this.busy);
      if (this.busy) window.addEventListener("beforeunload", warnBeforeLeaving);
      else window.removeEventListener("beforeunload", warnBeforeLeaving);
      listeners.forEach((fn) => fn(this.busy));
    },

    onBusyChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  // Shared tiny element builder: h("p", { class: "x" }, "text", child)
  DAF.h = function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "class") node.className = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : String(child));
    }
    return node;
  };

  // A shadow-rooted host whose stylesheets load before it shows, so it never flashes unstyled.
  DAF.makeHost = function makeHost(id, stylesheets) {
    const host = DAF.h("div", { id, class: "daf-host", style: "visibility:hidden" });
    const shadow = host.attachShadow({ mode: "open" });
    let pending = stylesheets.length;
    const done = () => {
      if (--pending <= 0) host.style.removeProperty("visibility");
    };
    for (const href of stylesheets) {
      const link = DAF.h("link", { rel: "stylesheet", href: chrome.runtime.getURL(href) });
      link.addEventListener("load", done);
      link.addEventListener("error", done);
      shadow.append(link);
    }
    return { host, shadow };
  };
})(DAF);

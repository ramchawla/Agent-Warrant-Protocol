// Shared browser code for the three pages. Owner: Jackson.
// /vendor/index.umd.min.js defines SimpleWebAuthnBrowser. No framework, no bundler (PRD 8.2).
"use strict";

window.AWP = (() => {
  /** fetch JSON; throws Error(message) with .status on a non-2xx answer. */
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
    if (!res.ok) {
      const err = new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** The demo user ID for this browser: usr_ + 24 hex, kept in localStorage. */
  function userId() {
    let id = null;
    try { id = localStorage.getItem("awp.userId"); } catch {}
    if (!id || !/^usr_[A-Za-z0-9_-]{1,64}$/.test(id)) {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      id = "usr_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      try { localStorage.setItem("awp.userId", id); } catch {}
    }
    return id;
  }

  /** "12.50" -> 1250. Returns null unless it is a plain amount with at most two decimals. */
  function toCents(text) {
    const m = /^\s*\$?\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(String(text));
    if (!m) return null;
    return Number(m[1]) * 100 + Number((m[2] || "0").padEnd(2, "0"));
  }

  /** Splits "A1, A2 A3" into ["A1","A2","A3"]. */
  function list(text) {
    return String(text).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  }

  /** Shows a message in an element: kind is "ok", "error" or "info". */
  function say(el, kind, text) {
    el.className = `msg ${kind}`;
    el.textContent = text;
    el.hidden = !text;
  }

  /** A friendlier line for the errors a passkey prompt throws. */
  function passkeyError(err) {
    if (err && err.name === "NotAllowedError") return "The passkey prompt was cancelled or timed out. Try again, and choose Windows Hello or Touch ID on this device.";
    if (err && err.name === "InvalidStateError") return "This passkey is already registered here.";
    return (err && err.message) || String(err);
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) node.append(c);
    return node;
  }

  return { api, userId, toCents, list, say, passkeyError, el };
})();

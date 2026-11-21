// On a YouTube channel page, show a "Lưu kênh" button that saves the channel to Bookmark Key
// through the Social Manager web app (via the per-user API key set in the popup). Self-contained:
// no shared engine, runs only on youtube.com, never on the TikTok side.
(() => {
  "use strict";
  if (window.top !== window) return;

  const BTN_ID = "sm-save-channel";

  /** The channel URL for the current page, or null when this is not a channel page. */
  function channelUrl() {
    const p = location.pathname;
    const handle = p.match(/^\/(@[\w.\-]+)(?:\/|$)/);
    if (handle) return "https://www.youtube.com/" + handle[1];
    const named = p.match(/^\/((?:channel|c|user)\/[\w.\-]+)(?:\/|$)/);
    if (named) return "https://www.youtube.com/" + named[1];
    // Fall back to the page's own canonical/og URL when it points at a channel.
    for (const sel of ['meta[property="og:url"]', 'link[rel="canonical"]']) {
      const v = document.querySelector(sel)?.getAttribute(sel.startsWith("meta") ? "content" : "href") || "";
      const m = v.match(/https:\/\/www\.youtube\.com\/(?:channel\/UC[\w-]{22}|@[\w.\-]+|c\/[\w.\-]+|user\/[\w.\-]+)/);
      if (m) return m[0];
    }
    return null;
  }

  function toast(text, tone) {
    let t = document.getElementById("sm-toast");
    if (!t) { t = document.createElement("div"); t.id = "sm-toast"; document.documentElement.appendChild(t); }
    t.textContent = text;
    t.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:72px;max-width:320px;padding:11px 15px;border-radius:10px;" +
      "font:500 13px/1.4 'Roboto',system-ui,sans-serif;color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.3);" +
      "background:" + (tone === "err" ? "#c0392b" : tone === "warn" ? "#b9770e" : "#0f7b5f") + ";transition:opacity .25s;opacity:1;";
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.style.opacity = "0"; }, 3500);
  }

  async function save(btn) {
    const url = channelUrl();
    if (!url) return;
    btn.disabled = true;
    const label = btn.querySelector("span");
    const prev = label.textContent;
    label.textContent = "Đang lưu…";
    try {
      const res = await chrome.runtime.sendMessage({ type: "SAVE_YT", url });
      if (!res?.ok) {
        toast(res?.error || "Không lưu được kênh.", "err");
        label.textContent = prev;
      } else if (res.status === "exists") {
        toast("Kênh đã có trong Bookmark Key.", "warn");
        label.textContent = "Đã có";
      } else {
        toast("Đã lưu “" + (res.title || "kênh") + "” vào Bookmark Key.", "ok");
        label.textContent = "Đã lưu ✓";
      }
    } catch {
      toast("Mất kết nối tiện ích. Tải lại extension rồi thử lại.", "err");
      label.textContent = prev;
    } finally {
      setTimeout(() => { btn.disabled = false; }, 1200);
    }
  }

  function ensureButton() {
    const onChannel = !!channelUrl();
    const existing = document.getElementById(BTN_ID);
    if (!onChannel) { existing?.remove(); return; }
    if (existing) { const l = existing.querySelector("span"); if (l && !/Đang lưu|Đã/.test(l.textContent)) l.textContent = "Lưu kênh"; return; }
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.title = "Lưu kênh này vào Bookmark Key";
    btn.style.cssText = "position:fixed;z-index:2147483646;right:16px;bottom:16px;display:inline-flex;align-items:center;gap:7px;" +
      "height:40px;padding:0 15px;border:0;border-radius:20px;background:#0f7b5f;color:#fff;cursor:pointer;" +
      "font:600 13px/1 'Roboto',system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.28);";
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><span>Lưu kênh</span>';
    btn.addEventListener("click", () => void save(btn));
    document.documentElement.appendChild(btn);
  }

  // YouTube is a SPA: re-check on its navigation event, on load, and periodically as a safety net.
  const refresh = () => { try { ensureButton(); } catch { /* ignore */ } };
  document.addEventListener("yt-navigate-finish", refresh, true);
  window.addEventListener("load", refresh);
  setInterval(refresh, 1500);
  refresh();
})();

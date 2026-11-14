/* Shared, dependency-free code; loaded in the worker and isolated content world. */
(() => {
  "use strict";
  const ACTIVE = new Set(["opening", "running", "stopping"]);
  const STUDIO = "https://www.tiktok.com/tiktokstudio/content";
  const normalize = (text) => String(text ?? "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase().replace(/\s+/g, " ").trim();
  const PRIVACY = {
    private: ["only you", "only me", "private", "chi minh toi", "chi ban", "rieng tu"],
    public: ["everyone", "public", "moi nguoi", "cong khai"],
    friends: ["friends", "ban be", "followers", "nguoi theo doi"],
  };
  const privacy = (text) => Object.keys(PRIVACY).find((key) => PRIVACY[key].includes(normalize(text))) || null;
  function isStudio(url) {
    try {
      const u = new URL(url);
      return u.origin === "https://www.tiktok.com" && /^\/tiktokstudio\/content\/?$/.test(u.pathname);
    } catch { return false; }
  }
  function config(value = {}) {
    const delayMs = Number(value.delayMs ?? 2000);
    if (!Number.isFinite(delayMs) || delayMs < 1000 || delayMs > 30000) {
      throw new Error("Khoảng nghỉ phải từ 1 đến 30 giây.");
    }
    return { delayMs: Math.round(delayMs), timeoutMs: 15000, settleMs: 3000 };
  }
  class Halt extends Error {
    constructor(code, message) { super(message); this.name = "Halt"; this.code = code; }
  }
  globalThis.TSP = { ACTIVE, STUDIO, normalize, privacy, isStudio, config, Halt };
})();

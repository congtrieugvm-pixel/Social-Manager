const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const { JSDOM } = require(require.resolve("jsdom", { paths: [path.resolve(root, "../app"), root] }));
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ids = ["7000000000000000001", "7000000000000000002", "7000000000000000003"];
function row(id, label = "Everyone", title = "A post") {
  return `<tr><td><a href="https://www.tiktok.com/@fixture/video/${id}">${title}</a></td><td><button class="privacy">${label}</button></td><td><button>Delete</button></td></tr>`;
}
function table(rows) { return `<table><thead><tr><th>Post</th><th>Privacy</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`; }
function dom(html, options = {}) {
  const instance = new JSDOM(html, { url: "https://www.tiktok.com/tiktokstudio/content", runScripts: "outside-only", ...options });
  const w = instance.window;
  w.HTMLElement.prototype.getClientRects = function () { return [{ width: 100, height: 30 }]; };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  Object.defineProperty(w.document.documentElement, "clientHeight", { configurable: true, value: 800 });
  Object.defineProperty(w.document.documentElement, "scrollHeight", { configurable: true, value: 800 });
  for (const file of ["shared.js", "engine.js", "adapter.js"]) w.eval(source(file));
  return instance;
}
function adapter(w, options = {}) {
  const a = new w.TSP.DomAdapter({ delayMs: 1, timeoutMs: 220, settleMs: 2 }, options.guard || (async () => {}), options.stopped || (() => false));
  a.sleep = async () => { a.assert(); await new Promise((resolve) => setTimeout(resolve, 1)); a.assert(); };
  return a;
}
function wire(w, options = {}) {
  let clickedDelete = 0;
  for (const button of w.document.querySelectorAll("td:last-child button")) button.onclick = () => clickedDelete++;
  for (const button of w.document.querySelectorAll("button.privacy")) {
    button.onclick = () => {
      const menu = w.document.createElement("div"); menu.setAttribute("role", "listbox");
      const option = w.document.createElement("div"); option.setAttribute("role", "option"); option.textContent = options.label || "Only me";
      option.onclick = () => {
        menu.remove();
        if (options.dialog) {
          const modal = w.document.createElement("div"); modal.setAttribute("role", "dialog");
          modal.innerHTML = "<h2>Privacy settings</h2><p>Only me</p><button>Cancel</button><button>Save</button>";
          modal.lastChild.onclick = () => { button.textContent = options.label || "Only me"; modal.remove(); };
          w.document.body.append(modal);
        } else if (!options.noSave) button.textContent = options.label || "Only me";
        if (options.error) { const alert = w.document.createElement("div"); alert.setAttribute("role", "alert"); alert.textContent = "Too many attempts. Try again later."; w.document.body.append(alert); }
      };
      menu.append(option); w.document.body.append(menu);
      if (options.afterOpen) options.afterOpen();
    };
  }
  return () => clickedDelete;
}
// Mirrors the user's Privacy filter: three checkboxes and Clear / Apply.
// Applied filters re-render rows; changed posts can leave the public list immediately.
function studio(w, initialPosts, options = {}) {
  const posts = new Map(initialPosts.map((post) => [post.id, post.privacy || "public"]));
  const labels = { public: "Mọi người", private: "Chỉ mình tôi", friends: "Bạn bè" };
  const applied = options.initialFilter || [];
  let selected = [...applied], page = options.startPage || 0, failed = 0;
  const applies = [], edits = [];
  w.document.body.innerHTML = "<div id='toolbar'><button id='privacy-filter'>Quyền riêng tư</button></div><main id='post-list'></main>";
  const filterButton = w.document.getElementById("privacy-filter");
  function render() {
    const filtered = [...posts].filter(([, value]) => !selected.length || selected.includes(value));
    const limit = options.pageSize || 20;
    const shown = filtered.slice(page * limit, (page + 1) * limit);
    const list = w.document.getElementById("post-list");
    list.innerHTML = table(shown.map(([id, value]) => row(id, labels[value])).join("")) +
      (!shown.length && !options.noEmptyMarker ? "<div class='empty-state'>Không có bài đăng nào</div>" : "") +
      `<nav aria-label='Pagination'><button aria-label='Previous page' ${page === 0 ? "disabled" : ""}>←</button><button aria-label='Page 1' ${page === 0 ? "aria-current='page'" : ""}>1</button><button aria-label='Next page' ${(page + 1) * limit >= filtered.length ? "disabled" : ""}>→</button></nav>`;
    list.querySelector("[aria-label='Previous page']").onclick = () => { page--; render(); };
    list.querySelector("[aria-label='Page 1']").onclick = () => { page = 0; render(); };
    list.querySelector("[aria-label='Next page']").onclick = () => { page++; render(); };
    for (const button of list.querySelectorAll(".privacy")) {
      const id = button.closest("tr").querySelector("a").href.match(/\d+$/)[0];
      button.onclick = () => {
        if (id === options.failId && failed++ < (options.failTimes || 1)) return;
        const menu = w.document.createElement("div"); menu.dataset.postMenu = "true"; menu.setAttribute("role", "listbox");
        const option = w.document.createElement("div"); option.setAttribute("role", "option"); option.textContent = "Chỉ mình tôi";
        option.onclick = () => {
          menu.remove(); edits.push(id);
          if (options.captchaOnClick) { const cap = w.document.createElement("div"); cap.id = "captcha-test"; w.document.body.append(cap); return; }
          if (options.noSave) return;
          posts.set(id, "private"); render();
        };
        menu.append(option); w.document.body.append(menu);
      };
    }
  }
  function close() { w.document.getElementById("filter-panel")?.remove(); }
  filterButton.onclick = () => {
    if (w.document.getElementById("filter-panel")) { close(); return; }
    w.document.querySelectorAll("[data-post-menu]").forEach((el) => el.remove());
    const panel = w.document.createElement("div"); panel.id = "filter-panel"; panel.setAttribute("role", "dialog");
    panel.innerHTML = Object.entries(labels).map(([key, label]) => options.roleCheckboxes
      ? `<div role='checkbox' aria-checked='${selected.includes(key)}' data-value='${key}'>${label}</div>`
      : `<label><input type='checkbox' value='${key}' ${selected.includes(key) ? "checked" : ""}><span>${label}</span></label>`).join("") + "<div><button>Xóa</button><button>Áp dụng</button></div>";
    if (options.roleCheckboxes) for (const checkbox of panel.querySelectorAll("[role=checkbox]")) checkbox.onclick = () => checkbox.setAttribute("aria-checked", String(checkbox.getAttribute("aria-checked") !== "true"));
    panel.querySelectorAll("button")[0].onclick = () => {
      panel.querySelectorAll("input").forEach((el) => el.checked = false);
      panel.querySelectorAll("[role=checkbox]").forEach((el) => el.setAttribute("aria-checked", "false"));
    };
    panel.querySelectorAll("button")[1].onclick = () => {
      selected = options.roleCheckboxes ? [...panel.querySelectorAll('[aria-checked="true"]')].map((el) => el.dataset.value) : [...panel.querySelectorAll("input:checked")].map((el) => el.value);
      applies.push([...selected]); close(); if (!options.stickyPage) page = 0; render();
    };
    w.document.body.append(panel);
  };
  w.document.addEventListener("keydown", (event) => { if (event.key === "Escape") { close(); w.document.querySelectorAll("[data-post-menu]").forEach((el) => el.remove()); } });
  render();
  return { posts, applies, edits, get selected() { return selected; }, get page() { return page; }, render };
}
module.exports = { root, source, ids, row, table, dom, adapter, wire, studio, JSDOM };

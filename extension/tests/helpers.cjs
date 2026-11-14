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
module.exports = { root, source, ids, row, table, dom, adapter, wire, JSDOM };

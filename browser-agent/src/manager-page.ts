// The Browser Manager page (served by manager.ts on 127.0.0.1 only). Self-contained:
// no external fonts/scripts. The inline script avoids template literals on purpose.
export const MANAGER_HTML = String.raw`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Browser Manager</title>
<style>
:root { --bg:#f3f5f7; --paper:#fff; --bg2:#eef1f4; --ink:#172033; --muted:#5b6475; --line:#e1e5ea; --accent:#0f7b5f; --accent-soft:rgba(15,123,95,.1); --warn:#a15c07; --warn-soft:rgba(161,92,7,.12); --danger:#b42318; --danger-soft:rgba(180,35,24,.08); --shot:#0f1217; --shadow:0 1px 2px rgba(23,32,51,.06),0 8px 24px rgba(23,32,51,.06); color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#15181d; --paper:#1c2027; --bg2:#222730; --ink:#e7eaee; --muted:#9aa3b2; --line:#2a303a; --accent:#34b98f; --accent-soft:rgba(52,185,143,.14); --warn:#e0a345; --warn-soft:rgba(224,163,69,.14); --danger:#f0796f; --danger-soft:rgba(240,121,111,.12); --shot:#0b0d11; --shadow:0 1px 2px rgba(0,0,0,.3); color-scheme: dark; } }
* { box-sizing: border-box; }
[hidden] { display:none !important; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif; }
header { position:sticky; top:0; z-index:5; display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:14px 22px; background:color-mix(in srgb,var(--bg) 88%,transparent); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); }
h1 { font-size:18px; font-weight:650; margin:0; letter-spacing:-.2px; }
.count { display:inline-flex; align-items:center; gap:8px; padding:5px 12px; border-radius:999px; background:var(--paper); border:1px solid var(--line); font-size:13px; }
.count b { font-variant-numeric:tabular-nums; }
.dot { width:8px; height:8px; border-radius:50%; background:var(--muted); flex:none; }
.live .dot, .dot.on { background:var(--accent); animation:pulse 1.8s ease-out infinite; }
@keyframes pulse { 0% { box-shadow:0 0 0 0 var(--accent-soft); } 100% { box-shadow:0 0 0 8px transparent; } }
@media (prefers-reduced-motion: reduce) { .dot { animation:none !important; } }
.spacer { flex:1; }
.seg { display:inline-flex; padding:3px; gap:2px; background:var(--bg2); border:1px solid var(--line); border-radius:9px; }
.seg button { border:0; background:transparent; color:var(--muted); font:inherit; font-size:12.5px; padding:5px 11px; border-radius:7px; cursor:pointer; min-height:30px; }
.seg button[aria-pressed="true"] { background:var(--paper); color:var(--ink); box-shadow:0 1px 2px rgba(0,0,0,.12); }
.btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:34px; padding:0 13px; border:1px solid var(--line); border-radius:8px; background:var(--paper); color:var(--ink); font:inherit; font-size:13px; font-weight:550; cursor:pointer; transition:background .15s,border-color .15s; }
.btn:hover:not(:disabled) { background:var(--bg2); }
.btn:focus-visible, .seg button:focus-visible, .shot:focus-visible { outline:none; box-shadow:0 0 0 3px var(--accent-soft), 0 0 0 1px var(--accent); }
.btn:disabled { opacity:.5; cursor:default; }
.btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
.btn.primary:hover:not(:disabled) { filter:brightness(1.08); background:var(--accent); }
.btn.danger { color:var(--danger); }
.btn.danger:hover:not(:disabled) { background:var(--danger-soft); }
main { padding:20px 22px 40px; }
.grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(var(--tile,380px),1fr)); }
.tile { display:flex; flex-direction:column; background:var(--paper); border:1px solid var(--line); border-radius:12px; overflow:hidden; box-shadow:var(--shadow); }
.tile.warn { border-color:color-mix(in srgb,var(--warn) 55%,var(--line)); }
.top { display:flex; align-items:center; gap:8px; padding:9px 12px; min-width:0; }
.top b { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13.5px; }
.tag { flex:none; margin-left:auto; font-size:11px; font-weight:600; padding:2px 8px; border-radius:6px; background:var(--accent-soft); color:var(--accent); }
.tag.warn { background:var(--warn-soft); color:var(--warn); }
.tag.muted { background:var(--bg2); color:var(--muted); }
.shot { position:relative; display:block; width:100%; aspect-ratio:16/9; padding:0; border:0; background:var(--shot); cursor:pointer; overflow:hidden; }
.shot img { width:100%; height:100%; object-fit:contain; display:block; }
.shot .hint { position:absolute; inset:auto 8px 8px auto; padding:4px 9px; border-radius:6px; background:rgba(0,0,0,.62); color:#fff; font-size:11.5px; opacity:0; transition:opacity .15s; }
.shot:hover .hint, .shot:focus-visible .hint { opacity:1; }
.shot .wait { position:absolute; inset:0; display:grid; place-items:center; color:#8a93a3; font-size:12px; }
.stale { position:absolute; left:8px; top:8px; padding:2px 8px; border-radius:6px; background:rgba(0,0,0,.6); color:#fff; font-size:11px; }
.foot { display:flex; align-items:center; gap:8px; padding:9px 12px; border-top:1px solid var(--line); }
.task { flex:1; min-width:0; font-size:12px; color:var(--muted); }
.task div { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.task .msg { color:var(--ink); opacity:.85; }
.foot .btn { min-height:30px; padding:0 10px; font-size:12px; }
.empty { display:grid; place-items:center; gap:6px; text-align:center; padding:90px 20px; color:var(--muted); }
.empty b { color:var(--ink); font-size:15px; }
.banner { margin:0 0 16px; padding:10px 14px; border-radius:9px; background:var(--warn-soft); color:var(--warn); font-size:13px; display:none; }
</style>
</head>
<body>
<header>
  <h1>Browser Manager</h1>
  <span class="count" id="count"><span class="dot"></span><span><b id="used">0</b>/<span id="max">–</span> luồng</span><span id="opening"></span></span>
  <span class="spacer"></span>
  <div class="seg" role="group" aria-label="Cỡ ô">
    <button data-size="280px">Nhỏ</button><button data-size="380px">Vừa</button><button data-size="560px">Lớn</button>
  </div>
  <button class="btn danger" id="closeAll" disabled>Đóng tất cả</button>
</header>
<main>
  <div class="banner" id="banner" role="alert">Mất kết nối với chương trình Social Manager Browser. Đang thử lại…</div>
  <div class="grid" id="grid" aria-live="polite"></div>
  <div class="empty" id="empty" hidden><b>Chưa có trình duyệt nào đang mở</b><span>Mở trình duyệt hoặc Ẩn bài từ trang quản lý TikTok, cửa sổ sẽ hiện ở đây.</span></div>
</main>
<script>
(function () {
  var token = new URLSearchParams(location.search).get('t') || '';
  var q = '?t=' + encodeURIComponent(token);
  var grid = document.getElementById('grid'), empty = document.getElementById('empty');
  var tiles = {}, shotUrls = {}, shotAt = {}, busy = {};
  var STATUS = { starting: 'Đang mở', open: 'Đã mở', logged_in: 'Đã đăng nhập', unverified: 'Chưa xác minh', needs_verification: 'Cần xác minh', wrong_account: 'Nhầm tài khoản', closed: 'Đã đóng' };
  var KIND = { open: 'Mở trình duyệt', hide: 'Ẩn bài', post: 'Đăng video' };
  var WARN = ['needs_verification', 'wrong_account', 'unverified'];

  // Tile size (remembered on this PC).
  var size = '380px';
  try { size = localStorage.getItem('bm-size') || size; } catch (e) {}
  function setSize(v) { size = v; document.documentElement.style.setProperty('--tile', v); document.querySelectorAll('.seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.size === v)); }); try { localStorage.setItem('bm-size', v); } catch (e) {} }
  document.querySelectorAll('.seg button').forEach(function (b) { b.onclick = function () { setSize(b.dataset.size); }; });
  setSize(size);

  function ago(ms) { var s = Math.max(0, Math.round(ms / 1000)); if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + ' phút'; return Math.floor(s / 3600) + ' giờ ' + Math.floor((s % 3600) / 60) + ' phút'; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function post(path) { return fetch(path + q, { method: 'POST' }).then(function (r) { return r.ok ? r.json() : {}; }, function () { return {}; }); }

  function build(t) {
    var root = el('article', 'tile'), top = el('div', 'top'), dot = el('span', 'dot'), name = el('b'), tag = el('span', 'tag');
    top.append(dot, name, tag);
    var shot = el('button', 'shot'); shot.type = 'button';
    var img = el('img'); img.alt = ''; img.hidden = true;
    var wait = el('span', 'wait', 'Đang chụp màn hình…'), stale = el('span', 'stale', 'Ảnh cũ'); stale.hidden = true;
    shot.append(img, wait, stale, el('span', 'hint', 'Bấm để mở cửa sổ'));
    var foot = el('div', 'foot'), task = el('div', 'task'), line1 = el('div'), line2 = el('div', 'msg');
    task.append(line1, line2);
    var focus = el('button', 'btn', 'Mở cửa sổ'), close = el('button', 'btn danger', 'Đóng');
    foot.append(task, focus, close);
    root.append(top, shot, foot);
    function bring() {
      focus.disabled = true;
      post('/api/focus/' + t.profileId).then(function (r) { focus.disabled = false; if (!r.ok) { focus.textContent = 'Không tìm thấy cửa sổ'; setTimeout(function () { focus.textContent = 'Mở cửa sổ'; }, 2500); } });
    }
    shot.onclick = bring; focus.onclick = bring;
    close.onclick = function () {
      if (!confirm('Đóng trình duyệt của @' + name.textContent.replace(/^@/, '') + '? Việc đang chạy trong cửa sổ này sẽ dừng.')) return;
      close.disabled = true; close.textContent = 'Đang đóng…';
      post('/api/close/' + t.profileId).then(refresh);
    };
    return { root: root, dot: dot, name: name, tag: tag, img: img, wait: wait, stale: stale, line1: line1, line2: line2, shot: shot };
  }

  function update(view, t, now) {
    view.name.textContent = '@' + t.username;
    view.shot.setAttribute('aria-label', 'Mở cửa sổ của @' + t.username);
    view.tag.textContent = STATUS[t.status] || t.status;
    var warn = WARN.indexOf(t.status) >= 0;
    view.tag.className = 'tag' + (warn ? ' warn' : t.status === 'starting' ? ' muted' : '');
    view.root.className = 'tile' + (warn ? ' warn' : '');
    view.dot.className = 'dot' + (t.job ? ' on' : '');
    if (t.job) {
      var text = KIND[t.job.kind] || t.job.kind;
      if (t.job.hide) text += ' · ' + t.job.hide.changed + ' đã ẩn · ' + t.job.hide.skipped + ' vốn riêng tư';
      view.line1.textContent = text + ' · ' + ago(now - t.job.startedAt);
      view.line2.textContent = t.job.hide && t.job.hide.message ? t.job.hide.message : '';
    } else {
      view.line1.textContent = 'Đang mở, không chạy lệnh · ' + ago(now - t.openedAt);
      view.line2.textContent = '';
    }
  }

  // One screenshot request per tile at a time, about once a second.
  function loadShot(id) {
    if (busy[id] || !tiles[id]) return;
    busy[id] = true;
    fetch('/api/shot/' + id + q, { cache: 'no-store' }).then(function (r) { return r.status === 200 ? r.blob() : null; }).then(function (blob) {
      var view = tiles[id]; if (!view) return;
      if (blob) {
        var url = URL.createObjectURL(blob);
        view.img.onload = function () { if (shotUrls[id] && shotUrls[id] !== url) URL.revokeObjectURL(shotUrls[id]); shotUrls[id] = url; };
        view.img.src = url; view.img.hidden = false; view.wait.hidden = true; shotAt[id] = Date.now();
      }
      view.stale.hidden = !shotAt[id] || Date.now() - shotAt[id] < 6000;
    }).catch(function () {}).then(function () { busy[id] = false; });
  }

  var offline = false;
  function refresh() {
    return fetch('/api/state' + q, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('state'); return r.json(); }).then(function (s) {
      if (offline) { offline = false; document.getElementById('banner').style.display = 'none'; }
      document.getElementById('used').textContent = s.used;
      document.getElementById('max').textContent = s.max;
      document.getElementById('opening').textContent = s.opening ? '· ' + s.opening + ' đang mở' : '';
      document.getElementById('count').className = 'count' + (s.tiles.length ? ' live' : '');
      document.getElementById('closeAll').disabled = !s.tiles.length;
      var seen = {};
      s.tiles.forEach(function (t) {
        seen[t.profileId] = true;
        if (!tiles[t.profileId]) { tiles[t.profileId] = build(t); grid.append(tiles[t.profileId].root); }
        update(tiles[t.profileId], t, s.now);
      });
      Object.keys(tiles).forEach(function (id) {
        if (seen[id]) return;
        tiles[id].root.remove(); delete tiles[id];
        if (shotUrls[id]) { URL.revokeObjectURL(shotUrls[id]); delete shotUrls[id]; }
      });
      empty.hidden = s.tiles.length > 0;
    }).catch(function () { offline = true; document.getElementById('banner').style.display = 'block'; });
  }

  document.getElementById('closeAll').onclick = function () {
    var n = Object.keys(tiles).length;
    if (!n || !confirm('Đóng tất cả ' + n + ' trình duyệt? Mọi việc đang chạy sẽ dừng.')) return;
    this.disabled = true;
    post('/api/close-all').then(refresh);
  };

  function loop() { if (!document.hidden) { refresh(); Object.keys(tiles).forEach(loadShot); } }
  loop(); setInterval(loop, 1000);
  document.addEventListener('visibilitychange', loop);
})();
</script>
</body>
</html>`;

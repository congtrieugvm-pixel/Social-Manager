(() => {
  "use strict";
  const { normalize: n, privacy, isStudio, Halt } = TSP;
  const ROW = "tbody tr,[role='row'],[data-video-id],[data-item-id]";
  const CLICKABLE = "button,[role='button'],[role='combobox'],[aria-haspopup],select,[tabindex='0']";
  const PRIVATE_OPTIONS = "[role='option'],[role='menuitem'],[role='menuitemradio'],[role='radio'],label,li,button,div,span";
  const exact = (element) => (element?.getAttribute("aria-label") || element?.innerText || element?.textContent || "").trim();
  function visible(element) {
    if (!element?.isConnected || element.closest("[hidden],[aria-hidden='true']")) return false;
    for (let el = element; el && el.nodeType === 1; el = el.parentElement) {
      const css = getComputedStyle(el);
      if (css.display === "none" || css.visibility === "hidden" || css.opacity === "0") return false;
    }
    return element.getClientRects().length > 0;
  }
  const disabled = (el) => el.disabled || el.getAttribute("aria-disabled") === "true" ||
    /(^|[\s_-])disabled([\s_-]|$)/i.test(el.className || "");
  function kind(el) {
    const raw = el.tagName === "SELECT" ? el.selectedOptions[0]?.textContent : exact(el);
    return privacy(raw?.replace(/^(?:privacy|visibility|quyền riêng tư|ai có thể xem(?: bài đăng này)?)\s*[:：]\s*/i, ""));
  }
  function idFrom(element) {
    const ids = new Set();
    for (const el of [element, ...element.querySelectorAll("[data-video-id],[data-item-id],a[href]")]) {
      for (const attr of ["data-video-id", "data-item-id"]) {
        const value = el.getAttribute(attr);
        if (/^\d{6,30}$/.test(value || "")) ids.add(value);
      }
      if (el.tagName === "A") {
        try {
          const url = new URL(el.getAttribute("href"), location.href);
          if (url.hostname !== "www.tiktok.com") continue;
          const value = url.pathname.match(/\/(?:video|photo)\/(\d{6,30})(?:\/|$)/)?.[1] ||
            ["item_id", "video_id", "itemId", "videoId"].map((key) => url.searchParams.get(key)).find((v) => /^\d{6,30}$/.test(v || ""));
          if (value) ids.add(value);
        } catch { /* unrelated links are not post identities */ }
      }
    }
    return ids.size === 1 ? [...ids][0] : null;
  }
  function control(row) {
    // A privacy column is stronger evidence than an arbitrary caption containing "Everyone".
    let scope = row;
    const table = row.closest("table,[role='table'],[role='grid']");
    if (table) {
      const headers = [...table.querySelectorAll("thead th,[role='columnheader']")];
      const index = headers.findIndex((h) => /^(privacy|visibility|who can (?:watch|view)|quyen rieng tu|ai co the xem)/.test(n(exact(h))));
      const cells = [...row.querySelectorAll(":scope > td,:scope > [role='cell'],:scope > [role='gridcell']")];
      if (index >= 0 && cells[index]) scope = cells[index];
    }
    const candidates = [...scope.querySelectorAll(CLICKABLE)].filter((el) => visible(el) && kind(el) && !el.closest("a[href]"));
    // Some Studio builds use clickable div/span labels with no accessible button role.
    if (!candidates.length) {
      for (const el of scope.querySelectorAll("div,span")) {
        if (!visible(el) || !kind(el) || el.closest("a[href]")) continue;
        if ([...el.children].some((child) => kind(child))) continue;
        candidates.push(el.closest(CLICKABLE) || el);
      }
    }
    const unique = [...new Set(candidates)].filter((el, _, all) => !all.some((other) => other !== el && el.contains(other)));
    if (unique.length !== 1) return null;
    return unique[0];
  }
  class DomAdapter {
    constructor(settings, guard, stopped) {
      this.settings = settings;
      this.guard = guard;
      this.stopped = stopped;
      this.pageSignatures = new Set();
    }
    assert() {
      if (this.stopped()) throw new Halt("stopped", "Đã dừng theo yêu cầu.");
      if (!isStudio(location.href)) throw new Halt("navigation", "Trang đã rời mục Bài đăng. Bấm bắt đầu để mở lại Studio.");
      const captcha = [...document.querySelectorAll("iframe[src*='captcha'],[id*='captcha' i],[class*='captcha' i]")].find(visible);
      if (captcha) throw new Halt("captcha", "TikTok yêu cầu xác minh. Hoàn tất xác minh trong Studio rồi chạy lại.");
      if ([...document.querySelectorAll("input[type='password']")].some(visible)) throw new Halt("login", "Cần đăng nhập TikTok trong Studio rồi chạy lại.");
      for (const alert of document.querySelectorAll("[role='alert'],[data-e2e*='toast'],[class*='Toast']")) {
        if (visible(alert) && /too (?:many|frequent)|try again|failed|couldn.t|khong the|thu lai|qua nhieu|that bai|loi he thong/.test(n(exact(alert)))) {
          throw new Halt("tiktok_error", "TikTok báo lỗi hoặc giới hạn thao tác. Kiểm tra thông báo trong Studio trước khi chạy lại.");
        }
      }
    }
    async sleep(ms) {
      const until = Date.now() + ms;
      do { this.assert(); await new Promise((resolve) => setTimeout(resolve, Math.min(120, Math.max(1, until - Date.now())))); } while (Date.now() < until);
    }
    async wait(fn, message, timeout = this.settings.timeoutMs) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        this.assert();
        const result = fn();
        if (result) return result;
        await this.sleep(120);
      }
      throw new Halt("unsupported_ui", message);
    }
    async click(el) {
      await this.guard();
      this.assert();
      if (!visible(el) || disabled(el)) throw new Halt("unavailable", "Nút thao tác không còn khả dụng. Kiểm tra Studio rồi chạy lại.");
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      el.click();
    }
    rows() {
      const found = new Map();
      const candidates = new Set(document.querySelectorAll(ROW));
      for (const link of document.querySelectorAll("a[href*='/video/'],a[href*='/photo/'],a[href*='video_id='],a[href*='item_id='],a[href*='videoId='],a[href*='itemId=']")) {
        let parent = link.parentElement;
        for (let depth = 0; parent && depth < 9; depth++, parent = parent.parentElement) {
          if (["BODY", "HTML", "MAIN"].includes(parent.tagName)) break;
          if (idFrom(parent) && control(parent)) { candidates.add(parent); break; }
        }
      }
      for (const element of candidates) {
        if (!visible(element)) continue;
        const id = idFrom(element);
        if (!id) {
          if (control(element)) throw new Halt("missing_id", "Có hàng quyền riêng tư nhưng không xác định được ID bài. Dừng để tránh bỏ sót bài trong danh sách.");
          continue;
        }
        const old = found.get(id);
        if (old && !old.element.contains(element) && !element.contains(old.element)) throw new Halt("ambiguous_row", "Một ID bài xuất hiện ở nhiều hàng. Dừng để tránh đổi nhầm bài.");
        // Thumbnail data attributes can be nested inside a complete row. Keep the
        // smallest container that still includes its own privacy control.
        if (!old || (old.element.contains(element) && (control(element) || !control(old.element)))) found.set(id, { id, element });
      }
      return [...found.values()];
    }
    empty() {
      return [...document.querySelectorAll("[class*='empty' i],[data-e2e*='empty'],[role='status']")]
        .some((el) => visible(el) && /^(no (?:posts|videos|content)(?: yet)?|chua co (?:bai dang|video)|khong co (?:bai dang|video))\b/.test(n(exact(el))));
    }
    filtered() {
      const search = [...document.querySelectorAll("input[type='search'],input[placeholder*='Search' i],input[placeholder*='Tìm']")].some((el) => visible(el) && el.value.trim());
      const activeFilters = [...document.querySelectorAll("[role='tab'][aria-selected='true'],button[aria-pressed='true']")].some((el) => /^(public|private|friends|everyone|only me|only you|cong khai|rieng tu|ban be|chi minh toi|scheduled|drafts|da len lich|ban nhap)$/.test(n(exact(el))));
      const rowElements = this.rows().map((row) => row.element);
      const privacyFilter = [...document.querySelectorAll("select,[role='combobox']")].some((el) =>
        visible(el) && kind(el) && !rowElements.some((row) => row.contains(el)));
      return search || activeFilters || privacyFilter;
    }
    loading() {
      return [...document.querySelectorAll("[aria-busy='true'],[role='progressbar'],[data-e2e='loading'],[class*='table-loading' i]")].some(visible);
    }
    async prepare() {
      await this.wait(() => this.rows().length || this.empty(), "Không nhận diện được hàng bài đăng. Kiểm tra đăng nhập, ngôn ngữ Việt/Anh và giao diện Studio. Chưa có bài nào được đổi.", 45000);
      await this.wait(() => !this.loading(), "Danh sách vẫn đang tải. Chưa thể bắt đầu xử lý.");
      if (this.filtered()) throw new Halt("filtered", "Danh sách đang được tìm kiếm hoặc lọc. Xóa bộ lọc trong Studio rồi chạy lại để xử lý toàn bộ.");
      const scroller = this.scroller();
      scroller.scrollTop = 0;
      await this.sleep(500);
      this.pageSignatures.add(this.signature());
    }
    row(id) { return this.rows().find((row) => row.id === id); }
    privateChoices() {
      const elements = [...document.querySelectorAll(PRIVATE_OPTIONS)].filter((el) => visible(el) && privacy(exact(el)) === "private" && !el.closest("a[href]"));
      return elements.filter((el) => !elements.some((other) => other !== el && el.contains(other)));
    }
    privacyDialog() {
      const dialogs = [...document.querySelectorAll("[role='dialog'],[aria-modal='true'],[class*='ModalContent'],[class*='modal-content']")]
        .filter((el) => visible(el) && /privacy|who can (?:watch|view|see)|quyen rieng tu|ai co the xem|only (?:me|you)|chi (?:minh toi|ban)/.test(n(el.innerText || el.textContent)));
      return dialogs.filter((el) => !dialogs.some((other) => other !== el && el.contains(other)));
    }
    async confirmIfNeeded() {
      const dialogs = this.privacyDialog();
      if (dialogs.length > 1) throw new Halt("ambiguous_dialog", "Có nhiều hộp thoại riêng tư. Hãy đóng hộp thoại thừa rồi chạy lại.");
      if (!dialogs.length) return false;
      const dialog = dialogs[0];
      if (!/only (?:me|you)|chi (?:minh toi|ban)|rieng tu/.test(n(dialog.innerText || dialog.textContent))) return false;
      const buttons = [...dialog.querySelectorAll("button,[role='button']")].filter((el) => visible(el) && /^(save|confirm|apply|update|luu|xac nhan|ap dung|cap nhat)$/.test(n(exact(el))));
      if (buttons.length !== 1 || disabled(buttons[0])) return false;
      await this.click(buttons[0]);
      return true;
    }
    async makePrivate(id) {
      this.assert();
      const row = this.row(id);
      if (!row) throw new Halt("missing_row", "Bài đang xử lý đã rời danh sách. Kiểm tra bộ lọc hoặc tải lại Studio.");
      const trigger = control(row.element);
      if (!trigger) throw new Halt("unknown_privacy", "Không xác định duy nhất được nút quyền riêng tư của bài. Giao diện Studio có thể đã thay đổi.");
      if (kind(trigger) === "private") return "skipped";
      if (trigger.tagName === "SELECT") {
        const choices = [...trigger.options].filter((option) => privacy(option.textContent) === "private");
        if (choices.length !== 1 || choices[0].disabled) throw new Halt("unknown_option", "Không tìm được lựa chọn Chỉ mình tôi.");
        await this.guard();
        this.assert();
        if (disabled(trigger)) throw new Halt("unavailable", "TikTok không cho sửa quyền riêng tư bài này.");
        trigger.value = choices[0].value;
        trigger.dispatchEvent(new Event("input", { bubbles: true }));
        trigger.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        const before = new Set(this.privateChoices());
        await this.click(trigger);
        const choice = await this.wait(() => {
          const added = this.privateChoices().filter((el) => !before.has(el));
          if (added.length > 1) throw new Halt("ambiguous_option", "Có nhiều lựa chọn Chỉ mình tôi. Dừng để tránh bấm sai.");
          return added[0];
        }, "Không thấy lựa chọn Chỉ mình tôi trong menu vừa mở. Hãy kiểm tra Studio.");
        await this.click(choice);
      }
      let stableSince = 0;
      let confirmed = false;
      const until = Date.now() + this.settings.timeoutMs;
      while (Date.now() < until) {
        this.assert();
        if (!confirmed) confirmed = await this.confirmIfNeeded();
        const current = this.row(id);
        const currentControl = current && control(current.element);
        if (currentControl && kind(currentControl) === "private" && !this.privacyDialog().length) {
          stableSince ||= Date.now();
          if (Date.now() - stableSince >= this.settings.settleMs) return "changed";
        } else stableSince = 0;
        await this.sleep(120);
      }
      throw new Halt("verification", "Chưa xác nhận bài đã lưu thành Chỉ mình tôi. Dừng tại bài này; kiểm tra Studio trước khi chạy lại.");
    }
    async rest(outcome) { await this.sleep(outcome === "changed" ? this.settings.delayMs : 80); }
    scroller() {
      const row = this.rows()[0]?.element;
      for (let parent = row?.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight + 4) return parent;
      }
      return document.scrollingElement || document.documentElement;
    }
    signature() { return this.rows().map((row) => row.id).join(","); }
    nextButton() {
      const selectors = "[aria-label],[title],[rel='next'],[class*='pagination-next' i],[class*='paginationNext'],[class*='page-next'],[class*='PaginationNext']";
      const pagination = "nav,[class*='pagination' i],[class*='Pagination'],[role='navigation']";
      const choices = [...document.querySelectorAll(selectors)].filter((el) => {
        if (!visible(el)) return false;
        const label = n(el.getAttribute("aria-label") || el.getAttribute("title") || "");
        return /^(next(?: page)?|go to next page|trang (?:tiep|sau)(?: theo)?|tiep theo)$/.test(label) ||
          el.getAttribute("rel") === "next" || /pagination.?next|page-next/i.test(el.className || "");
      });
      for (const el of document.querySelectorAll(`${pagination.split(",").map((s) => `${s} button,${s} [role='button']`).join(",")}`)) {
        if (visible(el) && /^(next|next page|tiep|trang sau|trang tiep|tiep theo)$/.test(n(exact(el)))) choices.push(el);
      }
      const unique = [...new Set(choices)].filter((el, _, all) => !all.some((other) => other !== el && other.contains(el)));
      if (unique.length > 1) throw new Halt("ambiguous_pagination", "Không xác định duy nhất được nút trang tiếp theo.");
      return unique[0] || null;
    }
    endMarker() {
      return [...document.querySelectorAll("[role='status'],[class*='end' i],[class*='empty' i]")].some((el) => visible(el) && /^(no more (?:posts|videos|content)|you.ve reached the end|da het (?:bai dang|video)|khong con (?:bai dang|video))\b/.test(n(exact(el))));
    }
    async advance(seen) {
      this.assert();
      if (this.filtered()) throw new Halt("filtered", "Bộ lọc đã thay đổi trong khi chạy. Đã dừng.");
      const hasFresh = () => this.rows().some((row) => !seen.has(row.id));
      if (hasFresh()) return "more";
      const scroller = this.scroller();
      const bottom = () => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      if (!bottom()) {
        const position = scroller.scrollTop;
        scroller.scrollTop += Math.max(180, scroller.clientHeight * 0.7);
        await this.sleep(900);
        if (scroller.scrollTop === position && !bottom()) throw new Halt("scroll_stuck", "Không cuộn được danh sách. Kiểm tra Studio rồi chạy lại.");
        return "more";
      }
      // Give infinite lists time to append, while never interpreting a timeout as completion.
      for (let i = 0; i < 3; i++) {
        await this.sleep(1000);
        if (hasFresh() || !bottom()) return "more";
      }
      await this.wait(() => !this.loading(), "Danh sách vẫn đang tải. Chưa xác nhận được cuối danh sách.");
      if (hasFresh() || !bottom()) return "more";
      const next = this.nextButton();
      if (next && disabled(next)) return "end";
      if (next) {
        const previous = this.signature();
        await this.click(next);
        await this.wait(() => {
          const current = this.signature();
          return current && current !== previous && current;
        }, "Đã bấm trang tiếp nhưng danh sách không đổi. Dừng để tránh lặp.");
        await this.wait(() => !this.loading(), "Trang tiếp theo vẫn đang tải. Đã dừng để tránh bỏ sót bài.");
        // Some tables preserve scroll offset across pages; reset before processing.
        this.scroller().scrollTop = 0;
        await this.sleep(500);
        const signature = this.signature();
        if (this.pageSignatures.has(signature)) throw new Halt("pagination_loop", "Phân trang quay lại danh sách đã xử lý. Đã dừng.");
        this.pageSignatures.add(signature);
        return "page";
      }
      if (this.endMarker() || (this.empty() && seen.size === 0)) return "end";
      return "unknown";
    }
  }
  globalThis.TSP.DomAdapter = DomAdapter;
})();

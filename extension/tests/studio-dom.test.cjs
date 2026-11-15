const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dom, adapter, studio, ids } = require("./helpers.cjs");

// Sanitized structure observed in authenticated Studio. No account content or signed URLs.
function studioRow(cover = "fixture-cover", date = "1 tháng 10, 1:00 CH") {
  return `<div data-tt="components_RowLayout_FlexRow">
    <div data-tt="components_PostInfoCell_FlexRow">
      <img data-tt="VideoCover_index_Image" src="https://images.example.test/covers/${cover}~tplv-crop.jpeg?expires=1">
      <span data-tt="VideoCover_index_TUXText">05:20</span>
      <div data-tt="components_PostInfoCell_Container">Không có mô tả</div>
      <span data-tt="components_PublishStageLabel_TUXText">${date}</span>
    </div>
    <button data-tt="components_PrivacyCell_TUXButton">Mọi người</button>
  </div>`;
}

test("Studio filter is distinguished from its div-based Privacy column header", () => {
  const d = dom(`<div data-tt="components_FilterButton_FlexCenter"><span>Quyền riêng tư</span></div>
    <div data-tt="components_PostTableHeader_FlexRow"><span data-tt="components_PostTableHeader_TUXText">Quyền riêng tư</span></div>`);
  try {
    assert.equal(adapter(d.window).filterTrigger(), d.window.document.querySelector('[data-tt="components_FilterButton_FlexCenter"]'));
  } finally { d.window.close(); }
});

test("native checkbox labels with pointer-events none use the Studio option row", async () => {
  const d = dom("");
  try {
    const ui = studio(d.window, [{ id: ids[0] }]);
    const a = adapter(d.window);
    const panel = await a.openFilter();
    for (const label of [...panel.querySelectorAll("label")]) {
      const option = d.window.document.createElement("div");
      option.setAttribute("data-tt", "components_CheckboxGroupWithConfirm_FlexRow");
      label.replaceWith(option);
      option.append(label);
      label.style.pointerEvents = "none";
      label.className = "Checkbox__root Checkbox__root--disabled-false";
      label.setAttribute("aria-disabled", "false");
      // Studio binds the toggle to the row. A label click can toggle twice.
      option.onclick = () => { const input = option.querySelector("input"); input.checked = !input.checked; };
    }
    await a.chooseFilter("public");
    assert.deepEqual(ui.selected, ["public"]);
  } finally { d.window.close(); }
});

test("disabled-false classes stay clickable while actual disabled controls are rejected", async () => {
  const d = dom('<button class="Button--disabled-false" aria-disabled="false"><span>Áp dụng</span></button>');
  try {
    const button = d.window.document.querySelector("button");
    let clicked = 0;
    button.onclick = () => clicked++;
    const a = adapter(d.window);
    await a.click(button);
    assert.equal(clicked, 1);
    button.setAttribute("aria-disabled", "true");
    await assert.rejects(a.click(button.firstElementChild), { code: "unavailable" });
    assert.equal(clicked, 1);
  } finally { d.window.close(); }
});

test("captionless Studio rows get stable distinct keys across URL signatures and privacy changes", () => {
  const d = dom(studioRow() + studioRow("second-cover"));
  try {
    const a = adapter(d.window);
    const original = a.rows().map(row => row.id);
    assert.equal(original.length, 2);
    assert.match(original[0], /^dom:[a-f0-9]{16}$/);
    assert.notEqual(original[0], original[1]);
    const img = d.window.document.querySelector("img");
    img.src = "https://another.example.test/covers/fixture-cover~tplv-new-format.webp?expires=200";
    d.window.document.querySelector("button").textContent = "Chỉ mình tôi";
    assert.deepEqual(a.rows().map(row => row.id), original);
  } finally { d.window.close(); }
});

test("captionless duplicate rows remain ambiguous and missing evidence is rejected", () => {
  const d = dom(studioRow() + studioRow());
  try {
    const a = adapter(d.window);
    assert.throws(() => a.rows(), { code: "ambiguous_row" });
    d.window.document.body.innerHTML = studioRow();
    d.window.document.querySelector("img").remove();
    assert.throws(() => a.rows(), { code: "missing_id" });
  } finally { d.window.close(); }
});

test("captionless post can be changed and verified using its stable DOM key", async () => {
  const d = dom(studioRow());
  try {
    const a = adapter(d.window);
    const button = d.window.document.querySelector("button");
    button.onclick = () => {
      const option = d.window.document.createElement("div");
      option.textContent = "Chỉ mình tôi";
      option.onclick = () => { button.textContent = "Chỉ mình tôi"; option.remove(); };
      d.window.document.body.append(option);
    };
    const id = a.rows()[0].id;
    assert.equal(await a.makePrivate(id), "changed");
    assert.equal(a.rows()[0].id, id);
  } finally { d.window.close(); }
});

test("real post links take precedence over captionless fallback keys", () => {
  const d = dom(studioRow());
  try {
    d.window.document.querySelector('[data-tt="components_PostInfoCell_Container"]').innerHTML = `<a href='/@fixture/video/${ids[0]}'>Post</a>`;
    assert.equal(adapter(d.window).rows()[0].id, ids[0]);
  } finally { d.window.close(); }
});

test("Studio explicit empty search label is recognized without hashed CSS classes", () => {
  const d = dom('<div data-tt="components_EmptySearch_FlexColumn"><span data-tt="components_EmptySearch_TUXText">Không tìm thấy kết quả</span><button>Xóa tất cả</button></div>');
  try { assert.equal(adapter(d.window).empty(), true); }
  finally { d.window.close(); }
});

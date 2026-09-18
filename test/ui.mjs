import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
const server = createServer(async (req, res) => {
  try {
    const file = req.url === "/" ? "test/harness.html" : req.url.slice(1);
    if (file.includes("..")) throw Error();
    const body = await readFile(file);
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".html")
            ? "text/html"
            : "application/octet-stream",
    );
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator("#tree .file").first().waitFor();
  assert.equal(
    await page.locator(".cm-content").getAttribute("contenteditable"),
    "false",
    "no note selected: editor must not accept unsavable text",
  );
  assert.equal(await page.locator("#vault-name").count(), 0);
  assert.deepEqual(
    await page
      .locator(".vault-bar > button")
      .evaluateAll((buttons) =>
        buttons.map((b) => b.getAttribute("aria-label")),
      ),
    ["儲存庫內操作", "儲存庫管理"],
  );
  await page.locator("#vault-actions").click();
  assert.deepEqual(
    await page.locator("#vault-actions-menu button").allTextContents(),
    ["新增筆記…", "新增資料夾…", "重新整理"],
  );
  assert.equal(await page.locator("#vault-actions-menu").isVisible(), true);
  await page.locator("#settings").click();
  assert.equal(await page.locator("#vault-actions-menu").isVisible(), false);
  assert.equal(await page.locator("#vault-menu").isVisible(), true);
  await page.locator("#vault-actions").click();
  assert.equal(await page.locator("#vault-menu").isVisible(), false);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#vault-actions-menu").isVisible(), false);
  assert.equal(
    await page.locator("#vault-actions").getAttribute("aria-expanded"),
    "false",
  );
  for (const id of ["new", "folder", "refresh"]) {
    await page.locator("#vault-actions").click();
    await page.locator("#" + id).click();
    await page.waitForFunction(
      () => document.querySelector("#vault-actions-menu").hidden,
    );
  }
  await page.waitForFunction(
    () =>
      window.requests.some((m) => m.type === "create" && !m.directory) &&
      window.requests.some((m) => m.type === "create" && m.directory),
  );
  await page.locator("#vault-actions").click();
  await page.locator("#filename").click();
  assert.equal(await page.locator("#vault-actions-menu").isVisible(), false);
  await page.locator("#bookmarks").click();
  await page.locator("#aux").waitFor({ state: "visible" });
  await page.locator("#bookmarks").click();
  assert.equal(
    await page.locator("#aux").isVisible(),
    false,
    "bookmark panel should toggle closed",
  );
  await page.locator("#tags").click();
  await page.locator("#aux").waitFor({ state: "visible" });
  await page.locator("#aux-close").click();
  assert.equal(await page.locator("#aux").isVisible(), false);
  await page.locator("#tags").click();
  await page.locator("#aux").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#aux").isVisible(), false);
  assert.equal(await page.locator("header #save").count(), 0);
  await page.locator("#more").click();
  assert.equal(await page.locator("#menu #save").innerText(), "手動保存");
  await page.locator("#trash").click();
  await page.waitForFunction(() =>
    window.requests.some((m) => m.type === "trash"),
  );
  assert.equal(await page.locator("#recovery").count(), 0);
  await page.locator("#settings").click();
  assert.equal(await page.locator("#graph").count(), 0);
  await page.locator("#vault-menu #reveal").click();
  await page.waitForFunction(() =>
    window.requests.some((m) => m.type === "reveal"),
  );
  assert.equal(await page.locator("#reveal").isVisible(), false);
  await page.locator("#settings").click();
  await page.locator("#initialize-vault").click();
  await page.waitForFunction(() =>
    window.requests.some(
      (m) =>
        m.type === "choose" && m.initialize === true && m.source === "shared",
    ),
  );
  await page.locator("#tree .file", { hasText: "Welcome.md" }).click();
  await page.locator("#mode").selectOption("read");
  await page.locator("#preview h1").waitFor();
  assert.equal(await page.locator("#preview h1").innerText(), "Welcome");
  assert.equal(await page.locator("#preview script").count(), 0);
  // Reading mode must expose the edit immediately rather than silently change hidden source.
  await page.locator('[data-wrap="**"]').click();
  assert.equal(
    await page.locator("#editor").isVisible(),
    true,
    "formatting must reveal the editor",
  );
  await page.locator("#mode").selectOption("source");
  // Select text with the keyboard, click each icon, and verify stored Markdown plus undo/toggle.
  for (const [label, marker] of [
    ["粗體", "**"],
    ["斜體", "*"],
    ["標示", "=="],
    ["連結", "[["],
  ]) {
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("Selected");
    await page.keyboard.press("Meta+a");
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction(
      (expected) => window.fixture.shared["Welcome.md"].text === expected,
      marker + "Selected" + (marker === "[[" ? "]]" : marker),
    );
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction(
      () => window.fixture.shared["Welcome.md"].text === "Selected",
    );
  }
  // Exercise shortcuts and the messages sent by VSCode's native context menu.
  for (const [format, shortcut, start, end] of [
    ["bold", "Meta+b", "**", "**"],
    ["italic", "Meta+i", "*", "*"],
    ["highlight", "Meta+Shift+h", "==", "=="],
    ["link", "Meta+k", "[[", "]]"],
  ]) {
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type("before Selected after");
    await page.keyboard.press("Home");
    for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
    for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press(shortcut);
    await page.waitForFunction(
      (expected) => window.fixture.shared["Welcome.md"].text === expected,
      "before " + start + "Selected" + end + " after",
    );
    assert.equal(
      JSON.parse(
        await page.locator("#editor").getAttribute("data-vscode-context"),
      ).webviewSection,
      "markdownEditor",
    );
    await page.evaluate(
      (format) =>
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { event: "format", format },
          }),
        ),
      format,
    );
    await page.waitForFunction(
      () =>
        window.fixture.shared["Welcome.md"].text === "before Selected after",
    );
    await page.keyboard.press("Meta+z");
    await page.waitForFunction(
      (expected) => window.fixture.shared["Welcome.md"].text === expected,
      "before " + start + "Selected" + end + " after",
    );
  }
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("# Welcome\n\n[[Second]]");
  await page.locator("#status").filter({ hasText: "已儲存" }).waitFor();

  await page.locator("#mode").selectOption("read");

  await page.locator('#preview [data-note="Second"]').click();
  await page.waitForFunction(
    () => document.querySelector("#filename").textContent === "Second.md",
  );
  assert.equal(await page.locator("#filename").innerText(), "Second.md");
  await page.locator("#mode").selectOption("source");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(" edited");
  await page.locator("#status").filter({ hasText: "已儲存" }).waitFor();
  assert.match(
    await page.evaluate(() => window.fixture.shared["Second.md"].text),
    /edited/,
  );
  await page.locator(".cm-content").click();
  await page.keyboard.type(" manual");
  await page.locator("#more").click();
  await page.locator("#menu #save").click();
  await page.waitForFunction(() =>
    window.fixture.shared["Second.md"].text.includes("manual"),
  );
  assert.equal(await page.locator("#menu").isVisible(), false);
  await page.locator("#source").selectOption("private");
  await page.locator("#tree .file", { hasText: "Private.md" }).waitFor();
  assert.equal(
    await page.locator(".cm-content").getAttribute("contenteditable"),
    "false",
  );
  assert.equal(await page.locator('[data-wrap="**"]').isDisabled(), true);
  assert.equal(await page.locator("#filename").innerText(), "選擇筆記");
  assert.equal(
    await page.locator("#tree .file", { hasText: "Welcome.md" }).count(),
    0,
  );
  await page.locator("#source").selectOption("shared");
  await page.locator("#tree .file", { hasText: "Welcome.md" }).click();
  await page.locator("#mode").selectOption("source");
  await page.evaluate(() => {
    window.fixture.shared["Welcome.md"].text = "external edit";
    window.fixture.shared["Welcome.md"].revision = "external";
  });
  await page.locator(".cm-content").click();
  await page.keyboard.type("local ");
  await page.locator("#conflict").waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(() => window.fixture.shared["Welcome.md"].text),
    "external edit",
  );
  await page.locator("#reload").click();
  await page.waitForFunction(() =>
    document.querySelector(".cm-content").textContent.includes("external edit"),
  );
  await page.locator("#tree .file", { hasText: "Welcome.md" }).click();
  await page.locator("#mode").selectOption("split");
  await page.locator("#tree .file", { hasText: "Rich.md" }).click();
  await page.locator("#mode").selectOption("read");
  await page.locator("#preview .katex").waitFor();
  await page.locator("#preview .mermaid svg").waitFor();
  assert.match(await page.locator("#preview").innerText(), /☑/);
  assert.match(await page.locator("#preview .mermaid svg").textContent(), /A/);
  assert.match(await page.locator("#preview .mermaid svg").textContent(), /B/);
  await page.locator("#tree .file", { hasText: "Board.canvas" }).click();
  await page.locator("#preview .canvas-node").waitFor();
  assert.equal(
    JSON.parse(
      await page.locator("#editor").getAttribute("data-vscode-context"),
    ).webviewSection,
    "other",
  );
  assert.equal(await page.locator('[data-wrap="**"]').isDisabled(), true);
  assert.match(
    await page.locator("#preview .canvas-node").innerText(),
    /Canvas card/,
  );
  await page.locator("#tree .file", { hasText: "Data.base" }).click();
  await page.waitForFunction(() =>
    document.querySelector("#preview").textContent.includes("Notes"),
  );
  await page.locator("#tree .file", { hasText: "CRLF.md" }).click();
  await page.locator("#mode").selectOption("source");
  await page.locator(".cm-content").click();
  await page.keyboard.type("edited ");
  await page.locator("#status").filter({ hasText: "已儲存" }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.fixture.shared["CRLF.md"].text))
      .replace(/\r\n/g, "")
      .includes("\n"),
    false,
  );
  await page.locator("#tree .file", { hasText: "Rich.md" }).click();
  await page.locator("#mode").selectOption("split");
  await page.locator("#preview .mermaid svg").waitFor();
  await page.evaluate(() => {
    window.nextVault = {
      id: "third",
      name: "第三個儲存庫",
      root: "/test/third",
    };
  });
  await page.locator("#settings").click();
  await page.locator("#choose").click();
  await page.waitForFunction(
    () => document.querySelector("#source").value === "third",
  );
  assert.equal(await page.locator("#source option").count(), 3);
  assert.equal(
    await page.locator(".cm-content").getAttribute("contenteditable"),
    "false",
  );
  await page.locator("#settings").click();
  await page.locator("#remove-vault").click();
  await page.waitForFunction(
    () => document.querySelector("#source option[value=third]") === null,
  );
  assert.equal(
    await page.evaluate(() => Object.hasOwn(window.fixture, "third")),
    true,
  );
  // A reference change made by another window is reflected without switching an existing selection.
  const selectedVault = await page.locator("#source").inputValue();
  await page.evaluate(() =>
    window.vaults.push({
      id: "remote",
      name: "另一視窗",
      root: "/test/remote",
    }),
  );
  await page
    .locator("#source option[value=remote]")
    .waitFor({ state: "attached" });
  assert.equal(await page.locator("#source").inputValue(), selectedVault);
  await page.evaluate(() => {
    window.vaults = [];
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#source").value === "" &&
      document.querySelector("#new").disabled,
  );
  assert.equal(await page.locator("#new").isDisabled(), true);
  assert.equal(await page.locator("#vault-actions").isDisabled(), true);
  assert.equal(await page.locator("#settings").isEnabled(), true);
  assert.equal(await page.locator("#source").isDisabled(), true);
  assert.equal(
    await page.locator(".cm-content").getAttribute("contenteditable"),
    "false",
  );
  await page.evaluate(() => {
    window.nextVault = { id: "shared", name: "工作筆記", root: "/test/shared" };
  });
  await page.locator("#settings").click();
  await page.locator("#choose").click();
  await page.locator("#tree .file", { hasText: "Rich.md" }).click();
  await page.locator("#mode").selectOption("split");
  await page.locator("#preview .mermaid svg").waitFor();
  await page.locator("#tree .file", { hasText: "Welcome.md" }).click();
  await page.locator("#mode").selectOption("source");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("preserved on removal");
  await page.locator("#settings").click();
  assert.equal(await page.locator("#remove-vault").isDisabled(), true);
  assert.equal(
    await page.locator("#remove-vault").getAttribute("title"),
    "至少需保留一個儲存庫",
  );
  assert.equal(await page.locator("#source option").count(), 1);
  await page.waitForFunction(
    () => window.fixture.shared["Welcome.md"].text === "preserved on removal",
  );
  await page.locator("#settings").click();
  await page.locator("#tree .file", { hasText: "Rich.md" }).click();
  await page.locator("#mode").selectOption("split");
  await page.locator("#preview .mermaid svg").waitFor();
  await mkdir(".test-results", { recursive: true });
  await page.screenshot({ path: ".test-results/panel.png" });
  await page.locator("#tree .file", { hasText: "Theme.md" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#filename").textContent === "Theme.md" &&
      document.querySelector(".cm-content").textContent.includes("Heading"),
  );
  await page.locator("#mode").selectOption("source");
  const themeText = await page.locator(".cm-content").innerText();
  async function setTheme(name, background, foreground) {
    await page.evaluate(
      ({ name, background, foreground }) => {
        document.body.className = name;
        document.body.style.setProperty(
          "--vscode-editor-background",
          background,
        );
        document.body.style.setProperty(
          "--vscode-editor-foreground",
          foreground,
        );
      },
      { name, background, foreground },
    );
    await page.waitForFunction(
      (dark) =>
        (getComputedStyle(document.querySelector(".cm-editor")).colorScheme ===
          "dark") ===
        dark,
      !name.includes("light"),
    );
  }
  async function syntaxColor(text) {
    return page
      .locator(".cm-content span")
      .filter({ hasText: new RegExp("^\\s*" + text + "\\s*$") })
      .first()
      .evaluate((el) => getComputedStyle(el).color);
  }
  function contrast(a, b) {
    const luminance = (rgb) =>
      rgb
        .match(/\d+/g)
        .slice(0, 3)
        .map(Number)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  await setTheme("vscode-dark", "#1e1e1e", "#d4d4d4");
  assert.equal(await syntaxColor("yaml"), "rgb(117, 190, 255)");
  for (const token of ["yaml", "inline", "Heading", "#", "link"])
    assert.ok(
      contrast(await syntaxColor(token), "rgb(30, 30, 30)") >= 4.5,
      token,
    );
  assert.equal(
    await page
      .locator(".cm-lineNumbers .cm-activeLineGutter")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(40, 40, 40)",
  );
  await page.screenshot({ path: ".test-results/theme-dark.png" });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type("theme edit");
  await setTheme("vscode-light", "#ffffff", "#333333");
  assert.equal(await syntaxColor("yaml"), "rgb(0, 106, 177)");
  for (const token of ["yaml", "inline", "Heading", "#", "link"])
    assert.ok(
      contrast(await syntaxColor(token), "rgb(255, 255, 255)") >= 4.5,
      token,
    );
  await page.keyboard.press("Meta+z");
  assert.equal(await page.locator(".cm-content").innerText(), themeText);
  await page.screenshot({ path: ".test-results/theme-light.png" });
  await page.locator("#tree .file", { hasText: "Rich.md" }).click();
  await setTheme("vscode-dark", "#1e1e1e", "#d4d4d4");
  await page.locator("#tree .file", { hasText: "Theme.md" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#filename").textContent === "Theme.md" &&
      document.querySelector(".cm-content").textContent.includes("Heading"),
  );
  assert.equal(
    await page
      .locator(".cm-editor")
      .evaluate((el) => getComputedStyle(el).colorScheme),
    "dark",
  );
  assert.equal(await page.locator(".cm-content").innerText(), themeText);

  // 惡意筆記：不可覆蓋 UI id、不可注入樣式、data-note 不可觸發外部開啟。
  const externals = () =>
    page.evaluate(() =>
      window.requests.filter((m) => m.type === "external").map((m) => m.url),
    );
  await page.locator("#tree .file", { hasText: "Attack.md" }).click();
  await page.locator("#mode").selectOption("read");
  await page.locator("#preview h2").waitFor();
  await page.locator("#preview .katex").waitFor();
  for (const id of ["status", "menu", "count", "aux", "aux-content"])
    assert.equal(await page.locator(`[id="${id}"]`).count(), 1, id);
  assert.equal(
    await page.evaluate(() => document.getElementById("status").tagName),
    "SPAN",
  );
  assert.equal(
    await page.locator("#user-content-status").innerText(),
    "status",
  );
  assert.equal(await page.locator("#preview style").count(), 0);
  assert.equal(
    await page.locator("#preview .overlay").getAttribute("style"),
    null,
  );
  assert.equal(await page.locator("#preview [name=count]").count(), 0);
  assert.equal(
    await page.locator("#preview .callout").getAttribute("data-callout"),
    "note",
  );
  const before = (await externals()).length;
  await page.locator("#preview .evil-note").click();
  await page
    .locator("#status")
    .filter({ hasText: "obsidian://evil" })
    .waitFor();
  await page.locator("#preview .evil-link").click();
  await page
    .locator("#status")
    .filter({ hasText: "https://evil.example" })
    .waitFor();
  assert.equal((await externals()).length, before);
  // 正常外部連結（Markdown、wikilink 網址、obsidian:）仍送到 host。
  await page.locator("#preview a", { hasText: /^ext$/ }).click();
  await page.locator("#preview a", { hasText: "wiki ext" }).click();
  await page.locator("#preview a", { hasText: /^ob$/ }).click();
  await page.waitForFunction(
    (n) =>
      window.requests.filter((m) => m.type === "external").length === n + 3,
    before,
  );
  assert.deepEqual((await externals()).slice(before), [
    "https://example.com/a",
    "https://example.com/wiki",
    "obsidian://open?vault=v",
  ]);
  // 標題錨點：Markdown #連結與 [[#標題]] 都能跳到加上前綴的 id。
  const sectionVisible = () =>
    page.evaluate(() => {
      const box = document.querySelector("#preview").getBoundingClientRect(),
        heading = document
          .querySelector("#user-content-Section")
          .getBoundingClientRect();
      return heading.top >= box.top - 1 && heading.top < box.bottom;
    });
  const resetScroll = () =>
    page.evaluate(() => {
      for (
        let el = document.querySelector("#preview");
        el;
        el = el.parentElement
      )
        el.scrollTop = 0;
    });
  await resetScroll();
  assert.equal(await sectionVisible(), false);
  await page.locator("#preview a", { hasText: /^jump$/ }).click();
  await page.waitForFunction(() => {
    const box = document.querySelector("#preview").getBoundingClientRect();
    return (
      document.querySelector("#user-content-Section").getBoundingClientRect()
        .top < box.bottom
    );
  });
  await resetScroll();
  assert.equal(await sectionVisible(), false);
  await page.locator("#preview a", { hasText: "wiki jump" }).click();
  await page.waitForFunction(() => {
    const box = document.querySelector("#preview").getBoundingClientRect();
    return (
      document.querySelector("#user-content-Section").getBoundingClientRect()
        .top < box.bottom
    );
  });
  assert.equal(await page.locator("#preview #user-content-fn1").count(), 1);
  // 大綱按鈕仍可跳轉。
  await page.locator("#outline").click();
  await page.locator("#aux-content button", { hasText: "Section" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".cm-activeLine")?.textContent.includes("Section"),
  );
  await page.locator("#aux-close").click();
  // wikilink 內部跳轉維持原行為。
  await page.locator("#mode").selectOption("read");
  await page.locator('#preview [data-note="Second"]').click();
  await page.waitForFunction(
    () => document.querySelector("#filename").textContent === "Second.md",
  );

  // 惡意 canvas：卡片套用同一份清理設定，檔案節點只做內部連結。
  await page.locator("#tree .file", { hasText: "Evil.canvas" }).click();
  await page.locator("#preview .canvas-node .katex").waitFor();
  assert.equal(await page.locator("#preview style").count(), 0);
  assert.equal(
    await page.locator("#preview .cover").getAttribute("style"),
    null,
  );
  assert.equal(await page.locator('[id="status"]').count(), 1);
  assert.equal(
    await page.locator("#preview .canvas-node #user-content-status").count(),
    1,
  );
  const canvasBefore = (await externals()).length;
  await page
    .locator("#preview .canvas-node", { hasText: "obsidian://evil" })
    .click();
  await page.waitForFunction(() =>
    window.requests.some(
      (m) => m.type === "link" && m.target === "obsidian://evil",
    ),
  );
  assert.equal((await externals()).length, canvasBefore);
  assert.deepEqual(errors, []);
  console.log(
    "UI passed: rendering, wiki navigation, autosave, vault isolation, conflict, disk reload, sanitized notes and canvas.",
  );
} finally {
  await browser.close();
  server.close();
}

import {
  EditorView,
  keymap,
  Decoration,
  ViewPlugin,
  placeholder,
} from "@codemirror/view";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { basicSetup } from "codemirror";
import { autocompletion } from "@codemirror/autocomplete";
import {
  syntaxTree,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import katex from "katex";
import { parse as parseYaml } from "yaml";
import { renderer, renderMarkdown } from "./render";
import type { VaultReference } from "./registry";
import type { Entry } from "./vault";
import "katex/dist/katex.min.css";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): any;
  setState(state: unknown): void;
};
const api = acquireVsCodeApi(),
  md = renderer();
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
let source: string = api.getState()?.source || "",
  root = "",
  entries: Entry[] = [],
  files: string[] = [],
  current = "",
  base = "",
  dirty = false,
  loading = false,
  mode = api.getState()?.mode || "live",
  saveTimer: ReturnType<typeof setTimeout> | undefined,
  savePromise: Promise<boolean> | undefined;
let editor: EditorView,
  treeVersion = "",
  renderVersion = 0;
const states = new Map<string, EditorState>();
const tabs: string[] = [];
const modeConfig = new Compartment();
const $ = (id: string) => document.getElementById(id)!;
function rpc(type: string, data: Record<string, unknown> = {}): Promise<any> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    api.postMessage({ id, type, source, root, ...data });
  });
}
function status(text: string, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
window.addEventListener("message", (event) => {
  const m = event.data;
  if (m.event === "format") {
    const marker = { bold: "**", italic: "*", highlight: "==", link: "[[" }[
      m.format as string
    ];
    if (marker) wrap(marker, marker === "[[" ? "]]" : marker);
    return;
  }
  if (m.event === "configured") {
    void initialize();
    return;
  }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.error) p.reject(new Error(m.error));
  else p.resolve(m.result);
});
function flatten(list: Entry[]): string[] {
  return list.flatMap((e) =>
    e.directory ? flatten(e.children || []) : [e.path],
  );
}
function remember() {
  api.setState({ source, root, mode, current, tabs: [...tabs] });
}
function action(fn: () => Promise<unknown> | unknown) {
  return () => {
    Promise.resolve()
      .then(fn)
      .catch((e) => status(e.message, true));
  };
}
$("app").innerHTML =
  `<aside id="sidebar"><div class="vault-bar"><select id="source" title="選擇儲存庫" aria-label="選擇儲存庫"></select><button id="vault-actions" title="儲存庫內操作" aria-label="儲存庫內操作" aria-expanded="false" aria-controls="vault-actions-menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 3h9v12H3zM9 15h6M12 12v6"/></svg></button><button id="settings" title="儲存庫管理" aria-label="儲存庫管理" aria-expanded="false" aria-controls="vault-menu">⚙</button></div><div id="vault-actions-menu" hidden><button id="new">新增筆記…</button><button id="folder">新增資料夾…</button><button id="refresh">重新整理</button></div><div id="vault-menu" hidden><button id="choose">加入既有儲存庫…</button><button id="initialize-vault">新增儲存庫…</button><button id="remove-vault">移除目前儲存庫引用</button><button id="reveal">在 Finder 開啟儲存庫</button></div><input id="search" aria-label="搜尋 vault" placeholder="搜尋筆記內容…"><div class="tools"><button id="daily">每日</button><button id="tags">標籤</button><button id="bookmarks">書籤</button></div><div id="tree" role="tree" aria-label="檔案"></div></aside><div id="divider" role="separator" tabindex="0" aria-label="調整檔案欄寬度"></div><main><nav id="tabs"></nav><header><span id="filename">選擇筆記</span><select id="mode" aria-label="編輯模式"><option value="live">Live Preview</option><option value="source">原始碼</option><option value="split">編輯＋預覽</option><option value="read">閱讀</option></select><button id="more">⋯</button></header><div id="toolbar"><button data-wrap="**" title="粗體" aria-label="粗體"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h7a4 4 0 0 1 0 8H6zm0 8h8a4 4 0 0 1 0 8H6z"/></svg></button><button data-wrap="*" title="斜體" aria-label="斜體"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4h8M5 20h8M15 4 9 20"/></svg></button><button data-wrap="==" title="標示" aria-label="標示"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m13 3 8 8-9 9H4v-8zM3 22h18M9 7l8 8"/></svg></button><button data-wrap="[[" data-end="]]" title="連結" aria-label="連結"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1"/></svg></button><button id="template" title="範本" aria-label="範本"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6"/></svg></button><button id="attachment" title="附件" aria-label="附件"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2m-7 13 8-8"/></svg></button><button id="outline" title="大綱／連結" aria-label="大綱／連結"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/></svg></button><button id="bookmark" title="書籤" aria-label="書籤"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg></button></div><div id="conflict" hidden>磁碟版本已變更，草稿已保留。<button id="compare">比較</button><button id="reload">採用磁碟</button><button id="copy">另存草稿</button></div><div id="body"><div id="editor"></div><article id="preview"></article></div><section id="aux" hidden aria-label="筆記資訊"><div id="aux-header"><span id="aux-title"></span><button id="aux-close" title="關閉資訊區塊" aria-label="關閉資訊區塊">×</button></div><div id="aux-content"></div></section><footer><span id="status">開啟儲存庫中…</span><span id="count"></span></footer><div id="menu" hidden><button id="save">手動保存</button><button id="rename">重新命名</button><button id="delete">移至垃圾桶</button><button id="native">在 VSCode 編輯器開啟</button><button id="trash">開啟垃圾桶</button></div></main>`;

// 隱藏非游標行的行內語法，游標進入後回復原始文字，儲存內容不經 HTML 轉換。
const live = ViewPlugin.fromClass(
  class {
    decorations: any;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: any) {
      if (u.docChanged || u.selectionSet || u.viewportChanged)
        this.decorations = this.build(u.view);
    }
    build(view: EditorView) {
      const ranges: any[] = [];
      const selection = view.state.selection.main;
      syntaxTree(view.state).iterate({
        enter(node) {
          const line = view.state.doc.lineAt(node.from);
          if (line.from <= selection.to && line.to >= selection.from) return;
          if (
            [
              "EmphasisMark",
              "HeaderMark",
              "StrikethroughMark",
              "CodeMark",
            ].includes(node.name)
          )
            ranges.push(Decoration.replace({}).range(node.from, node.to));
          if (/^ATXHeading[1-6]$/.test(node.name))
            ranges.push(
              Decoration.line({
                class: `heading h${node.name.slice(-1)}`,
              }).range(line.from),
            );
          if (node.name === "StrongEmphasis")
            ranges.push(
              Decoration.mark({ class: "strong" }).range(node.from, node.to),
            );
          if (node.name === "Emphasis")
            ranges.push(
              Decoration.mark({ class: "em" }).range(node.from, node.to),
            );
        },
      });
      return Decoration.set(ranges, true);
    }
  },
  { decorations: (v) => v.decorations },
);
const themeConfig = new Compartment();
function editorTheme() {
  const light =
    document.body.classList.contains("vscode-light") ||
    document.body.classList.contains("vscode-high-contrast-light");
  return EditorView.theme(
    { "&": { colorScheme: light ? "light" : "dark" } },
    { dark: !light },
  );
}
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--note-heading)", fontWeight: "bold" },
  {
    tag: [tags.link, tags.url],
    color: "var(--note-link)",
    textDecoration: "underline",
  },
  { tag: tags.labelName, color: "var(--note-link)" },
  { tag: tags.monospace, color: "var(--note-code)" },
  {
    tag: [tags.processingInstruction, tags.comment, tags.meta],
    color: "var(--note-muted)",
  },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);
function extensions() {
  return [
    EditorState.readOnly.of(!current),
    EditorView.editable.of(!!current),
    placeholder(
      current ? "開始輸入…" : "請先在左欄選擇筆記，或按「新增筆記」。",
    ),
    basicSetup,
    themeConfig.of(editorTheme()),
    syntaxHighlighting(markdownHighlight),
    markdown(),
    EditorView.lineWrapping,
    modeConfig.of(mode === "live" ? [live] : []),
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (!event.metaKey && !event.ctrlKey) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const line = view.state.doc.lineAt(pos);
        for (const match of line.text.matchAll(/\[\[([^\]]+)\]\]/g)) {
          if (
            pos >= line.from + match.index! &&
            pos <= line.from + match.index! + match[0].length
          ) {
            void rpc("link", { target: match[1], path: current })
              .then((found) =>
                found
                  ? openFile(found.path, found.anchor)
                  : status("找不到筆記", true),
              )
              .catch((e) => status(e.message, true));
            return true;
          }
        }
        return false;
      },
    }),
    autocompletion({
      override: [
        (context) => {
          const word = context.matchBefore(/\[\[[^\]\n]*/);
          if (!word) return null;
          return {
            from: word.from + 2,
            options: files
              .filter((p) => p.endsWith(".md"))
              .map((p) => ({
                label: p.slice(0, -3),
                apply: p.slice(0, -3) + "]]",
                type: "text",
              })),
          };
        },
      ],
    }),
    Prec.high(
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            void save();
            return true;
          },
        },
        {
          key: "Mod-e",
          run: () => {
            setMode(mode === "read" ? "live" : "read");
            return true;
          },
        },
        {
          key: "Mod-b",
          run: () => {
            wrap("**");
            return true;
          },
        },
        {
          key: "Mod-i",
          run: () => {
            wrap("*");
            return true;
          },
        },
        {
          key: "Mod-Shift-h",
          run: () => {
            wrap("==");
            return true;
          },
        },
        {
          key: "Mod-k",
          run: () => {
            wrap("[[", "]]");
            return true;
          },
        },
      ]),
    ),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || loading || !current) return;
      dirty = true;
      states.set(current, editor.state);
      remember();
      status("草稿儲存中…");
      clearTimeout(saveTimer);
      void rpc("draft", {
        path: current,
        text: editor.state.sliceDoc(),
        revision: base,
      }).catch((e) => status(e.message, true));
      saveTimer = setTimeout(() => void save(), 650);
      updateCount();
      if (mode === "split") void preview();
    }),
  ];
}
function newState(text: string) {
  return EditorState.create({
    doc: text,
    extensions: [
      ...extensions(),
      EditorState.lineSeparator.of(text.includes("\r\n") ? "\r\n" : "\n"),
    ],
  });
}
editor = new EditorView({ state: newState(""), parent: $("editor") });
new MutationObserver(() => {
  const effect = themeConfig.reconfigure(editorTheme());
  editor.dispatch({ effects: effect });
  // 快取頁籤也要同步主題，避免切回舊筆記時恢復亮色行號。
  for (const [file, state] of states)
    states.set(file, state.update({ effects: effect }).state);
}).observe(document.body, { attributes: true, attributeFilter: ["class"] });
function updateCount() {
  const text = editor.state.sliceDoc();
  $("count").textContent =
    `${text.length} 字元 · ${text.trim() ? text.trim().split(/\s+/).length : 0} 詞`;
}
function wrap(start: string, end = start) {
  if (!current || opening || !/\.md$/i.test(current)) return;
  if (mode === "read") setMode("live");
  const selection = editor.state.selection.main;
  const selected = editor.state.sliceDoc(selection.from, selection.to);
  const surrounded =
    selection.from >= start.length &&
    editor.state.sliceDoc(selection.from - start.length, selection.from) ===
      start &&
    editor.state.sliceDoc(selection.to, selection.to + end.length) === end;
  const label =
    selected ||
    { "**": "粗體文字", "*": "斜體文字", "==": "標示文字", "[[": "筆記名稱" }[
      start
    ] ||
    "文字";
  const from = surrounded ? selection.from - start.length : selection.from;
  editor.dispatch({
    changes: {
      from,
      to: surrounded ? selection.to + end.length : selection.to,
      insert: surrounded ? selected : start + label + end,
    },
    selection: {
      anchor: surrounded ? from : from + start.length,
      head:
        (surrounded ? from : from + start.length) +
        (surrounded ? selected.length : label.length),
    },
    userEvent: "input.format",
  });
  editor.focus();
}
function setMode(value: string) {
  $("editor").setAttribute(
    "data-vscode-context",
    JSON.stringify({
      webviewSection:
        current && /\.md$/i.test(current) ? "markdownEditor" : "other",
    }),
  );
  mode =
    current && !/\.(md|canvas|base|txt|json|csv)$/i.test(current)
      ? "read"
      : value;
  ($("mode") as HTMLSelectElement).value = mode;
  editor.dispatch({
    effects: modeConfig.reconfigure(mode === "live" ? [live] : []),
  });
  $("body").className = "mode-" + mode;
  $("toolbar").hidden =
    !!current && !/\.(md|canvas|base|txt|json|csv)$/i.test(current);
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "#toolbar [data-wrap],#template,#attachment",
  ))
    button.disabled = !/\.md$/i.test(current);
  remember();
  if (mode === "read" || mode === "split") void preview();
}
function renderTabs() {
  if (!current) {
    $("filename").textContent = "選擇筆記";
    $("count").textContent = "";
    setMode(mode);
  }
  const nav = $("tabs");
  nav.replaceChildren();
  for (const p of tabs) {
    const button = document.createElement("button");
    button.textContent = p.split("/").pop()!;
    button.title = p;
    button.classList.toggle("active", p === current);
    button.onclick = action(() => openFile(p));
    const close = document.createElement("span");
    close.textContent = " ×";
    close.onclick = (e) => {
      e.stopPropagation();
      void (async () => {
        if (current === p && !(await save())) return;
        tabs.splice(tabs.indexOf(p), 1);
        states.delete(p);
        if (current === p) {
          current = "";
          if (tabs.length) await openFile(tabs[tabs.length - 1]);
          else {
            loading = true;
            editor.setState(newState(""));
            loading = false;
            $("filename").textContent = "選擇筆記";
            $("preview").replaceChildren();
          }
        }
        renderTabs();
        remember();
      })();
    };
    button.append(close);
    nav.append(button);
  }
}
function renderTree(list = entries) {
  const tree = $("tree");
  const expanded = new Set(
    [...tree.querySelectorAll("details[open]")].map(
      (e) => (e as HTMLElement).dataset.path,
    ),
  );
  tree.replaceChildren();
  function add(list: Entry[], parent: HTMLElement) {
    for (const entry of list) {
      if (entry.directory) {
        const el = document.createElement("details");
        el.dataset.path = entry.path;
        el.open = expanded.has(entry.path);
        const summary = document.createElement("summary");
        summary.textContent = entry.name;
        summary.title = entry.path;
        el.append(summary);
        add(entry.children || [], el);
        parent.append(el);
      } else {
        const button = document.createElement("button");
        button.className = "file";
        button.setAttribute("role", "treeitem");
        button.textContent = entry.name;
        button.title = entry.path;
        button.classList.toggle("selected", entry.path === current);
        button.onclick = action(() => openFile(entry.path));
        parent.append(button);
      }
    }
  }
  add(list, tree);
}
async function refresh() {
  entries = await rpc("tree");
  files = flatten(entries);
  treeVersion = JSON.stringify(entries);
  renderTree();
}
let vaultVersion = "";
let initializing = false;
function resetVault() {
  closeAux();
  clearTimeout(saveTimer);
  root = "";
  current = "";
  base = "";
  tabs.length = 0;
  states.clear();
  loading = true;
  editor.setState(newState(""));
  loading = false;
  $("preview").replaceChildren();
  $("conflict").hidden = true;
  ($("search") as HTMLInputElement).value = "";
  searchSerial++;
  renderVersion++;
  renderTabs();
}
async function initialize(preferred = source) {
  if (initializing) return;
  initializing = true;
  $("editor").inert = true;
  $("sidebar").inert = true;
  const select = $("source") as HTMLSelectElement;
  select.disabled = true;
  try {
    if (dirty && !(await save())) return;
    const refs: VaultReference[] = await rpc("vaults");
    const selected =
      refs.find((r) => r.id === preferred || r.legacyId === preferred) ||
      refs[0];
    const previous = api.getState();
    if (source !== selected?.id || root !== selected?.root) resetVault();
    source = selected?.id || "";
    select.replaceChildren();
    for (const ref of refs) {
      const option = document.createElement("option");
      option.value = ref.id;
      option.textContent = ref.name;
      option.title = ref.root;
      select.append(option);
    }
    if (!refs.length) select.add(new Option("尚無儲存庫", ""));
    select.value = source;
    select.title = selected?.root || "請透過齒輪加入或新增儲存庫";
    ($("remove-vault") as HTMLButtonElement).disabled =
      !selected || refs.length <= 1;
    $("remove-vault").title = refs.length === 1 ? "至少需保留一個儲存庫" : "";
    entries = [];
    files = [];
    renderTree();
    const result = await rpc("init");
    root = result.root;
    entries = result.tree;
    files = flatten(entries);
    treeVersion = JSON.stringify(entries);
    vaultVersion = JSON.stringify(refs);
    renderTree();
    if (
      !current &&
      previous?.current &&
      (previous.root === root || previous.source === selected?.legacyId) &&
      files.includes(previous.current)
    )
      await openFile(previous.current);
    remember();
    status(root ? "就緒" : "請透過齒輪加入或新增儲存庫。");
  } finally {
    select.value = source;
    select.disabled = select.options.length === 1 && !source;
    for (const id of [
      "vault-actions",
      "new",
      "folder",
      "daily",
      "refresh",
      "reveal",
      "search",
      "tags",
      "bookmarks",
    ])
      ($(id) as HTMLButtonElement | HTMLInputElement).disabled = !root;
    initializing = false;
    $("editor").inert = false;
    $("sidebar").inert = false;
  }
}
async function save(): Promise<boolean> {
  if (savePromise) return savePromise.then(() => (dirty ? save() : true));
  if (!dirty || !current) return true;
  const name = current,
    text = editor.state.sliceDoc();
  savePromise = (async () => {
    try {
      const result = await rpc("save", { path: name, text, revision: base });
      base = result.revision;
      dirty = editor.state.sliceDoc() !== text;
      $("conflict").hidden = true;
      status(dirty ? "仍有未儲存變更" : "已儲存");
      return !dirty;
    } catch (e) {
      $("conflict").hidden = false;
      status((e as Error).message, true);
      return false;
    } finally {
      savePromise = undefined;
    }
  })();
  return savePromise;
}
let opening = false;
async function openFile(file: string, anchor?: string) {
  if (opening) return;
  opening = true;
  $("editor").inert = true;
  $("sidebar").inert = true;
  try {
    await loadFile(file, anchor);
  } finally {
    opening = false;
    $("editor").inert = false;
    $("sidebar").inert = false;
  }
}
async function loadFile(file: string, anchor?: string) {
  if (!(await save())) return;
  if (current) states.set(current, editor.state);
  if (!/\.(md|canvas|base|txt|json|csv)$/i.test(file)) {
    current = file;
    dirty = false;
    $("filename").textContent = file;
    if (!tabs.includes(file)) tabs.push(file);
    renderTabs();
    setMode("read");
    await showAttachment(file);
    return;
  }
  const data = await rpc("read", { path: file });
  current = file;
  base = data.revision;
  dirty = false;
  loading = true;
  const cached = states.get(file);
  editor.setState(
    cached && cached.sliceDoc() === data.text
      ? cached
      : newState(data.draft?.text ?? data.text),
  );
  editor.dispatch({
    effects: modeConfig.reconfigure(mode === "live" ? [live] : []),
  });
  loading = false;
  if (data.draft && data.draft.text !== data.text) {
    dirty = true;
    base = data.draft.revision;
    $("conflict").hidden = false;
    status("已還原未儲存草稿；請先比較磁碟版本。", true);
  } else {
    $("conflict").hidden = true;
    status("已載入");
  }
  $("filename").textContent = file;
  if (!tabs.includes(file)) tabs.push(file);
  renderTabs();
  renderTree();
  remember();
  updateCount();
  setMode(mode);
  if (anchor) {
    const lines = editor.state.sliceDoc().split("\n");
    const i = lines.findIndex((l) =>
      anchor.startsWith("^")
        ? l.includes(anchor)
        : l.replace(/^#+\s*/, "").trim() === anchor,
    );
    if (i >= 0) {
      const pos = editor.state.doc.line(i + 1).from;
      editor.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos),
      });
    }
    await preview();
    document.getElementById(anchor)?.scrollIntoView();
  }
}
async function showAttachment(file: string) {
  const uri = await rpc("resource", { path: file });
  const ext = file.split(".").pop()!.toLowerCase();
  const article = $("preview");
  article.replaceChildren();
  let element: HTMLElement;
  if (
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(ext)
  ) {
    const image = document.createElement("img");
    image.src = uri;
    image.alt = file;
    element = image;
  } else if (["mp3", "wav", "ogg", "m4a", "mp4", "webm", "mov"].includes(ext)) {
    const media = document.createElement(
      ["mp4", "webm", "mov"].includes(ext) ? "video" : "audio",
    );
    media.src = uri;
    media.controls = true;
    element = media;
  } else {
    const button = document.createElement("button");
    button.textContent = "以 VSCode 開啟附件";
    button.onclick = action(() => rpc("native", { path: file }));
    element = button;
  }
  article.append(element);
}
async function preview() {
  if (!current) return;
  if (!/\.(md|canvas|base|txt|json|csv)$/i.test(current)) {
    await showAttachment(current);
    return;
  }
  const version = ++renderVersion,
    article = $("preview"),
    text = editor.state.sliceDoc();
  if (current.endsWith(".canvas")) {
    renderCanvas(text, article);
    return;
  }
  if (current.endsWith(".base")) {
    renderBase(text, article);
    return;
  }
  const html = DOMPurify.sanitize(renderMarkdown(md, text), {
    ADD_ATTR: ["data-note", "data-embed", "target"],
    FORBID_TAGS: ["style", "iframe", "object", "form"],
    FORBID_ATTR: ["style"],
  });
  article.innerHTML = html;
  // 清除原文的 inline style 後，僅重建由 KaTeX 產生的排版樣式。
  for (const math of article.querySelectorAll(".katex")) {
    const formula = math.querySelector(
      'annotation[encoding="application/x-tex"]',
    )?.textContent;
    if (formula)
      math.outerHTML = katex.renderToString(formula, {
        throwOnError: false,
        trust: false,
      });
  }
  for (const input of article.querySelectorAll("input")) {
    const marker = document.createElement("span");
    marker.textContent = (input as HTMLInputElement).checked ? "☑ " : "☐ ";
    input.replaceWith(marker);
  }
  for (const quote of article.querySelectorAll("blockquote")) {
    const p = quote.querySelector("p");
    if (!p) continue;
    const match = /^\[!([\w-]+)\]([+-])?\s*/.exec(p.textContent || "");
    if (match) {
      quote.classList.add("callout");
      quote.setAttribute("data-callout", match[1]);
      const label = document.createElement("strong");
      label.textContent = match[1].toUpperCase();
      quote.prepend(label);
      if (p.firstChild?.nodeType === Node.TEXT_NODE)
        p.firstChild.textContent = p.firstChild.textContent!.replace(
          match[0],
          "",
        );
    }
  }
  for (const el of article.querySelectorAll<HTMLElement>("[data-embed]")) {
    try {
      const target = el.dataset.embed!,
        found = await rpc("link", { target, path: current });
      if (version !== renderVersion) return;
      if (!found) {
        el.textContent = "找不到嵌入：" + target;
        continue;
      }
      if (found.path.endsWith(".md")) {
        const data = await rpc("read", { path: found.path });
        let body = data.text;
        if (found.anchor) {
          if (found.anchor.startsWith("^")) {
            body =
              body
                .split(/\r?\n/)
                .find((l: string) => l.includes(found.anchor)) || "";
          } else {
            const lines = body.split(/\r?\n/),
              start = lines.findIndex(
                (l: string) => l.replace(/^#+\s*/, "") === found.anchor,
              );
            if (start >= 0) {
              let end = start + 1;
              while (end < lines.length && !/^#{1,6} /.test(lines[end])) end++;
              body = lines.slice(start, end).join("\n");
            } else body = "";
          }
        }
        el.innerHTML = DOMPurify.sanitize(renderMarkdown(md, body), {
          FORBID_TAGS: ["style", "iframe", "object"],
          FORBID_ATTR: ["style"],
        });
        el.classList.add("note-embed");
      } else {
        const uri = await rpc("resource", { path: found.path });
        if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(found.path)) {
          const img = document.createElement("img");
          img.src = uri;
          img.alt = target;
          el.replaceChildren(img);
        } else {
          el.textContent = found.path;
          el.dataset.note = found.path;
        }
      }
    } catch (e) {
      el.textContent = (e as Error).message;
    }
  }
  for (const img of article.querySelectorAll<HTMLImageElement>("img")) {
    const src = img.getAttribute("src") || "";
    if (!/^(https?:|data:|vscode-)/.test(src)) {
      try {
        const found = await rpc("link", { target: src, path: current });
        if (found) img.src = await rpc("resource", { path: found.path });
      } catch {
        img.removeAttribute("src");
      }
    }
  }
  if (version !== renderVersion) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme: document.body.classList.contains("vscode-light")
      ? "default"
      : "dark",
    suppressErrorRendering: true,
  });
  for (const diagram of article.querySelectorAll<HTMLElement>(".mermaid")) {
    try {
      const result = await mermaid.render(
        "diagram-" + version + "-" + Math.random().toString(36).slice(2),
        diagram.textContent || "",
      );
      if (version !== renderVersion) return;
      diagram.innerHTML = DOMPurify.sanitize(result.svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
    } catch {
      diagram.classList.add("error");
    }
  }
}
function renderCanvas(text: string, parent: HTMLElement) {
  parent.replaceChildren();
  try {
    const canvas = JSON.parse(text);
    const label = document.createElement("p");
    label.textContent = "Canvas 檢視 · 修改請切換原始碼（JSON）";
    parent.append(label);
    const stage = document.createElement("div");
    stage.className = "canvas";
    const nodes = canvas.nodes || [];
    const minX = Math.min(0, ...nodes.map((n: any) => n.x)),
      minY = Math.min(0, ...nodes.map((n: any) => n.y));
    const width = Math.max(800, ...nodes.map((n: any) => n.x + n.width - minX)),
      height = Math.max(450, ...nodes.map((n: any) => n.y + n.height - minY));
    stage.style.width = width + "px";
    stage.style.height = height + "px";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.style.position = "absolute";
    for (const e of canvas.edges || []) {
      const a = nodes.find((n: any) => n.id === e.fromNode),
        b = nodes.find((n: any) => n.id === e.toNode);
      if (!a || !b) continue;
      const line = document.createElementNS(svg.namespaceURI, "line");
      for (const [k, v] of Object.entries({
        x1: a.x + a.width / 2 - minX,
        y1: a.y + a.height / 2 - minY,
        x2: b.x + b.width / 2 - minX,
        y2: b.y + b.height / 2 - minY,
        stroke: "currentColor",
      }))
        line.setAttribute(k, String(v));
      svg.append(line);
    }
    stage.append(svg);
    for (const n of nodes) {
      const card = document.createElement("div");
      card.className = "canvas-node";
      Object.assign(card.style, {
        left: n.x - minX + "px",
        top: n.y - minY + "px",
        width: n.width + "px",
        height: n.height + "px",
      });
      if (n.type === "text")
        card.innerHTML = DOMPurify.sanitize(renderMarkdown(md, n.text || ""));
      else {
        card.textContent = n.file || n.url || n.label || n.type;
        if (n.file) {
          card.dataset.note = n.file;
          card.tabIndex = 0;
        }
      }
      stage.append(card);
    }
    parent.append(stage);
  } catch (e) {
    parent.textContent = "Canvas JSON 無法解析：" + (e as Error).message;
  }
}
function renderBase(text: string, parent: HTMLElement) {
  parent.replaceChildren();
  const message = document.createElement("p");
  message.textContent =
    "Bases 定義檢視 · 以 YAML 原始碼編輯；篩選、公式與資料庫檢視尚未執行。";
  parent.append(message);
  const pre = document.createElement("pre");
  try {
    pre.textContent = JSON.stringify(parseYaml(text), null, 2);
  } catch (e) {
    pre.textContent = (e as Error).message;
  }
  parent.append(pre);
}
$("preview").addEventListener("click", (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-note],a",
  );
  if (!el) return;
  event.preventDefault();
  void (async () => {
    const target = el.dataset.note || el.getAttribute("href") || "";
    if (/^(https?:|mailto:|obsidian:)/.test(target)) {
      await rpc("external", { url: target });
      return;
    }
    if (target.startsWith("#") && !el.dataset.note) {
      document
        .getElementById(decodeURIComponent(target.slice(1)))
        ?.scrollIntoView();
      return;
    }
    const found = await rpc("link", { target, path: current });
    if (found) await openFile(found.path, found.anchor);
    else status("找不到筆記：" + target, true);
  })().catch((e) => status(e.message, true));
});
$("mode").onchange = () => setMode(($("mode") as HTMLSelectElement).value);
$("save").onclick = action(async () => {
  $("menu").hidden = true;
  await save();
});
$("source").onchange = action(() =>
  initialize(($("source") as HTMLSelectElement).value),
);
function closeSettings() {
  $("vault-actions-menu").hidden = true;
  $("vault-actions").setAttribute("aria-expanded", "false");
  $("vault-menu").hidden = true;
  $("settings").setAttribute("aria-expanded", "false");
}
$("settings").onclick = () => {
  const open = $("vault-menu").hidden;
  closeSettings();
  $("vault-menu").hidden = !open;
  $("settings").setAttribute("aria-expanded", String(open));
};
$("vault-actions").onclick = () => {
  const open = $("vault-actions-menu").hidden;
  closeSettings();
  $("vault-actions-menu").hidden = !open;
  $("vault-actions").setAttribute("aria-expanded", String(open));
};
document.addEventListener("click", (event) => {
  if (
    !(event.target as HTMLElement).closest(
      "#vault-menu,#settings,#vault-actions-menu,#vault-actions",
    )
  )
    closeSettings();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSettings();
  }
});
$("initialize-vault").onclick = action(async () => {
  closeSettings();
  const added = await rpc("choose", { initialize: true });
  if (added) await initialize(added.id);
});
$("choose").onclick = action(async () => {
  closeSettings();
  const added = await rpc("choose");
  if (added) await initialize(added.id);
});
$("remove-vault").onclick = action(async () => {
  closeSettings();
  if (!source) return;
  $("editor").inert = true;
  try {
    if (!(await save())) return;
    await rpc("removeVault");
    await initialize();
  } finally {
    $("editor").inert = false;
  }
});
$("refresh").onclick = action(async () => {
  closeSettings();
  await refresh();
});
$("new").onclick = action(async () => {
  closeSettings();
  if (!(await save())) return;
  const data = await rpc("create");
  if (data) {
    await refresh();
    await openFile(data.path);
  }
});
$("folder").onclick = action(async () => {
  closeSettings();
  await rpc("create", { directory: true });
  await refresh();
});
$("daily").onclick = action(async () => {
  if (!(await save())) return;
  const data = await rpc("daily");
  await refresh();
  await openFile(data.path);
});
$("template").onclick = action(async () => {
  if (!current) return;
  if (mode === "read") setMode("live");
  const text = await rpc("template", { path: current });
  if (text) editor.dispatch(editor.state.replaceSelection(text));
});
$("attachment").onclick = action(async () => {
  if (!current) return;
  if (mode === "read") setMode("live");
  const result = await rpc("attachment", { path: current });
  if (result) {
    await refresh();
    editor.dispatch(editor.state.replaceSelection("![[" + result.path + "]]"));
  }
});
$("reveal").onclick = action(() => {
  closeSettings();
  return rpc("reveal");
});
$("native").onclick = action(async () => {
  if (current && (await save())) await rpc("native", { path: current });
});
$("trash").onclick = action(() => {
  $("menu").hidden = true;
  return rpc("trash");
});
$("more").onclick = () => {
  $("menu").hidden = !$("menu").hidden;
};
$("rename").onclick = action(async () => {
  if (!current || !(await save())) return;
  const data = await rpc("rename", { path: current });
  if (data) {
    tabs.splice(tabs.indexOf(current), 1);
    current = "";
    await refresh();
    await openFile(data.path);
  }
});
$("delete").onclick = action(async () => {
  if (!current || !(await save())) return;
  if (await rpc("delete", { path: current })) {
    tabs.splice(tabs.indexOf(current), 1);
    states.delete(current);
    current = "";
    loading = true;
    editor.setState(newState(""));
    loading = false;
    $("preview").replaceChildren();
    renderTabs();
    await refresh();
  }
});
$("reload").onclick = action(async () => {
  await rpc("discardDraft", { path: current });
  dirty = false;
  states.delete(current);
  await openFile(current);
});
$("copy").onclick = action(async () => {
  const result = await rpc("create", {
    suggested: current.replace(/\.md$/, "") + " conflict.md",
    text: editor.state.sliceDoc(),
  });
  if (result) {
    await rpc("discardDraft", { path: current });
    dirty = false;
    await refresh();
    await openFile(result.path);
  }
});
$("compare").onclick = action(async () => {
  const token = openAux("compare", "磁碟版本");
  const disk = await rpc("read", { path: current });
  if (token !== auxVersion) return;
  const pre = document.createElement("pre");
  pre.textContent = disk.text;
  $("aux-content").append(pre);
});
for (const button of document.querySelectorAll<HTMLElement>("[data-wrap]")) {
  const shortcut = { "**": "B", "*": "I", "==": "Shift+H", "[[": "K" }[
    button.dataset.wrap!
  ];
  button.title += `（Cmd/Ctrl+${shortcut}）`;
  button.onmousedown = (event) => event.preventDefault();
  button.onclick = () =>
    wrap(button.dataset.wrap!, button.dataset.end || button.dataset.wrap!);
}
let searchTimer: ReturnType<typeof setTimeout>;
let searchSerial = 0;
$("search").oninput = () => {
  clearTimeout(searchTimer);
  const serial = ++searchSerial;
  searchTimer = setTimeout(() => {
    void (async () => {
      const query = ($("search") as HTMLInputElement).value;
      if (!query) {
        renderTree();
        return;
      }
      const results = await rpc("search", { query });
      if (serial !== searchSerial) return;
      $("tree").replaceChildren();
      for (const r of results) {
        const b = document.createElement("button");
        b.className = "file";
        b.textContent = r.path + "\n" + r.snippet;
        b.onclick = action(() => openFile(r.path));
        $("tree").append(b);
      }
    })().catch((e) => status(e.message, true));
  }, 300);
};
let auxKind = "",
  auxVersion = 0;
function closeAux() {
  auxVersion++;
  auxKind = "";
  $("aux").hidden = true;
  $("aux-content").replaceChildren();
  for (const id of ["tags", "bookmarks", "outline"])
    $(id).setAttribute("aria-expanded", "false");
}
function openAux(kind: string, title: string) {
  auxKind = kind;
  auxVersion++;
  $("aux").hidden = false;
  $("aux-title").textContent = title;
  $("aux-content").replaceChildren();
  for (const id of ["tags", "bookmarks", "outline"])
    $(id).setAttribute("aria-expanded", String(id === kind));
  return auxVersion;
}
function toggleAux(kind: string, title: string) {
  if (auxKind === kind && !$("aux").hidden) {
    closeAux();
    return undefined;
  }
  return openAux(kind, title);
}
$("aux-close").onclick = closeAux;
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAux();
    $("menu").hidden = true;
  }
});
function showLinks(title: string, paths: string[]) {
  $("aux-title").textContent = title;
  $("aux-content").replaceChildren();
  for (const p of [...new Set(paths)]) {
    const b = document.createElement("button");
    b.textContent = p;
    b.onclick = action(() => openFile(p));
    $("aux-content").append(b);
  }
  if (!paths.length) $("aux-content").textContent = "目前沒有項目";
}
$("outline").onclick = action(async () => {
  const token = toggleAux("outline", "大綱／連結");
  if (token === undefined) return;
  const index = await rpc("index");
  if (token !== auxVersion) return;
  const backlinks: string[] = [];
  for (const item of index)
    for (const target of item.links) {
      const found = await rpc("link", { target, path: item.path });
      if (found?.path === current) backlinks.push(item.path);
    }
  if (token !== auxVersion) return;
  showLinks("反向連結", backlinks);
  const h = document.createElement("h3");
  h.textContent = "大綱";
  $("aux-content").append(h);
  for (const match of editor.state.sliceDoc().matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    const b = document.createElement("button");
    b.textContent = match[2];
    b.onclick = () => {
      setMode("live");
      editor.dispatch({
        selection: { anchor: match.index },
        effects: EditorView.scrollIntoView(match.index),
      });
      editor.focus();
    };
    $("aux-content").append(b);
  }
  const out = document.createElement("h3");
  out.textContent = "向外連結";
  $("aux-content").append(out);
  for (const target of index.find((i: any) => i.path === current)?.links ||
    []) {
    const b = document.createElement("button");
    b.textContent = target;
    b.onclick = action(async () => {
      const found = await rpc("link", { target, path: current });
      if (found) await openFile(found.path, found.anchor);
    });
    $("aux-content").append(b);
  }
});
$("tags").onclick = action(async () => {
  const token = toggleAux("tags", "標籤");
  if (token === undefined) return;
  const index = await rpc("index");
  if (token !== auxVersion) return;
  for (const tag of [
    ...new Set<string>(index.flatMap((i: any) => i.tags)),
  ].sort()) {
    const b = document.createElement("button");
    b.textContent = "#" + tag;
    b.onclick = () =>
      showLinks(
        "#" + tag,
        index.filter((i: any) => i.tags.includes(tag)).map((i: any) => i.path),
      );
    $("aux-content").append(b);
  }
});
function bookmarkKey() {
  return "bookmarks:" + root;
}
$("bookmark").onclick = () => {
  if (!current) return;
  const key = bookmarkKey(),
    list: string[] = JSON.parse(localStorage.getItem(key) || "[]");
  const i = list.indexOf(current);
  if (i >= 0) list.splice(i, 1);
  else list.push(current);
  localStorage.setItem(key, JSON.stringify(list));
  status(i >= 0 ? "已移除書籤" : "已加入書籤（此 VSCode）");
};
$("bookmarks").onclick = () => {
  if (toggleAux("bookmarks", "書籤") === undefined) return;
  showLinks("書籤", JSON.parse(localStorage.getItem(bookmarkKey()) || "[]"));
};
const divider = $("divider");
divider.onpointerdown = (e) => {
  divider.setPointerCapture(e.pointerId);
};
divider.onpointermove = (e) => {
  if (divider.hasPointerCapture(e.pointerId))
    document.documentElement.style.setProperty(
      "--sidebar",
      Math.max(150, Math.min(500, e.clientX)) + "px",
    );
};
divider.onkeydown = (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    const width = $("sidebar").getBoundingClientRect().width;
    document.documentElement.style.setProperty(
      "--sidebar",
      Math.max(
        150,
        Math.min(500, width + (e.key === "ArrowRight" ? 10 : -10)),
      ) + "px",
    );
  }
};
setInterval(() => {
  void (async () => {
    if (
      initializing ||
      loading ||
      opening ||
      dirty ||
      savePromise ||
      pending.size
    )
      return;
    const refs = await rpc("vaults");
    if (JSON.stringify(refs) !== vaultVersion) {
      await initialize();
      return;
    }
    if (!root) return;
    const tree = await rpc("tree");
    if (JSON.stringify(tree) !== treeVersion) {
      entries = tree;
      files = flatten(tree);
      treeVersion = JSON.stringify(tree);
      renderTree();
    }
    if (current && /\.(md|canvas|base|txt|json|csv)$/i.test(current)) {
      const data = await rpc("read", { path: current });
      if (!dirty && data.revision !== base) {
        states.delete(current);
        await openFile(current);
        status("已載入外部變更");
      }
    }
  })().catch((e) => status(e.message, true));
}, 2500);
setMode(mode);
void initialize().catch((e) => status(e.message, true));

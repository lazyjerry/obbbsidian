import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  Vault,
  Conflict,
  flatten,
  pruneDrafts,
  pruneRecovery,
  RECOVERY_KEEP,
  RECOVERY_MAX_AGE,
} from "../src/vault";
import { renderer, renderMarkdown } from "../src/render";
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "obb-test-"));
  const vault = new Vault(path.join(dir, "vault"), path.join(dir, "recovery"));
  await vault.initialize();
  return { dir, vault };
}
test("existing metadata and BOM/CRLF Markdown survive no-op save byte for byte", async () => {
  const { dir, vault } = await fixture();
  try {
    const meta = path.join(vault.root, ".obsidian");
    await fs.writeFile(
      path.join(meta, "workspace.json"),
      '{ "unknown": [1,2] }',
    );
    await fs.writeFile(
      path.join(meta, "community-plugins.json"),
      '["untrusted-plugin"]',
    );
    await vault.initialize();
    const data = Buffer.from(
      "\uFEFF---\r\ntags: [中文]\r\n---\r\n[[link]]\r\n",
    );
    await fs.writeFile(path.join(vault.root, "中文.md"), data);
    const original = await vault.read("中文.md");
    await vault.save("中文.md", original.text, original.revision);
    assert.deepEqual(await fs.readFile(path.join(vault.root, "中文.md")), data);
    assert.equal(
      await fs.readFile(path.join(meta, "workspace.json"), "utf8"),
      '{ "unknown": [1,2] }',
    );
    assert.equal(
      await fs.readFile(path.join(meta, "community-plugins.json"), "utf8"),
      '["untrusted-plugin"]',
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("reject stale save and preserve external content, keep recovery on successful write", async () => {
  const { dir, vault } = await fixture();
  try {
    await vault.create("note.md", "original");
    const old = await vault.read("note.md");
    await fs.writeFile(path.join(vault.root, "note.md"), "Obsidian edit");
    await assert.rejects(
      vault.save("note.md", "stale webview", old.revision),
      Conflict,
    );
    assert.equal((await vault.read("note.md")).text, "Obsidian edit");
    const fresh = await vault.read("note.md");
    await vault.save("note.md", "new edit", fresh.revision);
    const backups = await fs.readdir(vault.recovery);
    assert.equal(backups.length, 1);
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(vault.recovery, backups[0]), "utf8"),
      ).text,
      "Obsidian edit",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("serialize overlapping saves and reject outdated revision", async () => {
  const { dir, vault } = await fixture();
  try {
    await vault.create("note.md", "original");
    const old = await vault.read("note.md");
    const results = await Promise.allSettled([
      vault.save("note.md", "first", old.revision),
      vault.save("note.md", "second", old.revision),
    ]);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    assert.equal((await vault.read("note.md")).text, "first");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("deny traversal, hidden metadata, symlinks, and overwrite on creation", async () => {
  const { dir, vault } = await fixture();
  try {
    await fs.writeFile(path.join(dir, "secret"), "private");
    await fs.symlink(
      path.join(dir, "secret"),
      path.join(vault.root, "escape.md"),
    );
    for (const file of [
      "../secret",
      ".obsidian/app.json",
      "escape.md",
      "/etc/passwd",
    ])
      await assert.rejects(vault.read(file));
    await vault.create("ok.md", "kept");
    await assert.rejects(vault.create("ok.md", "overwrite"));
    assert.equal((await vault.read("ok.md")).text, "kept");
    assert.deepEqual(flatten(await vault.tree()), ["ok.md"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("wiki links resolve relative paths, unicode, anchors, and detect ambiguity", async () => {
  const { dir, vault } = await fixture();
  try {
    const files = ["a/Note.md", "b/Note.md", "中文.md", "a/Current.md"];
    assert.deepEqual(
      await vault.resolveLink("Note#Heading|label", "a/Current.md", files),
      { path: "a/Note.md", anchor: "Heading" },
    );
    assert.deepEqual(
      await vault.resolveLink("%E4%B8%AD%E6%96%87", "a/Current.md", files),
      { path: "中文.md", anchor: undefined },
    );
    await assert.rejects(vault.resolveLink("Note", "Other.md", files));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("Obsidian syntax renders without rewriting source or interpreting fenced syntax", () => {
  const md = renderer();
  const text =
    "---\ntags: [a]\n---\n# Heading\n[[Note|Alias]] ![[file.png]] ==mark== %%secret%% $x^2$\n\n```md\n[[literal]]\n```\n\n- [x] Task\n\nFootnote[^1]\n\n[^1]: detail\n";
  const html = renderMarkdown(md, text);
  assert.match(html, /data-note="Note"/);
  assert.match(html, /data-embed="file.png"/);
  assert.match(html, /<mark>mark<\/mark>/);
  assert.doesNotMatch(html, /secret/);
  assert.match(html, /katex/);
  assert.match(html, /\[\[literal\]\]/);
  assert.match(html, /Properties/);
  assert.match(html, /footnote/);
});

test("reject invalid UTF-8 instead of silently saving replacement characters", async () => {
  const { dir, vault } = await fixture();
  try {
    await fs.writeFile(
      path.join(vault.root, "invalid.md"),
      Buffer.from([0xff, 0xfe, 0x80]),
    );
    await assert.rejects(vault.read("invalid.md"), /UTF-8/);
    assert.deepEqual(
      await fs.readFile(path.join(vault.root, "invalid.md")),
      Buffer.from([0xff, 0xfe, 0x80]),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("first note initializes missing metadata and explicit initialization preserves existing settings", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "obb-init-"));
  const vault = new Vault(dir, path.join(dir, "recovery"));
  try {
    await assert.rejects(fs.stat(path.join(dir, ".obsidian")), {
      code: "ENOENT",
    });
    await vault.create("first.md", "# First");
    assert.equal(
      await fs.readFile(path.join(dir, ".obsidian/app.json"), "utf8"),
      "{}\n",
    );
    assert.equal(
      await fs.readFile(path.join(dir, ".obsidian/appearance.json"), "utf8"),
      "{}\n",
    );
    await fs.writeFile(path.join(dir, ".obsidian/app.json"), '{"custom":true}');
    await fs.rm(path.join(dir, ".obsidian/appearance.json"));
    await vault.initialize();
    assert.equal(
      await fs.readFile(path.join(dir, ".obsidian/app.json"), "utf8"),
      '{"custom":true}',
    );
    assert.equal(
      await fs.readFile(path.join(dir, ".obsidian/appearance.json"), "utf8"),
      "{}\n",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("wiki links to URLs become sanitizable hrefs; data-note stays internal", () => {
  const html = renderMarkdown(
    renderer(),
    "[[https://example.com/a|site]] [[obsidian://open?vault=v]] [[Note#Heading]]\n",
  );
  assert.match(html, /<a href="https:\/\/example.com\/a">site<\/a>/);
  assert.match(html, /<a href="obsidian:\/\/open\?vault=v">/);
  assert.doesNotMatch(html, /data-note="(https?|obsidian):/);
  assert.match(html, /data-note="Note#Heading"/);
});

test("recovery keeps the newest copies per note and drops expired ones", async () => {
  const { dir, vault } = await fixture();
  try {
    for (const file of ["a.md", "b.md"]) {
      await vault.create(file, "0");
      await vault.save(file, "1", (await vault.read(file)).revision);
    }
    const saved = await fs.readdir(vault.recovery);
    const keys = saved.map(
      (name) => /^\d+-([0-9a-f]{16})-[0-9a-f-]{36}\.json$/.exec(name)?.[1],
    );
    assert.equal(keys.length, 2);
    assert.ok(keys[0] && keys[1] && keys[0] !== keys[1]);
    const now = Date.now() + 1000;
    const synthetic = (time: number, key = "") =>
      `${time}-${key ? key + "-" : ""}${randomUUID()}.json`;
    const aKey = keys[0]!;
    // 同一筆記再放 RECOVERY_KEEP + 5 份較舊的副本；加上實際儲存的那份，應只留最新的 RECOVERY_KEEP 份。
    const old: string[] = [];
    for (let i = 1; i <= RECOVERY_KEEP + 5; i++) {
      old.push(synthetic(now - i * 1000, aKey));
      await fs.writeFile(path.join(vault.recovery, old.at(-1)!), "{}");
    }
    // 舊版檔名（無筆記鍵）只受天數限制。
    const legacyOld = synthetic(now - RECOVERY_MAX_AGE - 1000);
    const legacyNew = synthetic(now);
    for (const name of [legacyOld, legacyNew])
      await fs.writeFile(path.join(vault.recovery, name), "{}");
    await pruneRecovery(vault.recovery, now);
    const names = await fs.readdir(vault.recovery);
    assert.deepEqual(
      old.map((name) => names.includes(name)),
      old.map((_, i) => i < RECOVERY_KEEP - 1),
    );
    for (const name of saved) assert.ok(names.includes(name));
    assert.equal(names.includes(legacyOld), false);
    assert.equal(names.includes(legacyNew), true);
    await pruneRecovery(vault.recovery, now + RECOVERY_MAX_AGE + 60_000);
    assert.deepEqual(await fs.readdir(vault.recovery), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("draft cleanup removes only drafts that are saved or whose note is gone", async () => {
  const { dir, vault } = await fixture();
  const drafts = path.join(dir, "drafts");
  await fs.mkdir(drafts);
  const write = (name: string, data: object) =>
    fs.writeFile(path.join(drafts, name), JSON.stringify(data));
  try {
    await vault.create("unsaved.md", "disk");
    await vault.create("saved.md", "same");
    await write("unsaved.json", {
      text: "unsaved edit",
      revision: "r",
      root: vault.root,
      path: "unsaved.md",
    });
    await write("saved.json", {
      text: "same",
      revision: "r",
      root: vault.root,
      path: "saved.md",
    });
    await write("deleted.json", {
      text: "orphan",
      revision: "r",
      root: vault.root,
      path: "deleted.md",
    });
    await write("offline.json", {
      text: "vault unavailable",
      revision: "r",
      root: path.join(dir, "unmounted"),
      path: "note.md",
    });
    await write("legacy.json", { text: "old format", revision: "r" });
    await fs.writeFile(path.join(drafts, "broken.json"), "{");
    await pruneDrafts(drafts);
    assert.deepEqual((await fs.readdir(drafts)).sort(), [
      "broken.json",
      "legacy.json",
      "offline.json",
      "unsaved.json",
    ]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

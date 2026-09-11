import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Vault, Conflict, flatten } from "../src/vault";
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

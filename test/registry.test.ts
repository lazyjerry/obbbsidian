import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { VaultRegistry } from "../src/registry";

test("device references survive reopening; concurrent additions and symlink dedup preserve vault files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "obb-registry-"));
  try {
    const config = path.join(dir, "config");
    const a = new VaultRegistry(config),
      b = new VaultRegistry(config);
    const roots = ["one", "two", "three"].map((name) => path.join(dir, name));
    for (const root of roots) await fs.mkdir(root);
    await fs.mkdir(path.join(roots[0], ".obsidian"));
    await fs.writeFile(path.join(roots[0], "note.md"), "keep me");
    await fs.writeFile(
      path.join(roots[0], ".obsidian", "app.json"),
      '{"keep":true}',
    );
    const refs = await Promise.all([
      a.add(roots[0]),
      b.add(roots[1]),
      a.add(roots[2]),
    ]);
    assert.equal((await new VaultRegistry(config).list()).length, 3);
    await fs.symlink(roots[0], path.join(dir, "alias"));
    assert.equal((await b.add(path.join(dir, "alias"))).id, refs[0].id);
    assert.equal((await a.list()).length, 3);
    await b.remove(refs[0].id);
    assert.equal((await a.list()).length, 2);
    assert.equal(
      await fs.readFile(path.join(roots[0], "note.md"), "utf8"),
      "keep me",
    );
    assert.equal(
      await fs.readFile(path.join(roots[0], ".obsidian", "app.json"), "utf8"),
      '{"keep":true}',
    );
    assert.equal((await a.add(roots[0])).id, refs[0].id);
    await assert.rejects(a.remove("../../one/note.md"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("legacy migration runs once; removed references and an empty list stay removed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "obb-migrate-"));
  try {
    const registry = new VaultRegistry(path.join(dir, "config"));
    const root = path.join(dir, "legacy");
    await fs.mkdir(root);
    const legacy = [
      { root, name: "共用", legacyId: "shared" },
      { root: path.join(dir, "missing"), name: "私人", legacyId: "private" },
    ];
    await registry.migrate(legacy);
    const refs = await registry.list();
    assert.equal(refs.length, 1);
    assert.equal(refs[0].legacyId, "shared");
    await assert.rejects(fs.stat(path.join(dir, "notes")), { code: "ENOENT" });
    await assert.rejects(registry.remove(refs[0].id), /至少需保留一個儲存庫/);
    assert.deepEqual(await registry.list(), refs);
    // 模擬舊版留下或外部清空的清單。
    await fs.rm(path.join(registry.directory, refs[0].id + ".json"));
    await new VaultRegistry(registry.directory).migrate(legacy);
    assert.deepEqual(await registry.list(), []);
    assert.equal((await fs.stat(root)).isDirectory(), true);
    await assert.rejects(fs.stat(legacy[1].root), { code: "ENOENT" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("first installation creates one default vault; reopening and removal do not recreate it", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "obb-default-"));
  try {
    const registry = new VaultRegistry(path.join(dir, "vaults"));
    await registry.migrate([]);
    const refs = await registry.list();
    assert.equal(refs.length, 1);
    assert.equal(refs[0].name, "筆記");
    assert.equal(refs[0].root, await fs.realpath(path.join(dir, "notes")));
    assert.deepEqual(await fs.readdir(refs[0].root), []);
    await fs.writeFile(path.join(refs[0].root, "note.md"), "keep me");
    await new VaultRegistry(registry.directory).migrate([]);
    assert.deepEqual(await registry.list(), refs);
    await assert.rejects(registry.remove(refs[0].id), /至少需保留一個儲存庫/);
    assert.deepEqual(await registry.list(), refs);
    // 模擬舊版留下或外部清空的清單。
    await fs.rm(path.join(registry.directory, refs[0].id + ".json"));
    await registry.migrate([]);
    assert.deepEqual(await registry.list(), []);
    assert.equal(
      await fs.readFile(path.join(refs[0].root, "note.md"), "utf8"),
      "keep me",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("initialization preserves an existing list without adding a default vault", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "obb-existing-"));
  try {
    const registry = new VaultRegistry(path.join(dir, "vaults"));
    const root = path.join(dir, "existing");
    await fs.mkdir(root);
    const ref = await registry.add(root);
    await registry.migrate([]);
    assert.deepEqual(await registry.list(), [ref]);
    await assert.rejects(fs.stat(path.join(dir, "notes")), { code: "ENOENT" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("concurrent removals across registry instances retain one vault", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "obb-remove-"));
  try {
    const a = new VaultRegistry(path.join(dir, "vaults"));
    const b = new VaultRegistry(a.directory);
    const refs = [];
    for (const name of ["one", "two"]) {
      const root = path.join(dir, name);
      await fs.mkdir(root);
      refs.push(await a.add(root));
    }
    const results = await Promise.allSettled([
      a.remove(refs[0].id),
      b.remove(refs[1].id),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const remaining = await a.list();
    assert.equal(remaining.length, 1);
    await assert.rejects(b.remove(remaining[0].id), /至少需保留一個儲存庫/);
    for (const ref of refs)
      assert.equal((await fs.stat(ref.root)).isDirectory(), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const vscode = require("vscode");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
exports.run = async () => {
  const extension = vscode.extensions.getExtension("workjerry.obbbsidian");
  assert.ok(extension);
  const { provider } = await extension.activate();
  const messages = [];
  provider.view = {
    webview: {
      postMessage: (message) => {
        messages.push(message);
        return Promise.resolve(true);
      },
    },
  };
  for (const format of ["bold", "italic", "highlight", "link"]) {
    await vscode.commands.executeCommand(`obbbsidian.format.${format}`);
    assert.deepEqual(messages.pop(), { event: "format", format });
  }
  provider.view = undefined;
  const storage = provider.context.globalStorageUri.fsPath;
  provider.registry = new provider.registry.constructor(
    path.join(storage, "device-registry"),
  );
  await fs.mkdir(path.join(storage, "one"), { recursive: true });
  await fs.mkdir(path.join(storage, "two"), { recursive: true });
  const first = await provider.registry.add(path.join(storage, "one"));
  const second = await provider.registry.add(path.join(storage, "two"));
  let id = 0;
  const call = (type, data = {}) =>
    provider.handle({ id: ++id, type, source: first.id, ...data });
  const init = await call("init");
  assert.ok(init.root);
  await fs.writeFile(
    path.join(init.root, "integration.md"),
    "# Host integration\r\n",
  );
  const original = await call("read", {
    root: init.root,
    path: "integration.md",
  });
  await call("save", {
    root: init.root,
    path: "integration.md",
    text: original.text + "saved\r\n",
    revision: original.revision,
  });
  assert.equal(
    await fs.readFile(path.join(init.root, "integration.md"), "utf8"),
    "# Host integration\r\nsaved\r\n",
  );
  await assert.rejects(
    call("save", {
      root: init.root,
      path: "integration.md",
      text: "stale",
      revision: original.revision,
    }),
  );
  const current = await call("read", {
    root: init.root,
    path: "integration.md",
  });
  await call("draft", {
    root: init.root,
    path: "integration.md",
    text: "draft",
    revision: current.revision,
  });
  assert.equal(
    (await call("read", { root: init.root, path: "integration.md" })).draft
      .text,
    "draft",
  );
  await assert.rejects(
    call("read", { root: "/stale-root", path: "integration.md" }),
  );
  const priv = await provider.handle({
    id: ++id,
    type: "init",
    source: second.id,
  });
  assert.notEqual(priv.root, init.root);
  assert.deepEqual(priv.tree, []);
  await call("removeVault", { root: init.root });
  assert.equal(
    await fs.readFile(path.join(init.root, "integration.md"), "utf8"),
    "# Host integration\r\nsaved\r\n",
  );
  await assert.rejects(
    call("read", { root: init.root, path: "integration.md" }),
    /引用已移除/,
  );
  await provider.registry.add(init.root);
  assert.equal(
    (await call("read", { root: init.root, path: "integration.md" })).draft
      .text,
    "draft",
  );
  await call("removeVault");
  await assert.rejects(
    call("removeVault", { source: second.id }),
    /至少需保留一個儲存庫/,
  );
  assert.deepEqual(
    (await call("vaults")).map((ref) => ref.id),
    [second.id],
  );
  const originalSaveDialog = vscode.window.showSaveDialog;
  const originalOpenDialog = vscode.window.showOpenDialog;
  const createdRoot = path.join(storage, "created-vault");
  try {
    vscode.window.showSaveDialog = async () => vscode.Uri.file(createdRoot);
    const created = await call("choose", { initialize: true });
    assert.equal(created.root, await fs.realpath(createdRoot));
    assert.equal(
      (await fs.stat(path.join(createdRoot, ".obsidian", "app.json"))).isFile(),
      true,
    );
    await call("removeVault", { source: created.id });
    assert.equal((await fs.stat(createdRoot)).isDirectory(), true);
    vscode.window.showOpenDialog = async () => [vscode.Uri.file(createdRoot)];
    assert.equal((await call("choose")).id, created.id);
    vscode.window.showOpenDialog = async () => undefined;
    assert.equal(await call("choose"), undefined);
    assert.equal((await call("vaults")).length, 2);
  } finally {
    vscode.window.showSaveDialog = originalSaveDialog;
    vscode.window.showOpenDialog = originalOpenDialog;
  }
  await vscode.commands.executeCommand("obbbsidian.open");
  console.log(
    "Host integration passed: activation, real disk save, conflict, draft, vault isolation, panel registration.",
  );
};

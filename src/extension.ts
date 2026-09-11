import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { Vault, flatten, revision } from "./vault";

import { VaultRegistry } from "./registry";
export function activate(context: vscode.ExtensionContext) {
  const provider = new Panel(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("obbbsidian.vault", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("obbbsidian.open", () =>
      vscode.commands.executeCommand("obbbsidian.vault.focus"),
    ),
  );
  for (const format of ["bold", "italic", "highlight", "link"])
    context.subscriptions.push(
      vscode.commands.registerCommand(`obbbsidian.format.${format}`, () =>
        provider.format(format),
      ),
    );
  return { provider };
}
class Panel implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private registry = new VaultRegistry(
    path.join(os.homedir(), ".obbbsidian", "vaults"),
  );
  private vaults = new Map<string, Vault>();
  private operations: Promise<unknown> = Promise.resolve();
  constructor(private context: vscode.ExtensionContext) {}
  format(format: string) {
    return this.view?.webview.postMessage({ event: "format", format });
  }
  async choose(initializeVault = false) {
    let folder: string;
    if (initializeVault) {
      const uri = await vscode.window.showSaveDialog({
        title: "新增儲存庫資料夾",
        saveLabel: "建立儲存庫",
      });
      if (!uri) return;
      folder = uri.fsPath;
      await fs.mkdir(folder);
      await new Vault(
        folder,
        path.join(this.context.globalStorageUri.fsPath, "recovery"),
      ).initialize();
    } else {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: "加入既有儲存庫",
        openLabel: "加入儲存庫",
      });
      if (!uris?.[0]) return;
      folder = uris[0].fsPath;
    }
    const added = await this.registry.add(folder);
    return added;
  }
  private async initialize() {
    const config = vscode.workspace.getConfiguration("obbbsidian");
    const legacy = ["shared", "private"].map((legacyId) => {
      const key = legacyId === "shared" ? "dataFolder" : "privateDataFolder";
      const value = config.get<string>(key, "");
      const root = value.startsWith("~/")
        ? path.join(os.homedir(), value.slice(2))
        : value || path.join(this.context.globalStorageUri.fsPath, legacyId);
      return {
        legacyId,
        name: legacyId === "shared" ? "共用" : "私人",
        root: path.resolve(root),
      };
    });
    await this.registry.migrate(legacy);
    const refs = await this.registry.list();
    this.vaults = new Map(
      refs.map((ref) => [
        ref.id,
        this.vaults.get(ref.id) ||
          new Vault(
            ref.root,
            path.join(this.context.globalStorageUri.fsPath, "recovery"),
          ),
      ]),
    );
    if (this.view)
      this.view.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          this.context.extensionUri,
          ...refs.map((ref) => vscode.Uri.file(ref.root)),
        ],
      };
    return refs;
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const webview = view.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    const uri = (p: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, p));
    const nonce = randomUUID();
    webview.html = `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https:; media-src ${webview.cspSource}; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${uri("media/style.css")}"><link rel="stylesheet" href="${uri("media/main.css")}"></head><body><div id="app"></div><script nonce="${nonce}" src="${uri("media/main.js")}"></script></body></html>`;
    const sub = webview.onDidReceiveMessage((message) => {
      const task = this.operations
        .catch(() => {})
        .then(async () => {
          try {
            const result = await this.handle(message);
            await webview.postMessage({ id: message.id, result });
          } catch (error) {
            await webview.postMessage({
              id: message.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      this.operations = task;
    });
    view.onDidDispose(() => {
      sub.dispose();
      this.view = undefined;
    });
  }
  private draftPath(vault: Vault, file: string) {
    return path.join(
      this.context.globalStorageUri.fsPath,
      "drafts",
      revision(vault.root + "\0" + file) + ".json",
    );
  }
  private async handle(m: any): Promise<any> {
    if (!m || !Number.isSafeInteger(m.id) || typeof m.type !== "string")
      throw new Error("無效訊息。");
    const refs = await this.initialize();
    if (m.type === "vaults") return refs;
    if (m.type === "choose") return this.choose(m.initialize === true);
    if (m.type === "removeVault") {
      await this.registry.remove(m.source);
      return {};
    }
    const ref = refs.find(
      (item) =>
        item.id === m.source ||
        (m.type === "init" && item.legacyId === m.source),
    );
    if (m.type === "init" && !ref)
      return { source: "", root: "", tree: [], config: {} };
    const vault = ref && this.vaults.get(ref.id);
    if (!vault)
      throw new Error("儲存庫引用已移除；草稿仍保留，請重新加入原儲存庫。");
    if (m.type === "init")
      return {
        source: ref!.id,
        root: vault.root,
        tree: await vault.tree(),
        config: await vault.config("app"),
      };
    if (m.root !== vault.root)
      throw new Error("儲存庫已切換；草稿仍保留，請重新開啟原儲存庫。");
    if (m.type === "tree") return vault.tree();
    if (m.type === "read") {
      const data = await vault.read(m.path);
      let draft;
      try {
        draft = JSON.parse(
          await fs.readFile(this.draftPath(vault, m.path), "utf8"),
        );
      } catch {}
      return { ...data, draft };
    }
    if (m.type === "draft") {
      await vault.safe(m.path);
      if (typeof m.text !== "string" || typeof m.revision !== "string")
        throw new Error("無效草稿。");
      const target = this.draftPath(vault, m.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const temp = target + ".tmp";
      await fs.writeFile(
        temp,
        JSON.stringify({ text: m.text, revision: m.revision }),
        { mode: 0o600 },
      );
      await fs.rename(temp, target);
      return {};
    }
    if (m.type === "save") {
      if (typeof m.text !== "string" || typeof m.revision !== "string")
        throw new Error("無效內容。");
      const result = await vault.save(m.path, m.text, m.revision);
      await fs.rm(this.draftPath(vault, m.path), { force: true });
      return result;
    }
    if (m.type === "discardDraft") {
      await fs.rm(this.draftPath(vault, m.path), { force: true });
      return {};
    }
    if (m.type === "create") {
      const input = await vscode.window.showInputBox({
        title: m.directory ? "新增資料夾" : "新增筆記",
        prompt: "相對於 vault 的路徑",
        value: m.suggested || "",
      });
      if (!input) return;
      const name =
        m.directory || /\.(md|canvas|base)$/i.test(input)
          ? input
          : input + ".md";
      await vault.create(name, m.text || "", !!m.directory);
      return { path: name };
    }
    if (m.type === "rename") {
      const old = await vault.safe(m.path);
      const dest = await vscode.window.showInputBox({
        title: "重新命名（連結不會自動改寫）",
        value: m.path,
      });
      if (!dest || dest === m.path) return;
      const to = await vault.safe(dest, true);
      try {
        await fs.lstat(to);
        throw new Error("目的路徑已存在。");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await fs.rename(old, to);
      return { path: dest };
    }
    if (m.type === "delete") {
      const file = await vault.safe(m.path);
      const yes = await vscode.window.showWarningMessage(
        `將「${m.path}」移至垃圾桶？`,
        { modal: true },
        "移至垃圾桶",
      );
      if (yes !== "移至垃圾桶") return false;
      await vscode.workspace.fs.delete(vscode.Uri.file(file), {
        useTrash: true,
        recursive: true,
      });
      return true;
    }
    if (m.type === "resource")
      return this.view!.webview.asWebviewUri(
        vscode.Uri.file(await vault.safe(m.path)),
      ).toString();
    if (m.type === "link")
      return vault.resolveLink(m.target, m.path, flatten(await vault.tree()));
    if (m.type === "external") {
      const uri = vscode.Uri.parse(m.url);
      if (!["https", "http", "mailto", "obsidian"].includes(uri.scheme))
        throw new Error("不支援此連結協定。");
      return vscode.env.openExternal(uri);
    }
    if (m.type === "native") {
      await vscode.commands.executeCommand(
        "vscode.open",
        vscode.Uri.file(await vault.safe(m.path)),
      );
      return {};
    }
    if (m.type === "reveal") {
      await vscode.commands.executeCommand(
        "revealFileInOS",
        vscode.Uri.file(vault.root),
      );
      return {};
    }
    if (m.type === "trash") {
      if (process.platform === "darwin") {
        await promisify(execFile)("/usr/bin/osascript", [
          "-e",
          'tell application "Finder" to open trash',
        ]);
      } else if (process.platform === "win32") {
        await promisify(execFile)("explorer.exe", ["shell:RecycleBinFolder"]);
      } else {
        await promisify(execFile)("xdg-open", ["trash:///"]);
      }
      return {};
    }
    if (m.type === "search") {
      const files = flatten(await vault.tree()).filter((p) =>
        p.endsWith(".md"),
      );
      const result = [];
      for (const file of files) {
        try {
          const { text } = await vault.read(file);
          if (
            file.toLowerCase().includes(String(m.query).toLowerCase()) ||
            text.toLowerCase().includes(String(m.query).toLowerCase())
          )
            result.push({
              path: file,
              snippet:
                text
                  .split(/\r?\n/)
                  .find((l) =>
                    l.toLowerCase().includes(String(m.query).toLowerCase()),
                  )
                  ?.slice(0, 180) || "",
            });
        } catch {}
      }
      return result;
    }
    if (m.type === "index") {
      const entries = [];
      for (const file of flatten(await vault.tree()).filter((p) =>
        p.endsWith(".md"),
      )) {
        try {
          const { text } = await vault.read(file);
          entries.push({
            path: file,
            links: [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]),
            tags: [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map(
              (x) => x[1],
            ),
          });
        } catch {}
      }
      return entries;
    }
    if (m.type === "daily") {
      const conf = await vault.config("daily-notes");
      const now = new Date(),
        date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      if (conf.format && conf.format !== "YYYY-MM-DD")
        throw new Error(
          "目前每日筆記支援 YYYY-MM-DD；其他日期格式請以新增筆記操作。",
        );
      const relative = path.posix.join(conf.folder || "", date + ".md");
      try {
        await vault.read(relative);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        let text = "";
        if (conf.template)
          text = (
            await vault.read(
              conf.template.endsWith(".md")
                ? conf.template
                : conf.template + ".md",
            )
          ).text;
        text = text
          .replace(/\{\{date\}\}/g, date)
          .replace(/\{\{title\}\}/g, date);
        await vault.create(relative, text);
      }
      return { path: relative };
    }
    if (m.type === "attachment") {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        title: "插入附件",
      });
      if (!selected?.[0]) return;
      const conf = await vault.config("app");
      let folder = String(conf.attachmentFolderPath || "");
      if (folder === "/" || folder === ".") folder = "";
      else if (folder.startsWith("./"))
        folder = path.posix.join(
          path.posix.dirname(m.path || ""),
          folder.slice(2),
        );
      if (folder) {
        let prefix = "";
        for (const part of folder.split("/").filter(Boolean)) {
          prefix = path.posix.join(prefix, part);
          try {
            await vault.create(prefix, "", true);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          }
        }
      }
      const name = path.basename(selected[0].fsPath),
        relative = path.posix.join(folder, name);
      const target = await vault.safe(relative, true);
      await fs.copyFile(selected[0].fsPath, target, 1);
      return { path: relative };
    }
    if (m.type === "template") {
      const conf = await vault.config("templates");
      const files = flatten(await vault.tree()).filter(
        (p) =>
          p.endsWith(".md") &&
          (!conf.folder || p.startsWith(conf.folder + "/")),
      );
      const selected = await vscode.window.showQuickPick(files, {
        title: "插入範本",
      });
      if (!selected) return;
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      return (await vault.read(selected)).text
        .replace(/\{\{date\}\}/g, date)
        .replace(/\{\{time\}\}/g, now.toTimeString().slice(0, 5))
        .replace(/\{\{title\}\}/g, path.basename(m.path || "", ".md"));
    }
    throw new Error("不支援的操作。");
  }
}

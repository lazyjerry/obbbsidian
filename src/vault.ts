import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export type Entry = {
  path: string;
  name: string;
  directory: boolean;
  children?: Entry[];
};
export const revision = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
export class Conflict extends Error {
  constructor() {
    super("檔案已被外部修改；請比較版本，或另存副本。");
  }
}
export const RECOVERY_KEEP = 50;
export const RECOVERY_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
// 檔名帶筆記鍵，清理時不必逐一讀取 JSON 就能分組。
const noteKey = (root: string, relative: string) =>
  revision(root + "\0" + relative).slice(0, 16);
export async function pruneRecovery(dir: string, now = Date.now()) {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  const groups = new Map<string, { name: string; time: number }[]>();
  for (const name of names) {
    // 舊版檔名沒有筆記鍵，只套用天數上限。
    const m = /^(\d+)-(?:([0-9a-f]{16})-)?[0-9a-f-]{36}\.json$/.exec(name);
    if (!m) continue;
    const time = Number(m[1]);
    if (now - time > RECOVERY_MAX_AGE)
      await fs.rm(path.join(dir, name), { force: true });
    else if (m[2])
      groups.set(m[2], [...(groups.get(m[2]) ?? []), { name, time }]);
  }
  for (const list of groups.values())
    for (const { name } of list
      .sort((a, b) => b.time - a.time)
      .slice(RECOVERY_KEEP))
      await fs.rm(path.join(dir, name), { force: true });
}
// 草稿是使用者唯一的未儲存內容：只刪「對應檔案確定已不存在」或「內容與磁碟相同」者，
// 其餘（舊格式、儲存庫離線、讀取失敗）一律保留。
export async function pruneDrafts(dir: string) {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    try {
      const raw = await fs.readFile(file, "utf8");
      const draft = JSON.parse(raw);
      if (typeof draft.root !== "string" || typeof draft.path !== "string")
        continue;
      if (!(await fs.stat(draft.root)).isDirectory()) continue;
      let stale: boolean;
      try {
        stale =
          (await new Vault(draft.root, "").read(draft.path)).text ===
          draft.text;
      } catch (e) {
        stale = (e as NodeJS.ErrnoException).code === "ENOENT";
      }
      // 其他視窗可能剛寫入新草稿；內容變了就不刪。
      if (stale && (await fs.readFile(file, "utf8")) === raw)
        await fs.rm(file, { force: true });
    } catch {}
  }
}
export function contained(root: string, file: string) {
  const r = path.relative(root, file);
  return (
    r === "" ||
    (!r.startsWith(".." + path.sep) && r !== ".." && !path.isAbsolute(r))
  );
}
export class Vault {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly root: string,
    readonly recovery: string,
  ) {}
  async initialize() {
    await fs.mkdir(this.root, { recursive: true });
    const metadata = path.join(this.root, ".obsidian");
    await fs.mkdir(metadata, { recursive: true });
    const stat = await fs.lstat(metadata);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(".obsidian 必須是實體資料夾。");
    // 只補缺少的設定，保留使用者現有設定及 Obsidian 工作區。
    for (const name of ["app.json", "appearance.json"]) {
      try {
        await fs.writeFile(path.join(metadata, name), "{}\n", { flag: "wx" });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
  }

  async safe(relative: string, allowMissing = false): Promise<string> {
    if (
      !relative ||
      relative.includes("\0") ||
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).some((p) => p === ".." || p.startsWith("."))
    )
      throw new Error("不允許存取 vault 外部或隱藏檔案。");
    const candidate = path.resolve(this.root, relative),
      root = await fs.realpath(this.root);
    if (!contained(this.root, candidate)) throw new Error("路徑超出 vault。");
    let current = this.root;
    for (const part of path.relative(this.root, candidate).split(path.sep)) {
      current = path.join(current, part);
      try {
        const st = await fs.lstat(current);
        if (st.isSymbolicLink()) throw new Error("不跟隨 vault 中的符號連結。");
      } catch (e) {
        if (!allowMissing || (e as NodeJS.ErrnoException).code !== "ENOENT")
          throw e;
      }
    }
    const parent = await fs.realpath(
      allowMissing ? path.dirname(candidate) : candidate,
    );
    if (!contained(root, parent)) throw new Error("路徑超出 vault。");
    return candidate;
  }
  async tree(): Promise<Entry[]> {
    const walk = async (dir: string): Promise<Entry[]> => {
      const entries = await fs.readdir(path.join(this.root, dir), {
        withFileTypes: true,
      });
      const out: Entry[] = [];
      for (const e of entries) {
        if (e.name.startsWith(".") || e.isSymbolicLink()) continue;
        const relative = path.posix.join(dir, e.name);
        if (e.isDirectory())
          out.push({
            path: relative,
            name: e.name,
            directory: true,
            children: await walk(relative),
          });
        else if (e.isFile())
          out.push({ path: relative, name: e.name, directory: false });
      }
      return out.sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.name.localeCompare(b.name),
      );
    };
    return walk("");
  }
  async read(relative: string) {
    const file = await this.safe(relative);
    const st = await fs.stat(file);
    if (st.size > 10 * 1024 * 1024)
      throw new Error("文字檔超過 10 MB，請使用外部編輯器。");
    const bytes = await fs.readFile(file);
    if (bytes.length !== st.size)
      throw new Error("雲端檔案尚未完整下載，請先保留下載項目。");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(
        "此檔案不是有效 UTF-8，請使用原生編輯器轉換編碼後再開啟。",
      );
    }
    if (text.includes("\0"))
      throw new Error("二進位內容不以 Markdown 編輯器開啟。");
    return {
      text,
      revision: revision(bytes),
      bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    };
  }
  async config(name: string): Promise<Record<string, any>> {
    if (!["app", "daily-notes", "templates", "appearance"].includes(name))
      throw new Error("未知設定");
    const file = path.join(this.root, ".obsidian", name + ".json");
    try {
      if (!contained(await fs.realpath(this.root), await fs.realpath(file)))
        return {};
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      return {};
    }
  }
  async save(relative: string, text: string, expected: string) {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const file = await this.safe(relative);
        const previous = await fs.readFile(file);
        if (revision(previous) !== expected) throw new Conflict();
        const bom = previous
          .subarray(0, 3)
          .equals(Buffer.from([239, 187, 191]));
        const bytes = Buffer.from((bom ? "\uFEFF" : "") + text, "utf8");
        if (bytes.equals(previous)) return { revision: expected };
        await fs.mkdir(this.recovery, { recursive: true });
        await fs.writeFile(
          path.join(
            this.recovery,
            `${Date.now()}-${noteKey(this.root, relative)}-${randomUUID()}.json`,
          ),
          JSON.stringify({
            root: this.root,
            path: relative,
            text: previous.toString("utf8"),
          }),
          { mode: 0o600 },
        );
        const temp = path.join(
          path.dirname(file),
          `.obbbsidian-${randomUUID()}.tmp`,
        );
        try {
          await fs.writeFile(temp, bytes, {
            flag: "wx",
            mode: (await fs.stat(file)).mode,
          });
          if (revision(await fs.readFile(file)) !== expected)
            throw new Conflict();
          await fs.rename(temp, file);
        } finally {
          await fs.rm(temp, { force: true });
        }
        // 清理失敗不可讓已完成的儲存回報錯誤。
        await pruneRecovery(this.recovery).catch(() => {});
        return { revision: revision(bytes) };
      });
    this.queue = task;
    return task;
  }
  async create(relative: string, text = "", directory = false) {
    const file = await this.safe(relative, true);
    if (!directory) await this.initialize();
    if (directory) await fs.mkdir(file);
    else await fs.writeFile(file, text, { flag: "wx" });
    return relative;
  }
  async resolveLink(target: string, from: string, files: string[]) {
    const raw = target.split("|")[0],
      [name, anchor] = raw.split("#");
    let decoded: string;
    try {
      decoded = decodeURIComponent(name);
    } catch {
      decoded = name;
    }
    if (!decoded) return { path: from, anchor };
    const candidates = [
      decoded,
      path.posix.join(path.posix.dirname(from), decoded),
    ];
    for (const candidate of candidates)
      for (const p of [candidate, candidate + ".md"])
        if (files.includes(p)) return { path: p, anchor };
    const matches = files.filter(
      (p) =>
        path.posix.basename(p) === decoded ||
        path.posix.basename(p) === decoded + ".md",
    );
    if (matches.length === 1) return { path: matches[0], anchor };
    if (matches.length > 1)
      throw new Error("有多份同名筆記，請在連結中指定資料夾。");
    return undefined;
  }
}
export function flatten(entries: Entry[]): string[] {
  return entries.flatMap((e) =>
    e.directory ? flatten(e.children ?? []) : [e.path],
  );
}

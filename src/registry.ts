import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { revision } from "./vault";

export interface VaultReference {
  id: string;
  name: string;
  root: string;
  legacyId?: string;
}

// 每份引用獨立保存，避免不同視窗同時加入時覆蓋整份清單。
export class VaultRegistry {
  constructor(readonly directory: string) {}
  async list(): Promise<VaultReference[]> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const result: VaultReference[] = [];
    for (const file of await fs.readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      try {
        const value = JSON.parse(
          await fs.readFile(path.join(this.directory, file), "utf8"),
        );
        if (
          value.id + ".json" !== file ||
          typeof value.name !== "string" ||
          typeof value.root !== "string" ||
          !path.isAbsolute(value.root)
        )
          throw new Error(`儲存庫引用格式錯誤：${file}`);
        result.push(value);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return result.sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  }
  async add(
    folder: string,
    name = path.basename(folder),
    legacyId?: string,
  ): Promise<VaultReference> {
    const root = await fs.realpath(folder);
    if (!(await fs.stat(root)).isDirectory()) throw new Error("請選擇資料夾。");
    const value = {
      id: revision(root),
      root,
      name: name.trim() || path.basename(root),
      ...(legacyId ? { legacyId } : {}),
    };
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = path.join(this.directory, value.id + ".json");
    const temp = path.join(this.directory, randomUUID() + ".tmp");
    try {
      await fs.writeFile(temp, JSON.stringify(value), {
        mode: 0o600,
        flag: "wx",
      });
      try {
        await fs.link(temp, target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        return JSON.parse(await fs.readFile(target, "utf8"));
      }
      return value;
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  async remove(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("無效儲存庫引用。");
    const lock = path.join(this.directory, ".remove-lock");
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      await fs.mkdir(lock, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("其他視窗正在移除儲存庫，請稍後再試。");
      throw e;
    }
    try {
      // 跨視窗共用鎖，避免兩邊同時通過數量檢查後清空清單。
      const refs = await this.list();
      if (!refs.some((ref) => ref.id === id)) return;
      if (refs.length <= 1)
        throw new Error("至少需保留一個儲存庫，無法移除最後一個儲存庫。");
      await fs.rm(path.join(this.directory, id + ".json"), { force: true });
    } finally {
      await fs.rmdir(lock);
    }
  }
  async migrate(legacy: { root: string; name: string; legacyId: string }[]) {
    const marker = path.join(this.directory, ".migrated");
    try {
      await fs.access(marker);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    for (const item of legacy) {
      try {
        await this.add(item.root, item.name, item.legacyId);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    if (!(await this.list()).length) {
      const root = path.join(this.directory, "..", "notes");
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
      await this.add(root, "筆記");
    }
    await fs.writeFile(marker, "1", { mode: 0o600 });
  }
}

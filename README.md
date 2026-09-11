# obbbsidian

在 VSCode 底部「obbbsidian」頁籤直接開啟 Obsidian vault。左欄管理多個儲存庫並選擇檔案，右欄編輯 Markdown。資料保存在原本的檔案裡，可再用 Obsidian 開啟。

**本套件相容 Markdown vault，並非 Obsidian 完整重製。** 不載入或安裝 Obsidian 外掛。Live Preview、Canvas、Bases 與部分核心功能有差異，請先看 [相容性與替代操作](docs/COMPATIBILITY.md)。

## 0.2.5 更新

新增紫色筆記圖示，顯示於 VSCode 擴充套件清單與詳細頁。

## 0.2.4 更新

左欄頂部只保留儲存庫下拉選單與兩個按鈕：資料夾圖示「儲存庫內操作」提供新增筆記、新增資料夾與重新整理；齒輪「儲存庫管理」提供加入、新增儲存庫、移除引用與 Finder。移除重複名稱，讓下拉選單使用剩餘寬度。

改善深色模式的 Markdown 配色：標題淺藍、連結與語言標記亮藍、程式碼柔橘、語法符號中灰。行號與選取背景跟隨 VSCode 主題，切換明暗模式立即生效。

剩下最後一個儲存庫時停用移除選項，後端也會拒絕移除。全新安裝預設建立一個「筆記」儲存庫，立即可用。既有清單與筆記保留。

固定的共用／私人改為可自由管理的儲存庫清單。齒輪可加入既有資料夾、建立新儲存庫，或只移除引用。清單保存在本機使用者的 `~/.obbbsidian/vaults/`，不同專案及 VSCode profile 共用，其他視窗會自動更新；每個視窗可各自選擇目前的儲存庫。

## 目前交付狀態

2026-09-11 建置 `workjerry.obbbsidian@0.2.5`。執行 `obbbsidian: Open Vault Panel` 即可開啟；若頁籤尚未出現，請執行 `Developer: Reload Window`。

- 發布檔：專案根目錄的 `obbbsidian-0.2.5.vsix`。
- 校驗檔：`obbbsidian-0.2.5.vsix.sha256`，可用 `shasum -a 256 -c obbbsidian-0.2.5.vsix.sha256` 檢查。
- 已通過：TypeScript 建置、格式檢查、13 項單元測試、Chrome UI 自動測試與 VSCode Extension Host 整合測試。
- 尚待驗收：Obsidian GUI 與真實 vault 的雙向操作、大型 vault、跨裝置同步，以及檔案選擇器／垃圾桶／附件操作的人工測試。

尚未達到完整 Obsidian 功能一致：Live Preview 僅實作部分語法呈現；Canvas 提供節點檢視與 JSON 編輯；Bases 提供 YAML 定義檢視，未執行資料庫檢視。完整差異見 [相容性與替代操作](docs/COMPATIBILITY.md)，測試範圍見 [驗證紀錄](docs/VALIDATION.md)。

## 開始使用

1. 安裝 `obbbsidian-0.2.5.vsix`，必要時執行 `Developer: Reload Window`。
2. 執行 `obbbsidian: Open Vault Panel`，或點底部 **obbbsidian** 頁籤。
3. 首次使用會自動建立「筆記」儲存庫，可直接新增筆記。也可按 ⚙ →「加入既有儲存庫…」選擇 **vault 根目錄**，或選「新增儲存庫…」建立資料夾；之後由左上角下拉選單切換。不要選 `.obsidian` 子目錄。
4. 點選 Markdown 檔案開始編輯。停止輸入約 650 ms 自動儲存，`Cmd/Ctrl+S` 或右側 `⋯` →「手動保存」可立即儲存。

全新安裝首次開啟面板時，自動建立一個「筆記」儲存庫，位置為 `~/.obbbsidian/notes/`，不再預設共用／私人兩個儲存庫。已有儲存庫清單時不額外建立；至少保留一個儲存庫，最後一個引用無法移除。首次升級會匯入當前 profile／工作區舊設定指向的既有共用／私人資料夾；沒有自訂路徑時，匯入舊版預設資料夾（若存在）。資料不搬移，之後不再從舊設定還原已移除的引用。其他 profile 的舊資料夾可自行加入。

## 儲存庫設定

- **加入既有儲存庫…**：選擇既有資料夾，以資料夾名稱顯示，不更動其內容；同一路徑或 symlink 指向同一位置時會選用既有引用。
- **新增儲存庫…**：指定新資料夾的位置與名稱，建立資料夾及必要的 `.obsidian` 設定；路徑已存在時不覆寫，請改用加入既有儲存庫。
- **移除目前儲存庫引用**：先保存編輯中的筆記，再從裝置清單移除引用。**不刪除資料夾、筆記、附件或 `.obsidian`**；草稿與復原版本也保留。重新加入原資料夾可繼續使用。
- **在 Finder 開啟儲存庫**：開啟目前選中的資料夾。

清單屬於本機作業系統使用者，不寫入專案 `.vscode/settings.json`，也不透過 VSCode Settings Sync 同步。不同 profile 共用引用清單；草稿與復原版本仍保存在各 profile 的套件儲存空間。原有 `obbbsidian.dataFolder`／`privateDataFolder` 僅保留首次升級相容用途。

## 編輯與瀏覽

- **Live Preview**：非游標行隱藏標題、粗斜體等部分語法；完整呈現用閱讀或分割預覽。
- **格式圖示**：粗體、斜體、標示、連結；滑鼠停留可查看名稱。先選取文字再點擊，重複點擊可取消格式；未選取時插入並選取提示文字。閱讀模式使用格式按鈕會切回 Live Preview。
- **右鍵格式選單**：在已開啟的 Markdown 編輯區按右鍵，可選粗體、斜體、標示或連結；保留 VSCode 原有剪下／複製／貼上選項。
- **格式快捷鍵**：先將焦點放到筆記編輯區；粗體 `Cmd/Ctrl+B`、斜體 `Cmd/Ctrl+I`、標示 `Cmd/Ctrl+Shift+H`、內部筆記連結 `Cmd/Ctrl+K`。選取文字後套用，再按一次取消；未選取時插入提示文字。
- **原始碼**：CodeMirror 6，支援 Undo／Redo、搜尋、Markdown 補全與工具列。
- **編輯＋預覽**：同時編輯與查看 Markdown、數學公式、Mermaid、附件。
- **閱讀**：乾淨的呈現畫面；`Cmd/Ctrl+E` 切換閱讀與 Live Preview。
- `[[筆記]]` 可補全；閱讀模式點連結，編輯模式 `Cmd/Ctrl+Click` 跳轉。
- 搜尋列搜尋目前 vault 的檔名與內容。每日、標籤、書籤按鈕提供各自入口。標籤／書籤下方區塊可按 ×、Escape 或再次點擊原按鈕關閉；切換儲存庫也會關閉。
- 「大綱／連結」顯示標題、反向連結與向外連結；再次點擊收合。
- 「附件」挑選檔案並複製到 vault，依 `app.json` 的 `attachmentFolderPath` 放置，插入 `![[...]]`。同名附件不覆寫。
- 「範本」插入 `.obsidian/templates.json` 指定資料夾中的筆記；支援 `{{date}}`、`{{time}}`、`{{title}}`。
- 右上角 `⋯` 提供手動保存、重新命名、移到垃圾桶、以 VSCode 編輯器開啟及開啟系統垃圾桶。復原版本仍保存在套件 globalStorage 的 `recovery` 資料夾，與垃圾桶分開。

## 儲存與外部變更

原有 `.obsidian` 檔案（包含外掛、工作區、快捷鍵、未知欄位）不修改。加入既有儲存庫只記錄引用；新增儲存庫或首次建立筆記時，才補齊缺少的 `app.json`、`appearance.json`。既有設定檔不覆寫。視窗狀態與草稿、復原版本放在 VSCode 儲存空間。

UTF-8 Markdown 的 BOM 與一般 LF／CRLF 換行可保留。文字檔上限 10 MB；無效 UTF-8、二進位內容拒絕當文字編輯。混合換行檔在編輯後依首選換行形式統一，特殊編碼請用原生編輯器。

每次儲存先比較磁碟內容雜湊，保存上一版本後，以暫存檔 rename 寫入。外部變更約 2.5 秒更新；有未儲存內容時顯示衝突，可「比較」「採用磁碟」「另存草稿」。不會自動強制覆蓋已偵測到的衝突。

Obsidian 不參與本套件的儲存佇列，兩個程式在同一瞬間寫同一檔仍有競態窗口；這不是跨程式交易鎖或 CRDT。iCloud／Dropbox 跨裝置衝突需依同步服務處理。請避免同時編輯同一篇；雲端檔案需先完成下載。

## 開發與發布

```bash
npm ci
npm run build
npm test
npm run test:ui
npm run test:integration
npm run package:vsix
code --profile <名稱> --install-extension ./obbbsidian-0.2.5.vsix --force
```

UI 測試預設使用 macOS Google Chrome；整合測試使用 `/Applications/Visual Studio Code.app` 並建立獨立暫存 profile，不碰使用中的 vault。移到其他平台時調整測試 executable path。

[驗證紀錄](docs/VALIDATION.md) · [相容性與替代操作](docs/COMPATIBILITY.md)

本專案與 Obsidian 無官方關係，未包含 Obsidian 程式碼或商標圖像。

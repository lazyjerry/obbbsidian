# 0.2.3 編輯器配色

- UI 測試讀取實際 computed style，確認 Markdown 標題、語言標記、行內程式碼、符號與連結，在 #1E1E1E／#FFFFFF 背景下的對比至少 4.5:1。
- 驗證深色目前行號底色、即時明暗切換、Undo 與快取頁籤主題同步；截圖保存於 .test-results/theme-dark.png 與 theme-light.png。
- 自訂 VSCode 主題可能覆寫介面背景與文字色；未逐一人工驗證所有主題。

# 0.2.2 最後一個儲存庫保護

- 13 項單元測試涵蓋預設單一儲存庫、最後一個引用拒絕移除、跨 registry 並行移除後仍保留一個，及筆記資料保留。
- UI 驗證單一儲存庫時移除按鈕停用並顯示原因；多個儲存庫仍可移除。
- Extension Host 直接呼叫移除最後一個引用時拒絕，清單保持原引用。
- 測試以暫存資料進行；未人工驗收兩個真實 profile 同時點擊移除。

# 0.2.0 驗證紀錄

環境：2026-09-10、macOS arm64、VSCode 1.136.2。測試資料使用獨立暫存 vault，未修改使用者的 NUEiP 筆記。

## 0.2.0 儲存庫清單驗證

- 裝置清單使用 `~/.obbbsidian/vaults/`，測試以暫存路徑注入 registry，未修改使用者實際清單或筆記。
- 10 項單元測試包含跨 registry 實例讀取、三個並行加入、symlink 去重、重開清單、引用移除後 Markdown 與 `.obsidian` 位元內容保留，以及一次性舊設定轉換／移除後不復活。
- Chrome UI 覆蓋加入第三個儲存庫、切換、移除引用、外部清單變動、清空後停用編輯與重新加入。既有格式、自動儲存與衝突測試保留。
- Extension Host 覆蓋真實檔案的引用移除、移除後拒絕讀取、重新加入後草稿還原、空清單、新建儲存庫與加入既有資料夾。原生選擇器使用受控回傳值，尚未人工操作系統對話框。
- 跨 profile 共用由相同裝置路徑及獨立 registry 實例測試驗證；尚未以兩個真實 profile 視窗同時操作完整 GUI。

## 0.1.4 格式操作驗證

- 修復前 UI 測試確認未開啟筆記的編輯區仍為 `contenteditable="true"`；修復後禁止輸入並顯示選擇筆記提示。
- Chrome UI 測試驗證四種工具列格式、快捷鍵、右鍵指令訊息、保留部分選取文字、取消格式與 Undo 的實際 Markdown 儲存結果。
- 驗證切換 vault 後回到不可編輯狀態；Canvas 不提供 Markdown 右鍵格式選單。
- VSCode Extension Host 驗證四個格式指令將正確訊息傳至 webview；原生右鍵選單的實際展開及使用中 profile 的快捷鍵衝突仍待人工驗收。

## 0.1.3 版面驗證

- 建置與格式檢查通過；沿用 UI 回歸流程，以新的下拉選單驗證共用／私人切換與資料隔離。
- 截圖確認空間選擇、名稱、新增筆記／資料夾、重新整理及齒輪在同一行。
- 本次只調整 webview 與樣式，未重跑儲存層單元測試或 Extension Host 測試；下方結果為先前版本的驗證紀錄。

## 0.1.2 修正驗證

- UI 先重現書籤再次點擊仍無法收合的失敗，再確認修復通過。
- 驗證資訊區塊的重複點擊、關閉按鈕、Escape 收合，以及右側選單的「手動保存」「開啟垃圾桶」入口。
- 實際執行 Finder 開啟系統垃圾桶的指令，exit code 0；未更動垃圾桶內容。
- 自動儲存既有 UI 回歸測試通過；單元測試及 Extension Host 整合測試通過。
- Windows／Linux 的系統垃圾桶指令尚未實機驗證。

## 0.1.1 修正驗證

- 重現閱讀模式按粗體後編輯器仍隱藏的失敗測試，修正後通過。
- UI 實際選取文字，逐一點擊粗體、斜體、標示、連結圖示，斷言儲存結果包含正確語法；重複點擊移除格式。
- 驗證 Graph 入口已移除，Finder 僅在齒輪選單出現；初始化操作傳遞目前 vault 與初始化旗標。
- 檔案測試驗證首次建立筆記補齊 metadata、既有設定逐位元保留，以及重複初始化補回缺少的檔案。

## 已完成

- TypeScript strict typecheck 與 host／webview bundles 建置。
- 8 項單元測試：既有 metadata 逐位元保留、UTF-8 BOM／CRLF、外部衝突、同時儲存佇列、復原版本、路徑／symlink 隔離、wiki 解析、Obsidian Markdown 語法、無效 UTF-8 阻擋。
- Chrome webview UI 自動測試：實際載入發布 bundle，驗證 Markdown、wiki 跳轉、自動儲存、vault 切換隔離、衝突與採用磁碟、KaTeX、Mermaid、Canvas、Bases、CRLF 編輯。
- UI harness 使用 nonce CSP，對齊正式 webview 的 script/style/font 限制。
- VSCode Extension Host 整合測試：套件啟動、底部面板註冊、真實磁碟寫入、衝突拒絕、草稿保存、過期 vault root 拒絕、雙 vault 隔離。
- 畫面截圖檢查：兩欄、分割預覽、頁籤、公式與圖表。

## 驗證限制

- 尚未人工在 Obsidian GUI 與此套件同時編輯 NUEiP 真實資料；metadata 相容性由檔案保留測試佐證。
- 未驗證大型 vault、長時間使用、跨裝置雲端同步、所有 Obsidian 外掛產生的語法。
- GUI 檔案選擇器、垃圾桶確認與附件複製尚未逐項人工驗收。
- UI 測試以同一 webview bundle 加受控 RPC fixture 操作；Extension Host 則另以真正 VSCode API 驗證。未把全部 UI 操作串成正在使用的 profile 端到端測試。
- 本版支援與替代界線以 [COMPATIBILITY.md](COMPATIBILITY.md) 為準。

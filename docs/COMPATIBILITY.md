# Obsidian 相容性與替代操作

此文件描述 **obbbsidian 0.1.3 的實際範圍**。儲存格式相容，不代表全部核心功能、操作與外觀完全一致。CodeMirror 替代方案於開發時提出，未收到使用者選項回覆，先採用可運作的預設方案；以下差異仍需實際使用驗收。

## 格式與設定

| 項目                                | 行為與限制                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| vault                               | 直接使用一般資料夾，不匯入、不轉換；多個可增減引用的根目錄，清單由裝置共用                 |
| `.obsidian`                         | 既有檔案不覆寫；齒輪初始化或首次建立筆記時補齊 `app.json`、`appearance.json` |
| 外掛                                | 不安裝、不執行、不刪除；外掛檔案保留給 Obsidian 使用                         |
| Markdown／附件                      | 原地讀寫；不以 HTML 回轉 Markdown。附件保留原格式                            |
| BOM／換行                           | UTF-8 BOM 保留；LF／CRLF 保留，混合換行在編輯後會統一                        |
| `app.json`                          | 使用 `attachmentFolderPath`；其他選項保留但未套用                            |
| `daily-notes.json`                  | 使用 folder、template、YYYY-MM-DD；其他日期格式提示改以新增筆記操作          |
| `templates.json`                    | 使用 folder；簡單 date/time/title 變數。自訂 Moment 格式未支援               |
| `appearance.json`、themes、snippets | 不載入；改用 VSCode 主題、字型與面板顏色                                     |
| `workspace.json`                    | 不覆寫；本套件目前頁籤／模式用 webview state 記錄，未完整還原所有頁籤        |
| `hotkeys.json`                      | 不套用；快捷鍵遵循 VSCode／CodeMirror                                        |
| 書籤                                | 本套件自己的本機書籤，未讀寫 Obsidian `bookmarks.json`                       |
| 隱藏檔案／symlink                   | 檔案樹不顯示隱藏檔，不跟隨 vault 內 symlink                                  |
| 非 UTF-8／大檔                      | 拒絕文字編輯；使用 VSCode 或外部工具                                         |

## 編輯與呈現替代

| Obsidian 功能    | 本版實作／替代                                    | 差異                                                                                                                   |
| ---------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Live Preview     | CodeMirror decorations                            | 標題、粗斜體、部分 inline code 語法隱藏；游標行顯示原文。表格、公式、callout、嵌入未直接變成可視編輯元件，改用分割預覽 |
| Source mode      | CodeMirror 6 原始碼編輯                           | 支援 Undo／Redo、搜尋、工具列、wiki 補全；非 VSCode TextDocument，VSCode 的一般 Save／Undo 指令不直接管此編輯器        |
| Reading view     | markdown-it + DOMPurify                           | 支援一般 Markdown、表格、刪除線、標示、腳註、task list 顯示                                                            |
| Task list        | 顯示 ☑／☐，原始碼修改 `[x]`                       | 閱讀畫面不直接勾選                                                                                                     |
| Properties       | 可折疊 YAML 顯示，原始碼編輯                      | 未提供 Obsidian 的型別欄位編輯器                                                                                       |
| Wiki links       | 路徑／別名／標題／block 跳轉                      | 同名筆記優先明確路徑與目前資料夾；無法唯一判定會提示。未以 frontmatter aliases 作查找索引                              |
| 重新命名         | 檔案 rename                                       | 不自動改寫其他檔案中的連結；使用者應更新引用                                                                           |
| Markdown links   | 閱讀時跳轉相對路徑                                | 同頁 heading anchor 依原標題匹配，slug 差異可能需用 wiki heading link                                                  |
| 嵌入筆記         | 一層 Markdown 嵌入                                | 不遞迴嵌入；heading 擷取至下一個標題；block 擷取含識別碼的單行，不完整涵蓋多段 block                                   |
| 圖片／音訊／影片 | 圖片內嵌，附件點開可播放音訊／影片                | wiki 圖片尺寸語法未套用；媒體編碼取決於 Chromium                                                                       |
| PDF／其他附件    | 用 VSCode 開啟                                    | 無 Obsidian PDF 內嵌／頁碼／選取引用；VSCode 無適用檢視器時需外部開啟                                                  |
| Callouts         | 引言樣式加類型標題                                | `+`／`-` 折疊行為與所有自訂圖示未重製                                                                                  |
| Comments         | 行內 `%%...%%` 隱藏                               | 多段 comments 不完全等同 Obsidian                                                                                      |
| Math             | KaTeX                                             | 支援常見 inline／block LaTeX；非 MathJax 全部指令                                                                      |
| Mermaid          | Mermaid strict + 清理 SVG                         | 常見圖表可呈現；HTML labels、互動 callback 受限制                                                                      |
| HTML             | 經 DOMPurify 清理                                 | script、iframe、style 等不執行／不套用                                                                                 |
| Canvas           | 節點位置、文字、檔案連結、簡單線段檢視；JSON 編輯 | 沒有拖曳編輯、縮放、連線端點樣式與完整 group 操作；原 `.canvas` 未轉換                                                 |
| Bases            | YAML 定義檢視／原始碼編輯                         | 未執行 filters、formulas、table/cards views；要使用資料庫視圖請在 Obsidian 開啟同一 `.base`                            |

## 核心功能對照

參考指定 NUEiP vault `.obsidian/core-plugins.json` 的啟用項目；設定檔本身不收錄至發布包。

| 核心功能                                       | 本版狀態                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| File explorer                                  | 兩欄面板左側檔案樹、新增筆記／資料夾；重新命名與垃圾桶限目前開啟檔案。未提供資料夾移動／拖曳                                        |
| Global search／Switcher                        | 左欄搜尋檔名與全文；目前無獨立 Quick Switcher 對話框                                                                                |
| Graph                                          | 依需求移除，不提供此功能                                                                                                            |
| Backlinks／Outgoing links                      | 大綱面板列出 wiki 反向／向外連結；未索引普通 Markdown links 或 unlinked mentions                                                    |
| Tags                                           | Markdown 文本中的 hashtag 清單；未索引 YAML tags，尚未完全排除 code block 中的 hashtag                                              |
| Properties／Canvas／Bases                      | 見上方替代方式                                                                                                                      |
| Page preview                                   | 以點擊開啟／分割預覽替代；無 hover preview                                                                                          |
| Daily notes／Templates                         | 常見日期與範本流程；自訂格式有限制                                                                                                  |
| Note composer                                  | 使用剪下／貼上與新增筆記替代；無合併／抽取指令                                                                                      |
| Command palette                                | VSCode Command Palette + 面板按鈕                                                                                                   |
| Editor status／Word count                      | 顯示字元數與空白切分詞數；中文詞數與 Obsidian 不同                                                                                  |
| Bookmarks                                      | 本機獨立書籤                                                                                                                        |
| Outline                                        | Markdown ATX headings；不完整支援 Setext headings，code fence 中的 heading 可能被列入                                               |
| File recovery                                  | 每次有效儲存保存上一版 JSON；從套件 globalStorage/recovery 手動取回 text，選單改為開啟系統垃圾桶。無 Obsidian 的復原 UI／保留期清理 |
| Sync                                           | 使用 iCloud／Dropbox 等檔案同步；不實作 Obsidian Sync 帳號與傳輸協定                                                                |
| Publish／Slides／Audio recorder／Workspaces 等 | 本版未實作；指定 vault 也未啟用其中多數功能                                                                                         |

## 同時開啟的界線

套件不動既有 Obsidian metadata 與外掛，可交替開啟同一 vault。已偵測到的外部內容變更會阻擋舊版本儲存，草稿留在 VSCode 本機；使用者決定採用磁碟或另存副本。

檔案系統沒有與 Obsidian 協調的 compare-and-swap，因此最後一次雜湊比較與 rename 間仍存在極短競態；不宣稱同一檔案跨程式同時寫入零衝突。雲端 placeholder 必須完成下載。本版搜尋採逐檔掃描，大型 vault 的效能尚未驗證。

## 參考資料

- [Obsidian Flavored Markdown](https://obsidian.md/help/obsidian-flavored-markdown)
- [Configuration folder](https://obsidian.md/help/configuration-folder)
- [Views and editing mode](https://obsidian.md/help/edit-and-read)
- [VSCode Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [CodeMirror decorations](https://codemirror.net/examples/decoration/)

以上官方文件用來確認格式與介面界線；支援狀態以本專案程式與測試為準。

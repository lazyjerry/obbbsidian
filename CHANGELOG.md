# Changelog

本檔依 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/) 格式記錄；版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。0.2.5 以前的變更見 README 各版「更新」段落。

## 0.2.7 - 2026-09-19

安全性修正。

### Security

- 筆記、嵌入與 Canvas 卡片共用同一份 DOMPurify 設定：移除 `<style>`、`style` 屬性、`iframe`、`object`、`form`，防止以透明圖層點擊劫持。Canvas 卡片原本使用預設設定。
- 預覽內容的 `id`／`name` 加上 `user-content-` 前綴（DOMPurify `SANITIZE_NAMED_PROPS`），筆記標題或原始 HTML 無法覆蓋面板元件；標題錨點、大綱、註腳跳轉同步調整。
- 外部連結只接受經 DOMPurify 驗證的 `<a href>`；`data-note`（原始 HTML、Canvas 檔案節點）只當 vault 內部連結。`[[https://…]]` 等網址 wikilink 改輸出 `href`，行為不變。
- 開啟 `obsidian:` 連結前以 modal 顯示完整 URI 並要求確認；`http`／`https`／`mailto` 不變。
- `obbbsidian.dataFolder`、`obbbsidian.privateDataFolder` 改為 `application` scope，工作區設定無法指定舊路徑；宣告 `capabilities.untrustedWorkspaces.supported: false`。

### Added

- `obbbsidian.allowRemoteImages` 設定（預設 `true`）：設為 `false` 時 CSP 的 `img-src` 移除 `https:`，避免遠端圖片追蹤。
- Markdown 連結 `[文字](obsidian://…)` 可開啟（經確認）；原本 href 會被清除。

### Changed

- 復原版本檔名加上筆記鍵；每份筆記保留最近 50 份，超過 30 天刪除，於啟動與每次儲存時清理。
- 草稿記錄所屬 vault 與路徑；啟動時只刪除「對應筆記已不存在」或「內容與磁碟相同」的草稿，舊格式草稿保留。
- 嵌入筆記（`![[筆記]]`）中的公式改以 KaTeX 重建顯示；原本樣式被清除後排版錯亂。

## 0.2.6 - 2026-09-19

### Changed

- webview bundle 改為 minify：`media/main.js` 9.66 MB → 4.36 MB，VSIX 2.84 MB → 2.26 MB。功能不變。

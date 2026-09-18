#!/usr/bin/env bash
# 本機 VSIX 交付：測試 → 打包 → 產生 .sha256 → 安裝到指定 profile。
# 不改版本號、不上架 Marketplace；版本號先在 package.json 改好再跑。
#
#   ./scripts/release-local.sh              # 安裝到 Default profile
#   ./scripts/release-local.sh <profile>    # 安裝到指定 profile
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
profile="${1:-}"

command -v code >/dev/null 2>&1 || { echo "release-local: 找不到 code CLI" >&2; exit 1; }

echo "==> 建置與測試"
npm run build
npm test
npm run test:ui
npm run test:integration

echo "==> 打包 vsix"
npm run package:vsix

read_field() { node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync("package.json","utf8"))[process.argv[1]]));' "$1"; }
vsix="$(read_field name)-$(read_field version).vsix"
[ -f "$vsix" ] || { echo "release-local: 找不到 $vsix" >&2; exit 1; }

shasum -a 256 "$vsix" > "$vsix.sha256"
shasum -a 256 -c "$vsix.sha256"

echo "==> 安裝到 profile ${profile:-Default}"
code ${profile:+--profile "$profile"} --install-extension "./$vsix" --force

printf '==> 完成：%s（%s bytes）\n' "$vsix" "$(stat -f %z "$vsix")"
echo "    已開啟的視窗需執行 Developer: Reload Window。"

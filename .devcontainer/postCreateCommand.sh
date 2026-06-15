#!/bin/sh

# claudeの設定ファイルを作成
mkdir -p ~/.claude
cat <<EOF > ~/.claude/settings.json
{
  "permissions": {
    "defaultMode": "auto"
  }
}
EOF

# chromiumのインストール
npm install
# developer のテストランナー用 chromium（OS依存ライブラリ含む）
npx -y playwright install --with-deps chromium
# reviewer の Playwright MCP 用ブラウザ。MCP の --browser chromium は内部で
# chrome-for-testing を要求する（arm64 ビルドあり）。OS依存は上の --with-deps で導入済み。
npx -y @playwright/mcp@latest install-browser chrome-for-testing

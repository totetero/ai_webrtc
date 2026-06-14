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
npx -y playwright install --with-deps chromium

#!/bin/sh

# chromiumのインストール
npm install
npx -y playwright install --with-deps chromium

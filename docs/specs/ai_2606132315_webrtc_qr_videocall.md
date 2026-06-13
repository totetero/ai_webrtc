# 仕様書: サーバレス WebRTC ビデオ通話（QR接続）アプリ

- 仕様ID: `ai_2606132315_webrtc_qr_videocall`
- 作成日: 2026-06-13
- ベース設計書: `docs/superpowers/specs/2026-06-13-webrtc-qr-videocall-design.md`
- ステータス: 開発着手可（実装担当へ引き継ぎ）

---

## 1. 背景 / 目的

2台のスマホで、親子（ユーザーと娘）が手軽にテレビ電話で遊ぶための **サーバレス** な WebRTC ビデオ通話アプリ。
シグナリングサーバを一切持たず、接続情報（SDP）の交換を **QRコード** で行う。2台は同じ家の同じWiFiに繋いで使う想定のため NAT越えは不要で、host候補のみで直接P2P接続する。

このアプリで「やりたいこと」は次の一点に集約される:

> 2台のスマホで、QRを互いに読み合うだけで、双方向のビデオ通話ができる。サーバは静的ホスティング（GitHub Pages）以外に使わない。

---

## 2. 前提・確定事項

| 項目 | 確定内容 |
|---|---|
| ネットワーク | 2台は **同一WiFi（同一LAN）内**。NAT越え中継不要。STUN/TURNは使わない（`iceServers: []`） |
| 候補種別 | **host候補のみ** で直接P2P |
| ICE方式 | **non-trickle**。`icegatheringstate === 'complete'` まで待ってSDPを確定してからQR化 |
| ホスティング | ビルド済み静的ファイルを **GitHub Pages** に配信（カメラ起動にHTTPSが必須なため。バックエンドは無し） |
| シグナリング | **QRコードで2往復**。発信側/応答側が互いの画面のQRをカメラで1回ずつ読み合う |
| 機能範囲 | 最小構成: **双方向ビデオ+音声**、**自分プレビュー**、**通話終了** のみ |
| QR化方式 | **方式A（単一QR + 圧縮）**。SDP最小化 → deflate(pako) → base64url を1枚のQRに収める。分割QRフォールバックは実装しない |
| 基盤 | 既存の **React 19 + TypeScript + Vite** をそのまま使用。ルーティング無しの単一画面アプリ |

---

## 3. 機能要件

実装可能な粒度に分解する。各項目は受け入れ条件（章9）と対応する。

### 3.1 ロール選択（idle）
- FR-01: 起動直後に「発信」「応答」の2ボタンを表示する。
- FR-02: いずれか選択時に `getUserMedia({ video: true, audio: true })` でカメラ/マイクを取得し、取得成功で次フェーズへ進む。
- FR-03: 権限拒否・デバイス不在時はエラーメッセージを表示し idle に留まる（章7）。

### 3.2 WebRTC握手（webrtc.ts）
- FR-04: `RTCPeerConnection` を `{ iceServers: [] }` で生成する（STUN/TURNなし＝host候補のみ）。
- FR-05: ローカルの全トラック（video/audio）を `addTrack` で追加する。
- FR-06: 発信側は `createOffer` → `setLocalDescription`、応答側は `createAnswer` → `setLocalDescription` を行う。
- FR-07: `setLocalDescription` 後、`icegatheringstate === 'complete'` になるまで待ってから `localDescription`（host候補を含む完成SDP）を確定する（non-trickle）。
  - 待機は `icegatheringstatechange` 監視と、最大待機 5 秒のフォールバックタイマーを併用する。
- FR-08: `ontrack` でリモート `MediaStream` を公開する（コールバックまたは取得用API）。
- FR-09: `connectionstatechange` を購読し、`connected` / `disconnected` / `failed` / `closed` を上位へ通知する。
- FR-10: `close()` で PeerConnection を閉じ、ローカル/リモート両方の全トラックを `stop()` する。

### 3.3 シグナリング変換（signaling.ts）
- FR-11: SDP文字列を受け取り **最小化** する。最小化は「host候補以外の `a=candidate` 行（srflx/relay/prflx 等）を除去」「不要な空行を整理」程度の、SDPの意味を壊さない範囲に限定する。最小化の結果をブラウザが `setRemoteDescription` できることを保証する。
- FR-12: `encode(type, sdp)` は最小化済みSDPを **deflate圧縮(pako) → base64url** し、`{ t, d }`（`t`: `"o"`(offer)/`"a"`(answer)、`d`: 圧縮文字列）の形にして、全体をさらに base64url 化した **単一文字列** を返す。
- FR-13: `decode(payload)` は FR-12 の逆変換を行い `{ type: "offer"|"answer", sdp: string }` を返す。不正・破損文字列に対しては例外を投げる（呼び出し側で握る）。
- FR-14: `encode` → `decode` は **往復一致**する（type一致・SDPは setRemoteDescription 可能な等価文字列）。

### 3.4 QR生成・読取（qr.ts）
- FR-15: `qrcode` でペイロード文字列からQR画像（canvas/dataURL）を生成する。誤り訂正レベルとサイズは、方式Aの想定ペイロード長を1枚に収められる値にする（実装側で `errorCorrectionLevel: 'L'` を起点に調整可）。
- FR-16: `jsqr` でカメラ映像フレーム（`<video>` → `<canvas>` → `ImageData`）からQRをデコードする。`requestAnimationFrame` ループで毎フレーム試行し、検出した文字列を返す。
- FR-17: スキャン用カメラ映像は背面カメラ（`facingMode: 'environment'` 優先）を要求する。通話用の自分映像取得とは別ストリームでよい。

### 3.5 状態マシン / フロー（App.tsx）
- FR-18: 単一の `phase` state で以下を遷移管理する。

```
idle ──「発信」──▶ creatingOffer ──▶ showOfferQR ──▶ scanningAnswer ──▶ inCall ──▶ ended
  │                                                                          ▲
  └──「応答」──▶ scanningOffer ──▶ creatingAnswer ──▶ showAnswerQR ──────────┘
```

- FR-19（発信側A）:
  1. idle で「発信」→ getUserMedia（自分プレビュー表示）
  2. creatingOffer: PeerConnection生成 → トラック追加 → createOffer → ICE収集完了待ち
  3. showOfferQR: 確定SDPを `encode("offer", sdp)` → **QR①** 表示
  4. scanningAnswer: カメラでBの **QR②** を読む → `decode` → `setRemoteDescription`
  5. `connectionState === 'connected'` → inCall
- FR-20（応答側B）:
  1. idle で「応答」→ getUserMedia
  2. scanningOffer: カメラでAの **QR①** を読む → `decode` → `setRemoteDescription`
  3. creatingAnswer: createAnswer → ICE収集完了待ち
  4. showAnswerQR: `encode("answer", sdp)` → **QR②** 表示
  5. Aが読み取り接続確立 → inCall
- FR-21: 読み取ったQRの種別（`t`）が現在フェーズの期待と異なる場合（例: 応答待ちなのにofferQR）は無視してスキャン継続し、ヒントを表示する。

### 3.6 通話画面（CallView）
- FR-22: 相手の映像を全面、自分プレビューを隅に小さく表示する。
- FR-23: 下部に「通話終了」ボタンを1つだけ置く。押下で `webrtc.close()` → ended → idle に戻れる。
- FR-24: 自分プレビューの `<video>` は `muted`（ハウリング防止）。相手映像は音声あり。

### 3.7 iOS Safari 対策（スマホ前提で必須）
- FR-25: 全ての `<video>` に `playsinline`・`autoplay` を付与。自分プレビューは `muted` も付与。
- FR-26: 相手映像の `play()` は通話開始のユーザー操作（ボタンタップ）起点で呼ぶ（自動再生ブロック回避）。

### 3.8 デバッグフック（テスト容易化）
- FR-27: URLに `?debug=1` がある場合、QR表示画面に **現在のペイロード文字列をテキスト表示/コピー** でき、スキャン画面では **ペイロード文字列を直接貼り付ける入力欄** を表示する。これによりカメラ無しで握手全体を検証できる。
- FR-28: デバッグフックは `?debug=1` が無い通常時には一切表示されない。

---

## 4. 非機能要件・制約

- NFR-01: 依存追加は **`qrcode`・`jsqr`・`pako`**（および各 `@types/*` が必要なら devDependencies）に限定する。
- NFR-02: テスト基盤として **`vitest`**（ユニット）と **`@playwright/test`**（結合, Chromium）を devDependencies に追加する。
- NFR-03: GitHub Pages 配信のため **`vite.config.ts` に `base` を設定**する。リポジトリ名でのサブパス配信（例 `/ai_webrtc/`）を前提に、`base: '/ai_webrtc/'` を基本値とする（Pages設定に合わせ実装担当が確定）。
- NFR-04: GitHub Pages へデプロイする **GitHub Actions ワークフロー**（`.github/workflows/deploy.yml`）を追加する。`npm ci` → `npm run build` → `dist` を Pages にデプロイ。push(main) トリガ。
- NFR-05: TypeScript の `lib` にWebRTC/Iterable型が不足する場合は `tsconfig.app.json` の `lib` に `DOM.Iterable` を追加してよい（最小変更）。
- NFR-06: ビルドは `npm run build`（`tsc -b && vite build`）が型エラー無しで通ること。`npm run lint` がパスすること。
- NFR-07: 既存の単一画面構成・React 19 StrictMode 構成を壊さない。StrictMode の二重マウントで getUserMedia/PeerConnection が多重生成・リークしないよう、effect のクリーンアップを実装する。
- NFR-08: 圧縮後ペイロードは方式A前提でQR1枚（QR Version 40 / レベルLの英数字・バイナリ容量内）に収まること。収まらない場合のフォールバックはスコープ外（章8）。

---

## 5. 影響範囲（対象ファイル）

新規追加:
- `src/webrtc.ts`（RTCPeerConnection ラッパ）
- `src/signaling.ts`（SDP ⇄ ペイロード変換）
- `src/qr.ts`（QR生成・読取）
- `src/components/RoleSelect.tsx`
- `src/components/QRDisplay.tsx`
- `src/components/QRScanner.tsx`
- `src/components/CallView.tsx`
- `src/signaling.test.ts`（vitest 往復一致）
- `tests/handshake.spec.ts`（Playwright ループバック結合）
- `.github/workflows/deploy.yml`（GitHub Pages デプロイ）
- `playwright.config.ts`（Chromium / fake media フラグ設定）

変更:
- `src/App.tsx`（状態マシン・フロー制御に全面書き換え）
- `src/App.css` / `src/index.css`（通話レイアウト・モバイル向けスタイル）
- `package.json`（依存追加・`test` / `test:e2e` スクリプト追加）
- `vite.config.ts`（`base` 設定／必要なら vitest 設定）
- `tsconfig.app.json`（必要なら `lib` に `DOM.Iterable` 追加）
- `index.html` / `public/`（タイトル・favicon 等、任意）

影響しない:
- `.claude/`、`docs/`（本仕様書を除く）、`.devcontainer/` 等の運用系。

---

## 6. データ仕様

### 6.1 QRペイロード
- エンコード対象: 最小化済みSDP文字列。
- 中間表現: `{ t: "o" | "a", d: <deflate(pako)した最小化SDP を base64url 化した文字列> }`
- QRに載せる最終文字列: 上記オブジェクトを `JSON.stringify` → deflate せずに base64url 化、もしくは実装簡素化のため「`t` を1文字プレフィックスにして本体を連結」する単純形式でもよい（**`encode`/`decode` が往復一致すれば内部形式は実装裁量**）。
- 種別判定: 読み取り側は `t`（offer/answer）で誤種別QRを弾く（FR-21）。

### 6.2 SDP最小化のルール（FR-11詳細）
- 除去対象: host以外の `a=candidate:`（typ srflx/relay/prflx）行。STUN/TURN無しなので本来出ないが念のため除去。
- 保持: m= / c= / a=fingerprint / a=ice-ufrag / a=ice-pwd / a=setup / a=mid / a=rtpmap 等、setRemoteDescription に必須な行は保持。
- 不可逆な行削減（rtpmap 大量削減等）は **行わない**（互換性リスクを避け、deflate圧縮で容量を稼ぐ方針）。

---

## 7. エラー処理

| 事象 | 挙動 |
|---|---|
| カメラ/マイク権限拒否・デバイス不在 | 「カメラとマイクを許可してください」を表示し idle に留まる |
| QR読取が誤種別 | 無視してスキャン継続＋ヒント表示（FR-21） |
| QRデコード失敗（ピンぼけ等） | 黙ってスキャン継続（毎フレーム試行） |
| `setRemoteDescription` / `decode` 例外 | 「QRが読み取れませんでした」を表示しスキャン継続 |
| 接続が30秒確立しない | タイムアウト表示 →「やり直す」で idle へ |
| 接続途中で切断（disconnected/failed） | 「切断されました」表示 → idle へ |
| ペイロードがQR容量超過 | 「同じWiFiに接続して再試行」を表示（方式A前提でほぼ起きない） |

---

## 8. スコープ外（YAGNI）

- STUN/TURN、別ネットワーク間接続
- ミュート/カメラ切替/カメラOFF 等の通話中操作
- 分割QR（パラパラQR）フォールバック
- 3人以上の通話、通話履歴、チャット

---

## 9. 受け入れ条件

確認担当が動作確認に使う具体チェック項目。自動テストで担保できるものは自動を基本とする。

### 9.1 ビルド・静的検査
- AC-01: `npm install`（依存追加後）が成功する。
- AC-02: `npm run build` が型エラー無しで成功し `dist/` が生成される。
- AC-03: `npm run lint` がパスする。

### 9.2 ユニットテスト（vitest）
- AC-04: `npm run test`（vitest）が成功する。
- AC-05: `signaling.test.ts` で、代表的なoffer/answer SDPに対し `decode(encode(type, sdp))` の `type` が一致し、`sdp` が setRemoteDescription 可能な等価文字列であること（往復一致）を検証している。

### 9.3 結合テスト（Playwright + Chromium / fake media）
- AC-06: Playwright を Chromium で `--use-fake-device-for-media-stream`・`--use-fake-ui-for-media-stream` 付きで起動する設定がある。
- AC-07: `tests/handshake.spec.ts` が、`?debug=1` のデバッグフック経由（QRを介さずペイロード直貼り）で、1ブラウザ内に発信/応答の2系統（または2タブ）を作り、握手 → 双方が `connected` まで到達することを検証して **パスする**。
  - もしくは webrtc.ts/signaling.ts を直接用い、1ページ内で2つの PeerConnection をループバック接続して `connected` 到達を検証してもよい。
- AC-08: `npm run test:e2e`（Playwright）が成功する。

### 9.4 手動 / UI 確認（確認担当が `?debug=1` で実施可能）
- AC-09: `npm run dev` 起動後、`/?debug=1` で「発信」を押すと、カメラ許可ダイアログ（fake環境では自動許可）後に **QR①** とそのペイロード文字列が表示される。
- AC-10: 別タブ `/?debug=1` で「応答」を押し、AC-09のペイロードを貼り付けると **QR②**／ペイロードが表示される。
- AC-11: AC-10のペイロードを発信側タブの貼り付け欄に入れると、両タブが通話画面（相手映像＋自分プレビュー＋「通話終了」ボタン1つ）に遷移する。
- AC-12: 「通話終了」を押すと両者のトラックが停止し idle に戻れる（カメラのインジケータが消える／再度発信できる）。
- AC-13: `?debug=1` が無い通常URLでは、ペイロード直貼り入力やペイロード表示が一切現れない。

### 9.5 最終受入（実機・スコープ外の自動化）
- AC-14（参考・手動）: 2台のスマホを同一WiFiに繋ぎ、QRを読み合って双方向通話できることを実機確認。自動化対象外。

---

## 10. 未解決の確認事項（呼び出し元へ）

判断材料が無いと最終確定できない点。いずれも **デフォルト値で実装を進められる** ため停止は不要だが、確認が取れれば差し替える:

- Q1: GitHub Pages の配信パス。`base` のデフォルトをリポジトリ名から `'/ai_webrtc/'` と仮定する。ユーザー独自ドメインやリポジトリ名変更があれば要調整。
- Q2: GitHub Pages のデプロイ方式（Actionsデプロイ前提でワークフローを追加する。Pages設定が「GitHub Actions」ソースであることを前提）。

# サーバレス WebRTC ビデオ通話（QR接続）設計書

作成日: 2026-06-13

## 目的

2台のスマホで、親子（ユーザーと娘）が手軽にテレビ電話で遊ぶための、**サーバレス**なWebRTCビデオ通話アプリ。接続情報の交換はQRコードで行う。

## 前提・制約（確定事項）

- **ネットワーク**: 2台は**同じWiFi内（同じ家）**で使う。よってNAT越えの中継は不要で、host候補のみで直接P2P接続できる。STUN/TURNは使わない（完全サーバレス）。
- **ホスティング**: ビルド済み静的ファイルを **GitHub Pages** に置く（カメラ起動にHTTPSが必須なため、配信用の静的ホスティングだけは利用する。バックエンド・シグナリングサーバは無し）。
- **接続フロー**: サーバ無しWebRTCの握手は2往復のため、**QRのやり取りは2回**。発信側/応答側を選び、互いの画面のQRを1回ずつカメラで読み合う。
- **機能**: 最小構成。**双方向のビデオ+音声**と**通話終了**のみ。自分のカメラ確認用に小さな自分プレビューだけ標準で表示。ミュート/カメラ切替等の追加ボタンは入れない。
- **SDPのQR化方式**: 採用方式は **A（単一QR + 圧縮）**。SDPを最小化しhost候補のみに絞り、deflate圧縮して1枚のQRに収める。分割QR等のフォールバックは今回は実装しない（必要になったら後から追加可能）。

## 全体アーキテクチャ

- 既存の **React 19 + TypeScript + Vite** をそのまま使用。ルーティング不要の単一画面アプリ。
- GitHub Pages に静的デプロイ。

### 追加ライブラリ

- `qrcode` — QR生成
- `jsqr` — カメラ映像フレームからQRデコード（getUserMediaは自前管理し通話用と共用しやすくする）
- `pako` — SDPのdeflate圧縮

### モジュール分割（各々が単一責務・独立テスト可能）

| モジュール | 責務 | 依存 |
|---|---|---|
| `src/webrtc.ts` | RTCPeerConnectionのラッパ。getUserMedia、offer/answer生成、ICE収集完了まで待つ（non-trickle）、リモートstream公開、接続状態イベント、切断 | ブラウザWebRTC API |
| `src/signaling.ts` | SDP ⇄ QRペイロード変換。SDP最小化 → deflate(pako) → base64url、およびその逆 | pako |
| `src/qr.ts` | QR生成（qrcode）、カメラフレームからQR読取（jsqr） | qrcode, jsqr |
| `src/App.tsx` | 状態マシンでフロー制御 | 上記すべて |
| `src/components/RoleSelect.tsx` | 発信/応答の選択画面 | — |
| `src/components/QRDisplay.tsx` | QR表示画面 | qr |
| `src/components/QRScanner.tsx` | カメラでQR読取する画面 | qr, webrtc(stream) |
| `src/components/CallView.tsx` | 通話画面（相手映像＋自分プレビュー＋通話終了） | webrtc |

### サーバレスの肝

- `RTCPeerConnection` を `iceServers: []`（STUN/TURNなし）で生成 → host候補のみ。
- ICE収集は `icegatheringstate === 'complete'` まで待ってからSDPを確定し、QR化する（trickleしない）。

## 状態マシンと接続データフロー

`App.tsx` が単一の `phase` state で管理する。

```
idle ──「発信」──▶ creatingOffer ──▶ showOfferQR ──▶ scanningAnswer ──▶ inCall ──▶ ended
  │                                                                        ▲
  └──「応答」──▶ scanningOffer ──▶ creatingAnswer ──▶ showAnswerQR ────────┘
```

### 発信側(A)の流れ

1. `idle` で「発信」→ getUserMedia でカメラ/マイク取得（自分プレビュー表示）
2. `creatingOffer`: PeerConnection生成 → トラック追加 → `createOffer` → ICE収集完了まで待つ
3. `showOfferQR`: 確定SDPを `signaling.encode()` → **QR①** 表示
4. `scanningAnswer`: カメラでBの**QR②**を読む → `signaling.decode()` → `setRemoteDescription`
5. 接続確立（`connectionState === 'connected'`）→ `inCall`

### 応答側(B)の流れ

1. `idle` で「応答」→ getUserMedia
2. `scanningOffer`: カメラでAの**QR①**を読む → `setRemoteDescription`
3. `creatingAnswer`: `createAnswer` → ICE収集完了まで待つ
4. `showAnswerQR`: **QR②** 表示
5. Aが読み取ると接続確立 → `inCall`

### QRペイロードの形

- `{ t: "offer" | "answer", sdp: <deflate + base64url 圧縮文字列> }` を更にbase64url化した1文字列をQRにする。
- 読み取り側は `t` で種別を判定し、誤ったQR（例: 応答待ちなのにオファーQR）を弾く。

### inCall画面

- 相手の映像を全面、自分プレビューを隅に小さく表示、下部に「通話終了」ボタン1つ。
- 終了で `pc.close()` + 全トラック停止 → `ended` → `idle` に戻れる。

## エラー処理

| 事象 | 挙動 |
|---|---|
| カメラ/マイク権限拒否 | 「カメラとマイクを許可してください」を表示し `idle` に留まる |
| QR読取が誤種別（応答待ちにオファーQR等） | 無視してスキャン継続＋ヒント表示 |
| QRデコード失敗（ピンぼけ等） | 黙ってスキャン継続（毎フレーム試行） |
| 接続が一定時間（30秒）確立しない | タイムアウト表示 →「やり直す」で `idle` へ |
| 接続途中で切断（`disconnected` / `failed`） | 「切断されました」表示 → `idle` へ |
| SDPがQR容量超過（方式A前提でほぼ起きない） | 「同じWiFiに接続して再試行」を表示 |

### iOS Safari対策（スマホ前提で必須）

- `<video>` には `playsinline muted autoplay` を付与。
- 映像再生はユーザー操作起点（ボタンタップ）で `play()` を呼ぶ。
- 自分プレビューは `muted`（ハウリング防止）。

## テスト方針

- **ユニット（vitest）**: `signaling.ts` のエンコード/デコード往復一致テスト。SDP最小化が壊れないこと。
- **自動結合（Playwright + Chromium）**: `--use-fake-device-for-media-stream` でカメラ/マイクを擬似化。1ページ内で2つのRTCPeerConnectionをループバック接続し、握手 → `connected` まで到達することを検証。
- **テスト容易化フック**: QRの代わりにペイロード文字列を直接貼り付けられる隠しデバッグ入力を用意（`?debug=1` 等）。カメラ無しで握手全体を自動テスト＆手動デバッグできるようにする。実機QRスキャンの自動化は困難なため、この経路で握手ロジックを担保する。
- **最終受入**: 2台のスマホを同じWiFiに繋ぎ、QRを読み合って通話できることを実機確認。

## スコープ外（YAGNI）

- STUN/TURN、別ネットワーク間接続
- ミュート/カメラ切替/カメラOFF等の通話中操作
- 分割QR（パラパラQR）フォールバック
- 3人以上の通話、通話履歴、チャット

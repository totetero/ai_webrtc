# 複数QR分割表示・自動収集 設計書

- 日付: 2026-06-14
- 対象: サーバレス WebRTC ビデオ通話（QR接続）アプリ
- 関連: [2026-06-13-webrtc-qr-videocall-design.md](2026-06-13-webrtc-qr-videocall-design.md)

## 1. 背景と課題

接続用 QR の「マス目が細かすぎて（高密度すぎて）読み取れない」事象が発生した。原因は
1枚の QR に SDP 由来のペイロード全体を詰め込み、QR のバージョン（モジュール数）が
高くなっていること。物理サイズではなくデータ量が問題であるため、「データ量を分割して
1枚あたりの密度を下げる」ことで解決する。

## 2. 目的

ペイロードを複数フレームに分割し、各 QR の密度を一定以下に保ったまま、
表示・読み取りを自動化して接続できるようにする。

- 1枚あたりのデータ量に上限を設け、SDP が長くても QR 密度が一定以下に保たれること。
- 表示側は分割 QR を自動で循環表示する。
- 読取側はカメラを向けて待つだけで全フレームを自動収集し、元のペイロードを復元する。

## 3. スコープ

### 対象
- ペイロードのフレーム分割・組み立て層の新設（`src/signaling.ts`）。
- 分割 QR の自動循環表示（`src/components/QRDisplay.tsx`）。
- フレームの自動収集・進捗表示・復元（`src/components/QRScanner.tsx`）。

### 非対象（変更しない）
- `encode()` / `decode()`（SDP ↔ フル文字列の変換ロジック）。
- App.tsx の通話フロー・状態遷移・各種ハンドラ。
- SDP の最小化方針・圧縮方式（base64url + deflate のまま）。
- `?debug=1` のフル文字列の表示／貼り付け仕様。

## 4. 全体方針

`encode()` が返すフル文字列（先頭1文字が type タグ + deflate 済み SDP の base64url）を
**フレーム単位に分割**する層を新設する。表示側は分割した QR を 1 枚ずつ自動循環表示し、
読取側はフレームを自動収集して**元のフル文字列に復元**してから既存の `decode()` に渡す。

これにより `encode()` / `decode()` と App.tsx は無変更で済み、影響範囲を
「フレーム層 + 2つの表示/読取コンポーネント」に限定する。

```
[表示側]  SDP --encode()--> フル文字列 --buildFrames()--> [frame, frame, ...] --QR循環表示
[読取側]  QR走査 --> frame --FrameCollector--> (全部そろう) --> フル文字列 --decode()--> SDP
```

## 5. フレーム形式

1 フレーム = 1 つの QR の中身。書式:

```
${sid}.${idx}.${total}.${body}
```

| フィールド | 内容 |
| --- | --- |
| `sid`  | 生成ごとのセッションID。4文字、`[a-z0-9]`（`crypto.getRandomValues` 由来）。同一生成のフレームだけを結合するための識別子。 |
| `idx`  | フレーム番号（1始まり）。表示の「2/3」に直結。 |
| `total`| フレーム総数。 |
| `body` | フル文字列を等分した一部（base64url 文字のみ）。 |

- 区切り文字 `.` は base64url の文字集合（`A-Za-z0-9-_`）に含まれないため、`body` と衝突しない。
  パースは先頭から 3 つの `.` までを `sid` / `idx` / `total` とし、残り全体を `body` とする
  （`body` 自体は `.` を含まない）。
- `total === 1`（分割不要の短いペイロード）でも同じ書式で 1 フレームに包み、
  読取経路を一本化する。

## 6. 分割粒度

- 定数 `MAX_FRAME_BODY` を `body` の最大文字数の上限とする。初期値 **180**
  （QR バージョン約 8・49×49 マス相当を目安）。
- フレーム数 = `Math.ceil(payload.length / MAX_FRAME_BODY)`。各フレームの `body` 長は
  なるべく均等に分配する。
- `MAX_FRAME_BODY` は `src/signaling.ts` 内の 1 箇所の定数とし、実機検証後に
  「もっと粗く／細かく」を調整できるようにする。

## 7. モジュール設計

### 7.1 `src/signaling.ts`（フレーム層を追加。既存関数は不変）

新規エクスポート:

- `MAX_FRAME_BODY: number` — `body` の最大文字数（初期値 180）。
- `newSessionId(): string` — 4 文字のセッションID（`crypto.getRandomValues` 由来、`[a-z0-9]`）。
- `buildFrames(payload: string, sid: string, maxBody?: number): string[]`
  - フル文字列を `maxBody`（既定 `MAX_FRAME_BODY`）以内に分割し、フレーム文字列配列を返す。
  - 空文字列は不正入力として例外を投げる。
- `parseFrame(s: string): { sid: string; idx: number; total: number; body: string } | null`
  - 書式・数値妥当性（`1 <= idx <= total`、`total >= 1`）を検証し、不正なら `null`。
- `class FrameCollector`
  - `add(frame: string): void` — フレーム文字列を投入。
    - `parseFrame` で不正と判定したフレームは無視する。
    - 収集中の `sid` と異なる `sid` のフレームが来たら、収集状態をリセットして新しい
      `sid` を採用する（古い／別セッションのフレーム混入を防ぐ）。
    - 同一 `idx` の重複投入は冪等（上書き）。
  - `progress: { received: number; total: number } | null` — 進捗（未受信時は `null`）。
  - `isComplete(): boolean` — 現在の `sid` の全 `idx`（1..total）がそろったか。
  - `result(): string | null` — 完成していれば `idx` 昇順で `body` を連結したフル文字列、
    そうでなければ `null`。
  - `reset(): void` — 収集状態を破棄。

### 7.2 `src/components/QRDisplay.tsx`

- `payload` から `newSessionId()` + `buildFrames()` でフレーム配列を生成する
  （payload が変わったときのみ再生成）。
- `setInterval`（既定 `CYCLE_INTERVAL_MS = 700`、コンポーネント内定数）で表示フレームを
  1 枚ずつ循環させる。各フレーム文字列を `generateQrDataUrl()` で QR 化して表示。
  - 生成負荷を避けるため、全フレームの dataURL は初回にまとめて生成し配列保持する。
- 「`idx` / `total`」インジケータと進捗ドットを表示する。
- フレームが 1 枚（`total === 1`）のときも循環ロジックはそのまま（1 枚を表示し続ける）。
- `?debug=1` のデバッグボックスは**従来どおりフル文字列**を表示する（変更なし）。
- アンマウント／payload 変更時に `setInterval` を確実に解除する。

### 7.3 `src/components/QRScanner.tsx`

- `FrameCollector` をコンポーネント内で 1 つ保持する（`useRef`）。
- カメラの走査 tick で読み取った各 QR 文字列を `collector.add()` に投入する。
  - `collector.isComplete()` になった時だけ、`collector.result()` のフル文字列で
    `onPayload()` を**1回だけ**呼ぶ（`completed` ガードで重複呼び出しを防止）。
- 進捗（`received / total`）を画面に表示する（例:「2/3 読取済み」）。
  進捗は `add()` のたびに state へ反映する。
- `?debug=1` の貼り付け入力は**フル文字列**なので、`FrameCollector` を通さず直接
  `onPayload()` に渡す（従来動作を維持）。
- 既存の props（`title` / `caption` / `onPayload` / `hint` / `debug`）の契約は維持する。
  `onPayload` の呼び出しタイミングが「QR 1 枚ごと」から「全フレーム完成時」へ変わるのみ。

### 7.4 App.tsx

変更なし。`onPayload` が完成済みフル文字列を受け取る契約は従来と同じであり、
`decode()` 呼び出し・種別チェック・状態遷移はそのまま機能する。

## 8. エラー処理

| 事象 | 挙動 |
| --- | --- |
| 壊れた／書式不正のフレーム | `parseFrame` が `null`。無視して収集継続（カメラを取り直せる）。 |
| 別 `sid` のフレーム検出 | 収集をリセットし、新 `sid` を追従。 |
| 種別違いの QR（offer/answer 取り違え） | 組み立て後に既存の App 側チェックがヒント表示。 |
| `decode()` 失敗（破損ペイロード） | 既存どおり App 側で「QR が読み取れませんでした。」を表示。 |
| `buildFrames` への空文字列 | 例外（呼び出し側は有効な `encode()` 結果のみ渡す前提）。 |

## 9. テスト方針

- `src/signaling.test.ts` に単体テストを追加:
  - `buildFrames` ↔ `FrameCollector` の往復で元のフル文字列に復元される。
  - 長さに応じた分割数（境界値: `MAX_FRAME_BODY` ちょうど／+1）。
  - フレーム投入順がシャッフルされても復元できる。
  - 同一 `idx` の重複投入が冪等。
  - 別 `sid` 投入で収集がリセットされる。
  - 不正フレーム（区切り不足・数値外・空）が無視される。
  - `parseFrame` の妥当性検証（`idx > total` などを `null`）。
- カメラ循環読取の E2E はカメラ実機依存（PC カメラでは本番相当の高密度 QR を読めない）の
  ため、Playwright 結合テストは従来どおり `?debug=1` の貼り付け経路で担保する。
  フレーム分割／組み立てロジックは上記単体テストで厚く担保する。

## 10. 既定値（実機で調整可能）

| 定数 | 既定値 | 位置 | 役割 |
| --- | --- | --- | --- |
| `MAX_FRAME_BODY` | 180 | `src/signaling.ts` | 1 フレームの `body` 最大文字数（QR 密度の上限） |
| `CYCLE_INTERVAL_MS` | 700 | `src/components/QRDisplay.tsx` | 表示フレームの循環間隔（ミリ秒） |

## 11. 受け入れ条件

- 長い SDP でも各 QR のバージョンが `MAX_FRAME_BODY` 由来の上限以下に収まる。
- 表示側が分割 QR を自動循環表示し、`idx/total` が分かる。
- 読取側がカメラを向けるだけで全フレームを自動収集し、進捗を表示し、
  完成時に 1 回だけ元ペイロードを App へ渡して通話が成立する。
- `?debug=1` のフル文字列の表示・貼り付けが従来どおり動作する。
- App.tsx・`encode()`・`decode()` に変更がない。
- 追加した単体テストと既存テストがすべて通る。

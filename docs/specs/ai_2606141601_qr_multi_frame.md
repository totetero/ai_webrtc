# 接続QRの複数フレーム分割・自動収集

- 日付: 2026-06-14
- ブランチ: `feature/ai_2606141601_qr_multi_frame`
- 設計の土台: [docs/superpowers/specs/2026-06-14-qr-multi-frame-design.md](../superpowers/specs/2026-06-14-qr-multi-frame-design.md)
- 関連既存仕様: [docs/specs/ai_2606132315_webrtc_qr_videocall.md](ai_2606132315_webrtc_qr_videocall.md)

## 1. 背景 / 目的

サーバレス WebRTC ビデオ通話（QR 接続）アプリで、接続用 QR の「マス目が細かすぎて読み取れない」事象が発生した。原因は 1 枚の QR に `encode()` 由来のペイロード全体を詰め込み、QR バージョン（モジュール数）が高くなっているため。物理サイズではなくデータ量が問題であるため、ペイロードを複数フレームに分割して 1 枚あたりの密度を一定以下に保つ。

目的:

- 1 枚あたりのデータ量に上限を設け、SDP が長くても各 QR の密度が一定以下に保たれること。
- 表示側は分割した QR を自動で循環表示する。
- 読取側はカメラを向けて待つだけで全フレームを自動収集し、元のペイロードを復元する。

## 2. 全体方針

`encode()` が返すフル文字列（先頭 1 文字が type タグ + deflate 済み SDP の base64url）を、`signaling.ts` に新設するフレーム層で分割する。表示側は分割 QR を 1 枚ずつ自動循環表示し、読取側はフレームを自動収集して元のフル文字列に復元してから既存の `decode()` に渡す。

これにより `encode()` / `decode()` と App.tsx は無変更で済み、影響範囲をフレーム層 + 2 つの表示/読取コンポーネントに限定する。

```
[表示側] SDP --encode()--> フル文字列 --buildFrames()--> [frame, ...] --QR循環表示
[読取側] QR走査 --> frame --FrameCollector--> (全部そろう) --> フル文字列 --decode()--> SDP
```

## 3. フレーム形式

1 フレーム = 1 つの QR の中身。書式:

```
${sid}.${idx}.${total}.${body}
```

| フィールド | 内容 |
| --- | --- |
| `sid`   | 生成ごとのセッションID。4 文字、`[a-z0-9]`（`crypto.getRandomValues` 由来）。同一生成のフレームだけを結合するための識別子。 |
| `idx`   | フレーム番号（1 始まり）。表示の「2/3」に直結。 |
| `total` | フレーム総数。 |
| `body`  | フル文字列を等分した一部（base64url 文字 `A-Za-z0-9-_` のみ）。 |

- 区切り文字 `.` は base64url の文字集合に含まれないため `body` と衝突しない。パースは先頭から 3 つの `.` までを `sid` / `idx` / `total` とし、残り全体を `body` とする（`body` 自体は `.` を含まない）。
- `total === 1`（分割不要の短いペイロード）でも同じ書式で 1 フレームに包み、読取経路を一本化する。

## 4. 機能要件

### FR-1 フレーム層の新設（`src/signaling.ts`）

既存関数（`minifySdp` / `encode` / `decode` ほか）は不変。以下を新規エクスポートする。

- `MAX_FRAME_BODY: number` — `body` の最大文字数。初期値 **180**。
- `newSessionId(): string` — 4 文字のセッションID（`crypto.getRandomValues` 由来、`[a-z0-9]`）。
- `buildFrames(payload: string, sid: string, maxBody?: number): string[]`
  - フル文字列を `maxBody`（既定 `MAX_FRAME_BODY`）以内に分割し、フレーム文字列配列を返す。
  - フレーム数 = `Math.ceil(payload.length / maxBody)`。各 `body` 長はなるべく均等に分配する。
  - 空文字列は不正入力として例外を投げる。
- `parseFrame(s: string): { sid: string; idx: number; total: number; body: string } | null`
  - 書式・数値妥当性（`total >= 1`、`1 <= idx <= total`、`idx` / `total` が整数、`sid` / `body` が空でない）を検証し、不正なら `null`。
- `class FrameCollector`
  - `add(frame: string): void` — フレーム文字列を投入。
    - `parseFrame` で不正と判定したフレームは無視する。
    - 収集中の `sid` と異なる `sid` のフレームが来たら、収集状態をリセットして新しい `sid` を採用する。
    - 同一 `idx` の重複投入は冪等（上書き）。
  - `progress: { received: number; total: number } | null` — 進捗（未受信時は `null`）。
  - `isComplete(): boolean` — 現在の `sid` の全 `idx`（1..total）がそろったか。
  - `result(): string | null` — 完成していれば `idx` 昇順で `body` を連結したフル文字列、そうでなければ `null`。
  - `reset(): void` — 収集状態を破棄。

### FR-2 分割粒度

- `MAX_FRAME_BODY` を `body` の最大文字数の上限とする（初期値 180、QR バージョン約 8・49×49 マス相当を目安）。
- `MAX_FRAME_BODY` は `src/signaling.ts` 内の 1 箇所の定数とし、実機検証後に粗さを調整できるようにする。

### FR-3 分割 QR の自動循環表示（`src/components/QRDisplay.tsx`）

- `payload` から `newSessionId()` + `buildFrames()` でフレーム配列を生成する（`payload` が変わったときのみ再生成）。
- 全フレームの dataURL は初回にまとめて生成し配列保持する（循環ごとの生成負荷を避ける）。
- `setInterval`（既定 `CYCLE_INTERVAL_MS = 700`、コンポーネント内定数）で表示フレームを 1 枚ずつ循環させる。
- 「`idx` / `total`」インジケータと進捗ドットを表示する。
- フレームが 1 枚（`total === 1`）のときも循環ロジックはそのまま（1 枚を表示し続ける）。
- アンマウント／`payload` 変更時に `setInterval` を確実に解除する。
- `?debug=1` のデバッグボックスは従来どおりフル文字列を表示する（変更なし）。

### FR-4 フレームの自動収集・進捗表示・復元（`src/components/QRScanner.tsx`）

- `FrameCollector` をコンポーネント内で 1 つ保持する（`useRef`）。
- カメラの走査 tick で読み取った各 QR 文字列を `collector.add()` に投入する。
- `collector.isComplete()` になった時だけ、`collector.result()` のフル文字列で `onPayload()` を 1 回だけ呼ぶ（`completed` ガードで重複呼び出しを防止）。
- 進捗（`received / total`）を画面に表示する（例:「2/3 読取済み」）。進捗は `add()` のたびに state へ反映する。
- `?debug=1` の貼り付け入力はフル文字列なので、`FrameCollector` を通さず直接 `onPayload()` に渡す（従来動作を維持）。
- 既存 props（`title` / `caption` / `onPayload` / `hint` / `debug`）の契約は維持する。`onPayload` の呼び出しタイミングが「QR 1 枚ごと」から「全フレーム完成時」へ変わるのみ。

### FR-5 App.tsx は変更なし

`onPayload` が完成済みフル文字列を受け取る契約は従来と同じであり、`decode()` 呼び出し・種別チェック・状態遷移はそのまま機能する。

## 5. エラー処理

| 事象 | 挙動 |
| --- | --- |
| 壊れた／書式不正のフレーム | `parseFrame` が `null`。無視して収集継続。 |
| 別 `sid` のフレーム検出 | 収集をリセットし、新 `sid` を追従。 |
| 種別違いの QR（offer/answer 取り違え） | 組み立て後に既存の App 側チェックがヒント表示。 |
| `decode()` 失敗（破損ペイロード） | 既存どおり App 側で「QR が読み取れませんでした。」を表示。 |
| `buildFrames` への空文字列 | 例外（呼び出し側は有効な `encode()` 結果のみ渡す前提）。 |

## 6. 非機能要件・制約

- `encode()` / `decode()` / `minifySdp` および SDP 最小化・圧縮方式（base64url + deflate）は変更しない。
- App.tsx の通話フロー・状態遷移・各ハンドラは変更しない。
- `?debug=1` のフル文字列の表示・貼り付け仕様は従来どおり維持する（貼り付けは分割を通さず直接フル文字列で適用）。
- `MAX_FRAME_BODY` / `CYCLE_INTERVAL_MS` は実機調整可能な定数として 1 箇所に置く。

## 7. 影響範囲（対象ファイルの当たり）

| ファイル | 変更内容 |
| --- | --- |
| `src/signaling.ts` | フレーム層追加（`MAX_FRAME_BODY` / `newSessionId` / `buildFrames` / `parseFrame` / `FrameCollector`）。既存関数は不変。 |
| `src/components/QRDisplay.tsx` | フレーム生成 + 自動循環表示 + `idx/total` インジケータ。debug 表示は維持。 |
| `src/components/QRScanner.tsx` | `FrameCollector` による自動収集 + 進捗表示 + 完成時 1 回 `onPayload`。debug 貼り付けは直接適用を維持。 |
| `src/signaling.test.ts` | フレーム層の単体テスト追加。 |
| `src/App.tsx` | 変更なし（影響なしを確認するための対象）。 |
| `src/qr.ts` | 変更なし（`generateQrDataUrl` を流用）。 |

## 8. 既定値（実機で調整可能）

| 定数 | 既定値 | 位置 | 役割 |
| --- | --- | --- | --- |
| `MAX_FRAME_BODY` | 180 | `src/signaling.ts` | 1 フレームの `body` 最大文字数（QR 密度の上限） |
| `CYCLE_INTERVAL_MS` | 700 | `src/components/QRDisplay.tsx` | 表示フレームの循環間隔（ミリ秒） |

## 9. テスト方針

`src/signaling.test.ts` に単体テストを追加する。

- フレーム往復: `buildFrames` → 全フレームを `FrameCollector.add` → `result()` が元のフル文字列に一致。
- 分割数境界: `payload.length` が `MAX_FRAME_BODY` ちょうど → 1 フレーム、`+1` → 2 フレーム。
- 順不同復元: フレーム投入順をシャッフルしても `result()` が一致。
- 重複 idx 冪等: 同一 `idx` を複数回 `add` しても結果不変・完成判定が壊れない。
- 別 sid リセット: 収集中に別 `sid` のフレームを投入すると状態がリセットされ、新 `sid` で収集が進む。
- 不正フレーム無視: 区切り不足・数値外（`idx > total`、非整数）・空文字を `add` しても収集状態が壊れず、`parseFrame` が `null` を返す。
- `total === 1` のフレームが単独で完成・復元できる。

カメラ循環読取の E2E はカメラ実機依存（PC カメラでは本番相当の高密度 QR を読めない、MEMORY 既知制約）のため、Playwright 結合テストは従来どおり `?debug=1` の貼り付け経路で担保する。フレーム分割／組み立てロジックは上記単体テストで厚く担保する。

## 10. 受け入れ条件

確認担当が動作確認に使うチェック項目。

1. 単体テスト: `npm run test`（または `npx vitest run`）で、追加したフレーム層テストと既存テストがすべて通る。
2. 分割の確認（コードレベル）: 長い SDP に対し `buildFrames` が複数フレームを返し、各 `body` 長が `MAX_FRAME_BODY` 以下である。
3. 表示側: 分割が発生する `payload` で QRDisplay が QR を自動循環表示し、`idx/total`（例「2/3」）が画面に表示される。
4. 読取側: 進捗（`received/total`）が画面に表示され、全フレームがそろった時に 1 回だけ `onPayload` が呼ばれる（重複呼び出しなし）。
5. `?debug=1` の経路（既存 Playwright E2E `tests/handshake.spec.ts` 相当）: フル文字列の表示・コピー、貼り付けて適用による握手が従来どおり成立する。`npx playwright test` がパスする。
6. 不変性: `git diff` で `src/App.tsx` / `encode` / `decode` / `minifySdp` / `src/qr.ts` に変更がないことを確認できる。
7. ビルド: `npm run build` が成功する（型エラーなし）。

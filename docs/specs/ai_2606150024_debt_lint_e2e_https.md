# 既存技術的負債の解消（lint エラー / Playwright http-https 不整合）

- ブランチ: `feature/ai_2606150024_debt_lint_e2e_https`
- 起点: `main`（PR #3 デザイン整備とは独立）

## 背景 / 目的

PR #3（デザイン整備, CSS のみ）のレビュー過程で、本 PR とは無関係な `main` 由来の既存負債が 2 件特定された。デザイン PR の差分に混ぜず、独立したブランチ・PR でまとめて解消する。本仕様はその 2 件に限定する。

- 負債1: `npm run lint` が唯一の error を出す（`src/components/QRDisplay.tsx:27` 付近の `react-hooks/set-state-in-effect`）。`main` の commit 2992732「接続QRを複数フレームに分割し自動収集する」由来。
- 負債2: `vite.config.ts` は `basicSsl()` で dev を HTTPS 配信するのに、`playwright.config.ts` の `baseURL` / `webServer.url` が `http://localhost:5173` を指しており、標準の `npx playwright test` が webServer ヘルスチェックでタイムアウトする。

目的は「`main` の標準コマンド（`npm run lint` / `npm run build` / `npx playwright test`）がクリーンに通る状態」を、既存機能の挙動を一切変えずに回復すること。

## 機能要件

### FR-1: lint エラーの解消（QRDisplay の set-state-in-effect）

- `src/components/QRDisplay.tsx` の `payload` 変更時 effect（現状 25〜50 行目）が、effect 本体で `setDataUrls([])` / `setError(null)` / `setCurrent(0)` を**同期的に**呼んでいるため `react-hooks/set-state-in-effect`（27 行目）に抵触している。これを解消する。
- 解消後、`npm run lint` の error が 0 件になること。
- 後述の「QR 複数フレーム機能の挙動維持」（FR-3）を壊さないこと。lint を黙らせる目的の `eslint-disable` コメントによる回避は**禁止**（負債を隠すだけで根本解消にならないため）。設定ファイルでのルール無効化も禁止。

#### 現状コードの観点整理（実装担当向け）

現 effect は「`payload` が変わったら、まず表示状態をリセット → 新しいセッション ID でフレームを生成 → 全フレームの QR dataURL を非同期生成 → 完了時に `setDataUrls`」という流れ。問題は**リセットの 3 つの setState が effect 本体で同期実行されている**点。`generateQrDataUrl` の `.then`/`.catch` 内の setState は非同期コールバックなので本ルールの対象ではない（27〜29 行のリセットのみが error 対象）。

挙動上、保たねばならない不変条件は次のとおり:

1. **`payload` ごとに 1 回だけフレーム生成**する（`buildFrames` + `newSessionId` の呼び出しは `payload` 変更時のみ）。`newSessionId()` を毎レンダリングで呼ぶと session ID が変わり、複数フレーム収集側の整合が崩れるおそれがあるため、生成タイミングは厳守。
2. `payload` が変わった瞬間、**前 payload の QR・エラー・表示インデックスが残らない**こと（古いフレームのちらつき・誤った counter 表示を防ぐ）。
3. 非同期生成の**競合解除**（`cancelled` フラグ）を維持し、古い `payload` の結果が新しい表示を上書きしないこと。
4. 生成失敗時のエラー表示（FR-3 の error 文言・`.error` 表示）が維持されること。

実装方針は実装担当が現コードを読んで選択する。判断材料として代表的な方向性を挙げる（いずれも上記不変条件を満たすこと）:

- **方向性A（派生 state / key リセット）**: 「`payload` が変わったら表示状態を初期に戻す」というリセットを、effect 内 setState ではなく React の標準パターンで表現する。例として、フレーム生成結果を保持する内側コンポーネントに `key={payload}` を与え、`payload` が変わったらアンマウント＝state が初期化されるようにする。これにより effect でのリセット setState 自体が不要になる。`current`（表示インデックス）や `error` も内側の初期 state に置けば、同期リセットが消える。
- **方向性B（生成結果を 1 つの state に集約）**: `dataUrls` / `error` / current の初期化を、`payload` を含む 1 つの状態オブジェクト（例: `{ key: payload, urls, error }`）にまとめ、表示時に「保持中の `key` が現 `payload` と一致するか」で古い結果を無視する。`payload` 不一致なら「生成中…」を描画する。これにより effect 本体のリセット setState を不要化できる。
- **方向性C（リセットをコミット後フェーズに分離）**: どうしても effect 内リセットが必要な場合に限り、ルールの趣旨（同期的カスケード再レンダリング回避）に沿う形へ再構成する。ただし A/B の方が React 公式の "You Might Not Need an Effect" の指針に沿い、副作用が少ないため A/B を優先検討すること。

いずれの方向でも、**`current` の循環表示用 effect（53〜63 行）と `setInterval` 解除ロジック、`cancelled` による競合解除は維持/等価**であること。

### FR-2: Playwright の HTTPS 整合（標準 `npx playwright test` が起動できる）

- `playwright.config.ts` の `use.baseURL` と `webServer.url` を、dev サーバの実配信スキーム（HTTPS, `basicSsl()` 由来）に揃える。
  - `baseURL`: `https://localhost:5173/ai_webrtc/`
  - `webServer.url`: `https://localhost:5173/ai_webrtc/`
- 自己署名証明書を許容する。`use.ignoreHTTPSErrors: true` を設定し、Chromium が証明書エラーで接続失敗・webServer ヘルスチェック失敗しないようにする。
- 現行 `webServer.command`（`npm run dev -- --host 127.0.0.1 --port 5173`）は維持してよい。host を `127.0.0.1` で待ち受けつつ `localhost` で接続する点は現状どおり（`localhost` は `127.0.0.1` に解決されるため整合する）。スキーム以外の host/port は変更しない。
- 変更後、標準の `npx playwright test`（環境変数なし）が webServer の起動・ヘルスチェックを通過し、テスト実行を**開始できる**こと（ヘルスチェックでタイムアウトしないこと）。

> 注: 本リポジトリの実機テスト方針（MEMORY: QR 読み取りは実機スマホ必須、握手検証は `?debug=1` のペイロード直貼り）により、`handshake.spec.ts` は `?debug=1` 経由で握手する。HTTPS 化はこの既存テストの前提（同一 origin・getUserMedia）を満たす方向の修正であり、テスト内容の変更は不要。

### FR-3: QR 複数フレーム機能・既存インターフェースの挙動維持（回帰防止）

FR-1 の修正にあたり、以下を**維持**すること:

- `QRDisplay` の外部 props（`payload` / `title` / `caption` / `debug`）のシグネチャを変えない。
- 複数フレーム分割表示の挙動: `buildFrames` による分割、`CYCLE_INTERVAL_MS`（700ms）間隔の自動循環、フレームが 1 枚以下なら循環しない（`dataUrls.length <= 1` で interval 不開始）こと。
- フレームインジケータの DOM・`data-testid` を維持: `qr-frame-indicator` / `qr-frame-counter`（`{idx} / {total}` 表示）/ `qr-frame-dots` / `.qr-frame-dot`（`active` クラス）。
- debug ボックス（`debug-payload-box` / `debug-payload` / コピー）と `data-testid` を維持。
- `payload` 切替時に前回の QR・カウンタ・エラーが残らない（FR-1 の不変条件 2）。

## 非機能要件・制約

- スコープは上記 2 件の解消に限定。機能追加・無関係なリファクタ・依存追加は禁止。
- CSS・他コンポーネント・`signaling` / `qr` モジュールには手を入れない（QRDisplay の内部実装と playwright.config のみが対象）。
- 既存の `data-testid`、コンポーネント外部 props、QR 複数フレーム機能の挙動を維持する。
- `eslint-disable` コメントや eslint 設定でのルール無効化による回避は禁止（FR-1）。

## 影響範囲

| ファイル | 変更内容 |
|---|---|
| `src/components/QRDisplay.tsx` | effect の set-state-in-effect を解消（FR-1）。外部 props・data-testid・複数フレーム挙動は不変。 |
| `playwright.config.ts` | `baseURL` / `webServer.url` を https へ、`ignoreHTTPSErrors: true` を追加（FR-2）。 |

- 参考（変更しない）: `vite.config.ts`（`basicSsl()` の出典）、`tests/handshake.spec.ts`（相対 `goto('/?debug=1')` で baseURL を消費）、`eslint.config.js`（`react-hooks` recommended 由来のルール）。

## 受け入れ条件

確認担当が以下を順に検証する。

- AC-1: `npm run lint` が **error 0 件**で完了する（warning は許容だが新規 warning を増やさないこと）。`QRDisplay.tsx:27` の `react-hooks/set-state-in-effect` が消えていること。`eslint-disable` や設定でのルール無効化で回避していないことを差分で確認する。
- AC-2: `npm run build` が成功する（型エラー・ビルドエラーなし）。
- AC-3: 標準の `npx playwright test`（環境変数なし）が webServer 起動・ヘルスチェックを通過し、テスト実行を開始できる（ヘルスチェックでタイムアウトしない）。`handshake.spec.ts` が HTTPS 整合の修正のみが原因で壊れていないこと。
  - 検証手段: `npx playwright test` を実行し、`Error: Timed out waiting ... from config.webServer` が出ないこと。テストがブラウザ操作フェーズへ進むこと（起動到達の確認が主目的。実機 QR 読み取りは対象外＝`?debug=1` 経路で握手する既存テストがそのまま動くこと）。
- AC-4: QR 複数フレーム表示が回帰しないこと。`?debug=1` で接続用 QR を表示し、以下を確認する:
  - フレーム数が複数のとき、約 700ms 間隔で QR 画像が循環し、`qr-frame-counter` の `idx / total` が進む。
  - `qr-frame-dots` の `active` ドットが現在フレームに追従する。
  - `payload`（接続相手/再生成）が切り替わったとき、前回のフレーム・カウンタ・エラーが残らず、新しいフレーム生成が 1 回だけ走る。
  - フレームが 1 枚のときは循環しない。
  - 検証手段: Playwright で `?debug=1` 起動 → `qr-frame-indicator` / `qr-frame-counter` / `qr-frame-dots` の存在と counter の進行をスクショ込みで確認（実機 QR スキャンは不要、DOM 挙動で判定）。
- AC-5: `QRDisplay` の外部 props・全 `data-testid`（`qr-frame-indicator` / `qr-frame-counter` / `qr-frame-dots` / `debug-payload-box` / `debug-payload`）が維持されている（差分で確認）。

## 未解決の確認事項

なし（2 件とも修正方針・受け入れ条件が確定している）。実装方針（FR-1 の方向性 A/B/C）は実装担当が現コードを読んで選択する余地として残してあり、確認事項ではない。

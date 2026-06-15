# デザイン整備（実用最小の CSS 整備）

ブランチ: `feature/ai_2606142345_design_polish`

## 背景 / 目的

WebRTC QR ビデオ通話アプリは、同じ WiFi 上の 2 台のスマホが向かい合い、QR を読み合って P2P 通話を確立する。フェーズは `idle`（役割選択）→ QR 表示/読取（offer/answer）→ `inCall`（通話）→ `ended`。

しかし現状、**アプリには実質的なスタイルが存在しない**。

- 実コンポーネント（`RoleSelect.tsx` / `QRDisplay.tsx` / `QRScanner.tsx` / `CallView.tsx`）と `App.tsx` は意味のあるクラス名を多数使っているが、`src/App.css` にはそれらのスタイルがほぼ定義されていない（後述の QR フレームインジケータ系 3 クラスを除く）。
- `src/App.css` の大半は Vite + React テンプレートの残骸（`.counter` / `.hero` / `#next-steps` / `#docs` / `#spacer` / `.ticks` など、アプリ未使用の死にコード）。
- `src/index.css` もテンプレート由来で、`#root` が幅 1126px 固定・`h1` が 56px などランディングページ用の値。ただし `:root` の CSS 変数とライト/ダーク対応、基本要素スタイルは流用可能。

本仕様の目的は、**スマホ 2 台が向かい合って使う前提に絞り、読みやすさ・押しやすさ・QR の視認性を最優先に、破綻なく整える**こと。装飾は控えめ、凝ったブランディングは不要。これを「実用最小」と呼ぶ。

## スコープ

- **含む**: `src/App.css` と `src/index.css` の CSS 整備、およびそれに付随する最小限のマークアップ調整（クラス追加・要素のラップ等で、既存クラス名・`data-testid`・コンポーネントの props/ロジックを壊さない範囲）。
- **含まない**: 機能追加、状態管理やフェーズ遷移の変更、コンポーネント分割などの大規模リファクタ、新規ライブラリ導入、ロゴ/イラスト等のアセット追加。

## 前提・制約（調査済みの事実）

### 既存で使われているクラス名・`data-testid`（壊さないこと）

| ファイル | クラス名 | `data-testid` |
|---|---|---|
| `App.tsx` | `app-root`, `status-screen`, `error`, `next`, `primary` | — |
| `RoleSelect.tsx` | `role-select`, `hint`, `role-buttons`, `primary`, `error` | — |
| `QRDisplay.tsx` | `qr-display`, `hint`, `error`, `qr-image`, `qr-frame-indicator`, `qr-frame-dots`, `qr-frame-dot`(`.active`), `debug-box`, `debug-label`, `debug-payload` | `qr-frame-indicator`, `qr-frame-counter`, `qr-frame-dots`, `debug-payload-box`, `debug-payload` |
| `QRScanner.tsx` | `qr-scanner`, `hint`, `error`, `scanner-video-wrap`, `scanner-video`, `scanner-canvas`, `debug-box`, `debug-label`, `debug-payload` | `scan-progress`, `debug-paste-box`, `debug-paste-input`, `debug-paste-submit` |
| `CallView.tsx` | `call-view`, `remote-video`, `local-preview`, `call-controls`, `hangup` | `remote-video`, `local-preview`, `hangup` |

注意点:

- `qr-image` は `width={320} height={320}` 属性付き `<img>`。`qr-frame-indicator` / `qr-frame-dots` / `qr-frame-dot`(`.active`) は **既に `App.css` にスタイルが定義済み**（変数を使った既存スタイル）。これらは流用・微調整に留め、撤去しない。
- `scanner-canvas` は `hidden` 属性付きで非表示。スタイル不要（表示しないこと）。
- `next` ボタンは `showOfferQR` で QR 表示の下に出る「相手の応答 QR を読み取る」ボタン。`primary` は役割選択・終了画面の主ボタン。`hangup` は通話終了ボタン。
- フェーズによって `app-root` 直下に来る要素が異なる:
  - `idle`: `RoleSelect`（`role-select`）
  - `creatingOffer`/`creatingAnswer`: `status-screen`（生成中テキスト）
  - `showOfferQR`: `QRDisplay`（`qr-display`）＋ `next` ボタン（兄弟要素・フラグメント直下）
  - `scanningAnswer`/`scanningOffer`: `QRScanner`（`qr-scanner`）
  - `showAnswerQR`: `QRDisplay`（`qr-display`）
  - `inCall`: `CallView`（`call-view`）
  - `ended`: `status-screen`（終了見出し＋任意の `error`＋`primary`）

### `index.css` で活かす資産

- `:root` の CSS 変数: `--text`, `--text-h`, `--bg`, `--border`, `--code-bg`, `--accent`, `--accent-bg`, `--accent-border`, `--social-bg`, `--shadow`, `--sans`, `--heading`, `--mono`。
- `color-scheme: light dark` と `@media (prefers-color-scheme: dark)` のダーク上書き。
- `body { margin: 0 }`、`h1`/`h2`/`p`/`code` の基本スタイル（値は見直す）。

## 機能要件（実装可能な粒度）

### FR-1. `App.css` の死にコード撤去

- 以下のアプリ未使用セレクタを **削除** する: `.counter`, `.hero`（および配下 `.base` / `.framework` / `.vite`）, `#center`, `#next-steps`（配下含む）, `#docs`, `#spacer`, `.ticks`。
- `qr-frame-indicator` / `qr-frame-dots` / `qr-frame-dot`(`.active`) の既存スタイルは **残す**（必要なら値を微調整）。
- 撤去後の `App.css` は、本仕様で定義する実コンポーネント向けスタイルのみで構成する。

### FR-2. `index.css` のモバイル向け見直し

- `#root` の `width: 1126px` 固定を撤去し、モバイル縦画面で破綻しないレイアウトに変更する。
  - `#root` は画面幅いっぱい（`width: 100%`）を基本とし、コンテンツの最大幅は別途 `app-root` 側で `max-width`（目安 480〜560px、中央寄せ）として制御する。
  - `min-height: 100svh` と縦フレックスは維持してよい（フェーズ画面の縦中央寄せに使う）。
  - `text-align: center` と `border-inline`（左右ボーダー）は撤去または見直す（縦長スマホで不自然なため）。
- `h1` の `56px` 固定など、ランディング向けの大きすぎる値を実用サイズへ見直す。
  - `h1`: モバイル縦の見出しとして適切なサイズ（目安 24〜28px、`@media` での更なる縮小は任意）。
  - `h2`: 各フェーズのタイトル用に読みやすいサイズ（目安 18〜20px）。
- `:root` の CSS 変数・配色・ライト/ダーク対応・フォント設定は **維持** する。

### FR-3. 全フェーズ共通レイアウト（`app-root`）

- `app-root` を縦フレックスコンテナとし、各フェーズ画面を **縦中央寄せ・横中央寄せ** で配置する。
- コンテンツ幅は `max-width`（目安 480〜560px）で制限し、`margin: 0 auto` で中央に置く。左右に最小余白（目安 16px）を確保する。
- 画面が縦に収まらない場合に内容が切れないよう、必要に応じてスクロール可能にする（`inCall` を除く。`inCall` は全面映像のため別扱い、FR-7 参照）。

### FR-4. 役割選択画面（`role-select`）

- 見出し `h1`、説明文 `hint`、`role-buttons`（発信/応答の 2 ボタン）、任意の `error` を縦に並べ、画面中央に配置する。
- `role-buttons` は 2 ボタンを縦並び（モバイル縦で押しやすい）または十分な間隔の横並びとする。実装は縦並びを推奨。
- 各 `primary` ボタンは FR-8 のタップターゲット要件を満たす。

### FR-5. QR 表示画面（`qr-display`）

- `h2`（タイトル）、`hint`（キャプション）、`qr-image`、`qr-frame-indicator`、任意の `error` を縦に並べ中央寄せする。
- **`qr-image` の地は常に白**（`background: #fff`）とし、QR 画像の周囲に十分な余白（白い padding、目安 12〜16px）を確保する。ダークモードでも QR の白地・黒モジュールのコントラストを保ち、読み取り可能にすること。
- `qr-image` は属性で 320×320 が指定されているが、画面幅が狭い端末でもはみ出さないよう `max-width: 100%; height: auto;`（アスペクト比維持）を適用する。QR がぼやけない範囲で表示する。
- `showOfferQR` では `qr-display` の下に兄弟要素として `next` ボタンが来る。`next` ボタンと QR の間に適切な余白を取り、ボタンは FR-8 を満たす。

### FR-6. QR 読取画面（`qr-scanner`）

- `h2`、`hint`、`scanner-video-wrap`（カメラプレビュー）、任意の `scan-progress`/`cameraError`/`hint`(error) を縦に並べ中央寄せする。
- `scanner-video-wrap` はカメラプレビューの枠。`scanner-video` が枠いっぱいに表示され、はみ出さないようにする（`width: 100%`、`object-fit: cover` 等）。プレビューは正方形〜縦長の領域とし、画面幅に追従させる（`max-width: 100%`）。
- `scanner-canvas`（`hidden`）は非表示のまま。
- `scan-progress` / `cameraError` / `hint` のテキストはプレビュー下に読みやすく表示する。

### FR-7. 通話画面（`call-view`）

- `remote-video`（相手映像）を **主画面**として全面に表示する。`call-view` は画面いっぱい（目安 `100svh` 相当の高さ）を占めてよい。
- `local-preview`（自分映像）を**小窓**として隅（右下または右上）に重ねて表示する（`position: absolute`）。小窓は小さめの固定サイズ（目安 短辺 25〜30% かつ上限あり）とし、角丸・薄い枠線で見分けやすくする。
- `call-controls` 内の `hangup` ボタンを画面下部中央など押しやすい位置に重ねて配置する。`hangup` は他より目立つ配色（例: 終了を示す赤系、または `accent` とは別の強調）で、FR-8 のタップターゲット要件を満たす。
- 映像が無い間（`remote-video` が空）でも背景が黒等で破綻しないようにする。

### FR-8. タップターゲット・可読性

- 主要操作ボタン（`primary` / `next` / `hangup`）は **最小高さ 44px**（推奨 48px）を確保し、左右に十分な内側余白（目安 横 16px 以上）を持つ。押下対象として指で押しやすいこと。
- ボタンは角丸・十分なコントラスト・押下/フォーカス時の視覚フィードバック（`:active` / `:focus-visible`）を持つ。`:focus-visible` は `--accent` を使ったアウトラインとする。
- 本文（`p` / `hint`）は可読サイズ（目安 14〜16px 以上）を確保する。`hint` は補助文として `--text` 系の控えめな色、`error` は警告が伝わる色（赤系）とする。

### FR-9. ステータス/終了画面（`status-screen`）・補助要素

- `status-screen`（生成中・終了）は見出し/テキスト/任意ボタンを中央寄せで配置する。
- `error`・`hint` は FR-8 の方針に従う。
- `debug-box` / `debug-label` / `debug-payload`（`?debug=1` 時のみ表示）は、本番表示の邪魔にならない控えめな見た目（枠線・等幅フォント `--mono`・小さめ）で最低限整える。`textarea`（`debug-payload`）は幅 100%・折り返し可で読める状態にする。

## 非機能要件・制約

- **NFR-1. 互換性**: 既存の全クラス名・`data-testid`・コンポーネントの props/ロジックを変更しない。マークアップ調整は、ラッパ要素追加や既存要素へのクラス追加など、テスト・WebRTC ロジックに影響しない範囲に限る。
- **NFR-2. ライト/ダーク両対応**: `prefers-color-scheme` に追従し、両モードで全フェーズが読みやすいこと。ただし **QR の地は常に白**（FR-5）。
- **NFR-3. CSS 変数の活用**: 配色・影は既存 `:root` 変数を使う。新規に色を増やす場合も変数として `:root`（とダーク上書き）に定義し、ハードコード色の散乱を避ける。`hangup` の強調色など新規色は変数化してよい。
- **NFR-4. ビューポート安全**: `100svh` 等のモバイル安全単位を用い、アドレスバーの伸縮で破綻しないようにする。固定の `px` 幅でレイアウトを縛らない。
- **NFR-5. 依存追加なし**: 新規パッケージ・フォント・画像アセットを追加しない。既存のシステムフォント設定を使う。
- **NFR-6. 既存ビルド/Lint を壊さない**: 変更後に `npm run build`（型・ビルド）と既存の lint が通ること。

## 影響範囲（対象ファイルの当たり）

- `src/index.css` — `#root` の固定幅撤去、見出しサイズ見直し（FR-2）。変数・ダーク対応は維持。
- `src/App.css` — 死にコード撤去（FR-1）、実コンポーネント向けスタイルの新規定義（FR-3〜FR-9）。
- マークアップの最小調整（必要な場合のみ、クラス追加/ラッパ追加レベル）:
  - `src/App.tsx`（`app-root` のレイアウト都合でラッパが要る場合）
  - `src/components/RoleSelect.tsx` / `QRDisplay.tsx` / `QRScanner.tsx` / `CallView.tsx`
  - いずれも **既存クラス名・`data-testid`・props は維持**。新規クラスの追加は可。

## 受け入れ条件

確認担当が動作確認に使えるチェック項目。モバイル縦想定（例: Playwright で `viewport` を 390×844 程度のスマホ縦に設定し、ライト/ダーク両方で確認）。QR の実機読み取りは PC カメラでは不可のため、視認性は「白地・余白・はみ出しなし」を視覚で確認する（`?debug=1` でペイロード直貼りにより握手は別途検証可）。

1. **死にコード撤去**: `src/App.css` に `.counter` / `.hero` / `#next-steps` / `#docs` / `#spacer` / `.ticks` / `#center` が存在しない。`qr-frame-*` 系スタイルは残っている。
2. **固定幅撤去**: `src/index.css` の `#root` に `width: 1126px` が無い。390px 幅ビューポートで横スクロールが発生しない（どのフェーズでも内容が横にはみ出さない）。
3. **役割選択（idle）**: 390×844 で `role-select` が画面中央付近に配置され、`h1`・説明文・発信/応答ボタンが読め、ボタンが重ならず押しやすい。発信/応答ボタンの高さが 44px 以上。
4. **QR 表示**: `?debug=1` 等で `showOfferQR`/`showAnswerQR` を表示したとき、`qr-image` が白背景＋周囲余白を持ち、390px 幅で右端にはみ出さない。ダークモードでも QR の地が白のまま（暗くならない）。`qr-frame-indicator`（カウンタ＋ドット）が QR 下に表示される。`showOfferQR` では QR 下に `next` ボタンが適切な間隔で表示され、高さ 44px 以上。
5. **QR 読取**: `scanning*` 表示時、`scanner-video-wrap` のプレビュー領域が画面幅に収まり、`scanner-video` がはみ出さない。`scanner-canvas` は非表示。`scan-progress`/ヒント文がプレビュー下に読める形で出る。
6. **通話画面**: `inCall` 表示時、`remote-video` が全面、`local-preview` が隅の小窓として重なり、`hangup` ボタンが押しやすい位置に重ねて表示される。`hangup` の高さ 44px 以上で、終了が伝わる強調配色。映像未取得でも背景が破綻しない。`remote-video`/`local-preview`/`hangup` の `data-testid` が引き続き取得できる。
7. **終了（ended）**: `status-screen` の見出し・任意のエラー文・「最初に戻る」`primary` ボタンが中央寄せで表示され、ボタン高さ 44px 以上。
8. **ライト/ダーク**: `prefers-color-scheme` を切り替えても全フェーズで文字・ボタン・枠が読め、コントラストが破綻しない（QR 地は常に白）。
9. **エラー/ヒント**: `error` は警告色（赤系）、`hint` は控えめな補助色で表示され、判別できる。
10. **互換性**: 全コンポーネントの既存 `data-testid`（`hangup`, `remote-video`, `local-preview`, `qr-frame-indicator`, `qr-frame-counter`, `qr-frame-dots`, `scan-progress`, `debug-payload-box`, `debug-payload`, `debug-paste-box`, `debug-paste-input`, `debug-paste-submit`）が DOM に存在し、対応フェーズで取得できる。
11. **ビルド**: `npm run build` が成功し、lint エラーが無い。

## 未解決の確認事項

なし（「実用最小」の方向性が明確で、目安値はすべて実装担当が裁量で確定できる範囲）。配色の細部（`hangup` の赤系トーン等）は実装担当の判断に委ねる。

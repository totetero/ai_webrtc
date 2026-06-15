# 読み取り側フレーム別ドットインジケータ（案B）

## 背景 / 目的

QR ハンドシェイクは、確定 SDP を複数フレームに分割して循環表示し（書き込み側 `QRDisplay`）、
読み取り側 `QRScanner` がカメラでフレームを自動収集して復元する設計になっている。

- 書き込み側（`QRDisplay` / `QRFrames`）は `idx / total` カウンタと、**現在表示中**のフレームを
  `active` にしたドット列（`.qr-frame-dots` / `.qr-frame-dot` / `.qr-frame-dot.active`）を表示している。
- 読み取り側（`QRScanner`）は `{received}/{total} 読取済み` のテキスト進捗のみで、
  **どのフレームを受信済みか**が視覚的に分からない。

本仕様は、読み取り側に「実際に受信したフレーム番号の位置だけを点灯する」ドット列を追加し、
書き込み側と同じ視覚言語で受信進捗を示す（採用案：**B. フレーム別インデックス**）。

例: 全 5 フレームのうちフレーム 1, 3, 5 を受信済みなら、1・3・5 の位置のドットだけを点灯する
（受信数 3 を先頭 3 個に詰めて点灯するのではない）。

## 採用案と却下案

- **採用 — 案B（フレーム別インデックス）**: 受信した実フレーム番号の位置だけを点灯する。
  どの番号がまだ来ていないかが一目で分かり、循環表示中のどのコマを狙うべきか判断しやすい。
- 却下 — 案A（受信数を先頭から詰めて点灯）: 受信「数」しか表せず、案Bが伝える
  「どの番号が欠けているか」の情報を失う。実装は単純だがユーザー価値が低い。

## 機能要件（実装可能な粒度）

### FR-1: `FrameCollector` に受信インデックス公開 API を追加する

`src/signaling.ts` の `FrameCollector` は現在、受信済みフレーム番号の集合を外部へ公開していない
（内部 `bodies: Map<number, string>` に閉じている）。読み取り側 UI が「どの番号を受信済みか」を
描画できるよう、小さな読み取り専用 API を追加する。

- 追加するアクセサ: `get receivedIndices(): number[]`
  - 受信済みフレーム番号（1 始まり、`bodies` のキー）を**昇順**にソートした配列を返す。
  - まだ何も受信していない（または `reset()` 後）の場合は空配列 `[]` を返す。
  - 内部状態は変更しない（純粋な導出）。
  - sid 切り替え（別セッション検出）で `bodies` がリセットされたら、当然この配列も空になる。
- 既存の `add` / `progress` / `isComplete` / `result` / `reset` のロジック・シグネチャは**変更しない**。
  `receivedIndices` は既存の `bodies` キーから導出するだけの追加であり、既存テストは影響を受けない。

実装イメージ（このとおりでなくてよいが、戻り値の契約は守る）:

```ts
get receivedIndices(): number[] {
  return Array.from(this.bodies.keys()).sort((a, b) => a - b)
}
```

### FR-2: 読み取り側 `QRScanner` に受信インデックス state を持たせる

`src/components/QRScanner.tsx` で、現在 `progress`（`{received, total}`）のみ state 保持しているところに、
受信済みインデックスも保持する。

- 既存の `progress` state はそのまま残す（テキスト `{received}/{total} 読取済み` を維持）。
- 新たに `receivedIndices: number[]` を state として保持する（初期値 `[]`）。
- `tick` 内で `collector.add(data)` の直後、`setProgress(collector.progress)` と**同じタイミング**で
  `setReceivedIndices(collector.receivedIndices)` を呼ぶ。これにより `progress` とドット表示が常に整合する。
- 既存の完了ガード（`completedRef`）の挙動は不変。完了後は新規 `add` を止めるため、
  全ドット点灯の最終状態が保持される。

### FR-3: 読み取り側にフレーム別ドット列を描画する

`QRScanner` の進捗表示ブロック（現在の `data-testid="scan-progress"` の近傍）に、ドット列を追加する。

- ドット列は `progress` が非 null のときのみ描画する（テキスト進捗の表示条件と揃える。
  まだ有効フレーム未受信＝ `progress === null` の間はドットを出さない）。
- ドットの個数は `progress.total` 個。
- 位置 `i`（0 始まり）のドットは、`i + 1`（実フレーム番号）が `receivedIndices` に含まれるとき `active`、
  含まれないとき非アクティブとする。
- マークアップは書き込み側 `QRFrames` のドットに揃える:
  - 外側コンテナに `data-testid="scan-frame-dots"`、クラス `qr-frame-dots`。
  - 各ドットは `<span>`、クラスは受信済みなら `qr-frame-dot active`、未受信なら `qr-frame-dot`、`aria-hidden="true"`。

描画イメージ:

```tsx
{progress ? (
  <div className="qr-frame-dots" data-testid="scan-frame-dots">
    {Array.from({ length: progress.total }, (_, i) => (
      <span
        key={i}
        className={receivedIndices.includes(i + 1) ? 'qr-frame-dot active' : 'qr-frame-dot'}
        aria-hidden="true"
      />
    ))}
  </div>
) : null}
```

### FR-4: CSS は既存スタイルを流用する（新規スタイル追加なし）

`src/App.css` の既存クラスをそのまま使い、新しい CSS は追加しない。

- `.qr-frame-dots`（flex 横並び・gap）
- `.qr-frame-dot`（8px 円・`var(--border)` 背景）
- `.qr-frame-dot.active`（`var(--accent)` 背景）

読み取り側ドットを書き込み側カウンタと縦に並べたい等のレイアウト調整が実機確認で必要になった場合は、
既存 `.qr-frame-indicator` の流用、または最小限の追加で対応する（本仕様の必須範囲外。まずは流用で着地させる）。

## 非機能要件・制約

- 既存の公開 API（`encode` / `decode` / `buildFrames` / `parseFrame` / `FrameCollector` の既存メンバ）の
  シグネチャと挙動を変えない。追加は `receivedIndices` getter のみ。
- 毎フレーム（`requestAnimationFrame` ごと）に `setReceivedIndices` を呼ぶが、配列内容が変わらない限り
  React の再レンダリングコストは小さい。既存の `setProgress` も毎 tick 呼ばれており、負荷特性は同等。
  最適化（変化時のみ setState 等）は必須ではない。過度な早期最適化は避ける（YAGNI）。
- アクセシビリティ: ドットは装飾であり、受信状況のテキスト（`{received}/{total} 読取済み`）が
  正本として残るため、ドットには `aria-hidden="true"` を付ける（書き込み側と同一方針）。
- lint / typecheck / 既存テストを壊さない。

## 影響範囲（対象ファイル）

- `src/signaling.ts` — `FrameCollector` に `receivedIndices` getter を追加（FR-1）。
- `src/components/QRScanner.tsx` — 受信インデックス state とドット列描画を追加（FR-2 / FR-3）。
- `src/signaling.test.ts` — `receivedIndices` の単体テストを追加（受け入れ条件 A）。
- `tests/handshake.spec.ts` — 必要に応じて読み取り側ドットの E2E 検証を追加（受け入れ条件 C）。
- `src/App.css` — 原則変更なし（FR-4。流用）。

## 受け入れ条件

### A. 単体テスト（`src/signaling.test.ts`、Vitest）

`FrameCollector.receivedIndices` について次を検証する:

- 初期状態（何も `add` していない）で `[]` を返す。
- `add('ab12.2.3.BB')` → `[2]`、続けて `add('ab12.1.3.AA')` → `[1, 2]`（**昇順**で返ること）。
- 同一 idx を重複 `add` しても配列に重複が出ない（例: `1.3` を 3 回投入 → `[1]`）。
- 別 sid のフレームを `add` するとリセットされ、新 sid 分のみになる
  （例: `ab12.1.2.AA` 後に `cd34.2.3.YY` → `[2]`）。
- `reset()` 後は `[]` を返す。

実行: `npm test`（または該当ファイルのみ）→ 追加テストが PASS、既存テストも全 PASS。

### B. ビルド / 静的チェック

- `npm run lint` がエラーなしで通る。
- `tsc`（`npm run build` 等のプロジェクト標準手順）で型エラーが出ない。

### C. E2E 動作確認（Playwright、`?debug=1` を活用）

既存の `data-testid`（`scan-progress` / `debug-paste-box` / `debug-paste-input` / `debug-paste-submit`）と
新規 `scan-frame-dots` を用いて、読み取り側の挙動を確認する。手順例:

1. 読み取り側画面（`QRScanner` が表示される状態）を開く。
2. 受信前は `scan-frame-dots` が DOM に存在しない（`progress` が null のため非表示）ことを確認。
3. フレームが収集され始めると `scan-frame-dots` が表示され、内部の `.qr-frame-dot` の総数が
   `scan-progress` テキストの `total` と一致することを確認。
4. `active` クラスを持つドットの個数が、`scan-progress` の `received` と一致することを確認。
5. （案B の本質）受信したフレーム番号が飛び番（例: 1 と 3 のみ）のとき、点灯位置が
   先頭詰め（1, 2）ではなく実番号の位置（1, 3）であることを確認する。
   - カメラ無し環境では、テスト用に `FrameCollector` を直接駆動するか、フレーム文字列を順不同で
     与えられる経路で検証する（実装時に最小限の検証手段を用意してよい）。
6. 全フレーム受信完了後、すべてのドットが `active` になることを確認。

> 注: 既存 E2E はカメラを使わない経路（debug paste 等）で動かしている前提。読み取り側ドットの
> 飛び番点灯を厳密に検証するには、順不同・部分的なフレーム投入が必要なため、実装担当は
> 単体テスト（条件 A）で飛び番点灯ロジックを担保し、E2E は表示・総数・点灯数の整合確認を主とする。

## 未解決の確認事項

なし。案B採用・`receivedIndices` API 追加・既存ドット CSS 流用・`data-testid="scan-frame-dots"` 付与の
方針はユーザー回答で確定済み。

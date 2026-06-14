# レビュー段階への Agent Teams 導入 設計書

- 日付: 2026-06-14
- 対象: `.claude/` のエージェント運用方式（サブエージェント → Agent Teams への部分移行）
- 状態: 設計承認済み（実装前）

## 背景 / 目的

本リポジトリは Claude Code の機能キャッチアップを兼ねており、再利用できそうな設定は `main` に直接残す方針。
現状は `.claude/agents/` に planner / developer / reviewer の3サブエージェントを定義し、`CLAUDE.md` でメイン Claude が**逐次オーケストレーション**している（plan → develop → review、要修正は最大3回ループ）。

これを Claude Code の実験的機能 **Agent Teams**（v2.1.32+、出典: https://code.claude.com/docs/en/agent-teams.md）で試したい。
ねらいは Agent Teams のキャッチアップであり、**可逆的でありながら効果が大きい**導入点を選ぶ。

## 設計判断: なぜ「レビュー段階だけ」をチーム化するのか

公式ドキュメントは Agent Teams の入門として **「Start with research and review」** を明示的に推奨している。
理由は、レビューが ①境界が明確 ②並列化の効果が大きい ③ファイル競合がない、という Agent Teams の長所が最も素直に出る作業だから。

一方、ドキュメントは「**逐次的なタスク・同一ファイル編集・依存の多い作業は、単一セッションかサブエージェントの方が効果的**」とも明言している。
現状の planner → developer は本質的に逐次・単一成果物のパイプラインであり、これはサブエージェント向き。

したがって設計は次の通り:

- **planner → developer は現状のサブエージェント逐次パイプラインを維持**（変更なし）。
- **review 段階だけをチーム化**: リード（メイン Claude）が複数の reviewer を並列起動し、各レンズで PR を検証し、互いに指摘を突き合わせて1本の総合判定にまとめる。

これにより、実績ある plan/develop の流れには触れず、最も効果が出る所だけを差し替える。env トグルで完全に元へ戻せるため可逆性も担保される。

## 構成

### 1. 有効化（すべて可逆）

`.claude/settings.json` の `env` に以下を追加:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "teammateMode": "in-process"
}
```

- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` … Agent Teams を有効化（デフォルト無効）。
- `teammateMode: "in-process"` … split-pane（tmux/iTerm2）は VSCode 統合ターミナル非対応のため、どの端末でも動く in-process を明示指定。
- **可逆性**: 値を `"0"` にするか該当キーを削除するだけで、現行のサブエージェント運用に完全復帰する。既存の3定義ファイルも `CLAUDE.md` の既存フローも残す。
- 前提: `claude --version` ≥ 2.1.32（確認済み: 2.1.170）。

### 2. 役割定義の再利用（新規ファイルは作らない）

- 既存の `.claude/agents/reviewer.md` を**チームメイト型としてそのまま再利用**する。
  - Agent Teams はサブエージェント定義を参照でき、`tools`（Playwright 一式）と `model` は尊重され、本文はチームメイトのシステムプロンプトに追記される。
  - 注意: 定義の `skills` / `mcpServers` frontmatter はチームメイトには適用されない（チームメイトはプロジェクト/ユーザー設定から skills・MCP を読み込む）。reviewer.md は `tools` に Playwright を列挙しているのでこの点は問題なし。
- 複数レンズは**別ファイルを作らず**、リードが同じ `reviewer` 型を異なる spawn プロンプトで複数起動して表現する。レンズ例:
  - **レンズA**: 受け入れ条件の Playwright 動作確認（実機相当の操作・スクショ証跡）
  - **レンズB**: `code-review` スキルでの差分のバグ／簡素化レビュー（読み取り専用、`--fix` なし）
  - **レンズC**: 仕様適合・回帰・申し送り整合のチェック
- 将来固定したくなれば専用定義へ切り出せる（今は最小・可逆を優先）。

### 3. `CLAUDE.md` の更新（既存フローは消さず追記）

現行の「サブエージェント自動連携フロー」は残し、その下に **「Agent Teams 版レビューフロー（実験）」** を追記する。

フロー:

1. **planner（サブエージェント）** → ブランチ・仕様書。※現行どおり変更なし。
2. **developer（サブエージェント）** → 実装・PR 作成。※現行どおり変更なし。
3. **review = チーム**: リードが `reviewer` 型で複数チームメイトを起動 → 各レンズで並列レビュー → **チームメイト同士が直接メッセージで指摘を突き合わせ**（矛盾・重複の解消、相互チャレンジ）→ 1つの総合 PR コメントに集約。
4. **要修正ループ**: チームの総合指摘を **developer（サブエージェント）** へ渡して再実装 → 再度レビューチームへ。最大3回は現行どおり（無限ループ防止）。
5. リードがチームを **cleanup**（`~/.claude/teams/`・`~/.claude/tasks/` は自動削除。cleanup はリードのみが実行）。

引き継ぎ情報（ブランチ名・仕様書パス・PR番号）は現行同様、前段の完了報告から抽出した実値で渡す。

## 既知の制限・注意（ドキュメント由来）

- 実験的機能。**トークン消費は単一セッションより大幅増**（各チームメイトが独立 Claude インスタンス）。ルーチンな確認には不向き。
- `/resume`・`/rewind` で in-process チームメイトは復元されない → 中断したら作り直す。
- タスク完了マークがラグることがある → 詰まったらリードに促す／手動更新。
- 同時に1チームのみ／チームのネスト不可／リードは固定／権限は spawn 時にリード設定を継承。
- 品質ゲートが必要なら `TeammateIdle` / `TaskCreated` / `TaskCompleted` フックで強制可能（今回のスコープ外）。

## スコープ外（YAGNI）

- planner / developer のチーム化（逐次のためサブエージェントのまま）。
- 複数 developer による並列実装・モジュール分割。
- reviewer レンズ専用の新規エージェント定義ファイル。
- フックによる品質ゲートの自動強制。

## 受け入れ条件

1. `.claude/settings.json` に `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` と `teammateMode: "in-process"` が入っており、JSON として妥当。
2. `.claude/agents/{planner,developer,reviewer}.md` は変更されていない（reviewer はチーム再利用、planner/developer は逐次のまま）。
3. `CLAUDE.md` に既存フローを残したまま「Agent Teams 版レビューフロー」が追記され、planner/developer がサブエージェント・review がチームである旨が明記されている。
4. 設定を無効化（env を `"0"`／削除）すれば現行サブエージェント運用に戻せる旨がドキュメントに記載されている。

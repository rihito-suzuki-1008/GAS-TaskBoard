# design.md

このドキュメントは、`docs/要件定義書.md` / `docs/基本設計書.md` の実装における**見た目・振る舞いの仕様書**です。機能は正しく動くようになったが、デザインの指示が一切出ていなかったため、ブラウザ標準UI（`prompt()`等）やテキスト直書きの空状態、素のネイティブ`<select>`など「安っぽく直感的でない」実装になってしまった。本書はそれを是正するためのものです。

**フロントエンドを実装・修正する際は、このドキュメントのトークン・コンポーネント仕様を必ず使うこと。** 独自に色やコンポーネントを判断して作らないこと。

---

## 0. 最優先で直すべき既知の問題（今回のダメ出しへの直接対応）

- ノード追加・確認・警告に `prompt()` / `confirm()` / `alert()` を使わない → **2.2 モーダル/ドロワー** のコンポーネントを必ず使う
- 看板の空列に「空」等のベタ書きテキストを表示しない → **2.5 空状態** を使う
- タスク詳細は画面中央のモーダルではなく、**右からスライドインするドロワー**にする → **2.2** 参照
- ネイティブ`<select>`をそのまま使わない（OSごとに見た目が崩れて安っぽく見える）→ **2.3 カスタムドロップダウン** を全選択UIで共通利用する

---

## 1. デザイントークン

以下をグローバルCSS（`:root`）にそのまま定義し、以降すべてのコンポーネントはこのトークンのみを参照すること。ハードコードされた色・px値を個別コンポーネントに書かない。

```css
:root {
  /* --- Color: Surface --- */
  --color-canvas: #F6F7F5;       /* 画面全体の背景 */
  --color-surface: #FFFFFF;      /* カード・パネル・モーダルの背景 */
  --color-surface-raised: #FFFFFF;
  --color-border: #E2E4E1;
  --color-border-strong: #C7CBC7;

  /* --- Color: Text --- */
  --color-text-primary: #1C2321;
  --color-text-secondary: #667066;
  --color-text-tertiary: #98A098;
  --color-text-on-accent: #FFFFFF;

  /* --- Color: Accent（プライマリアクション） --- */
  --color-accent: #1E6F5C;
  --color-accent-hover: #17594A;
  --color-accent-subtle: #E4F0EC;  /* accentの淡色版。選択中の背景等 */

  /* --- Color: Semantic --- */
  --color-danger: #C24444;
  --color-danger-subtle: #F8E9E9;
  --color-warning: #B8862B;
  --color-warning-subtle: #F6EEDD;

  /* --- Color: Priority --- */
  --color-priority-high: #C24444;
  --color-priority-mid: #B8862B;
  --color-priority-low: #5B7A99;

  /* --- Typography --- */
  --font-ui: "Inter", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", monospace; /* 日付・時刻・ID等の数値情報専用 */

  --text-xs: 12px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-md: 16px;
  --text-lg: 20px;
  --text-xl: 24px;

  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;

  /* --- Spacing（4pxグリッド） --- */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;

  /* --- Radius --- */
  --radius-sm: 6px;   /* input, button, chip内部要素 */
  --radius-md: 8px;   /* card, button, input */
  --radius-lg: 12px;  /* modal, drawer, dropdown panel */
  --radius-pill: 999px; /* badge, tag */

  /* --- Shadow --- */
  --shadow-sm: 0 1px 2px rgba(28, 35, 33, 0.06);
  --shadow-md: 0 4px 12px rgba(28, 35, 33, 0.08);
  --shadow-lg: 0 12px 32px rgba(28, 35, 33, 0.16);

  /* --- Motion --- */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --duration-fast: 120ms;
  --duration-base: 180ms;
  --duration-drawer: 240ms;
}
```

フォントは `<head>` で Google Fonts から読み込む（GASのHTML Serviceはクライアント側でのCDN読み込みを許容する）。

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

**このパレット・書体を選んだ理由**：暖色クリーム背景＋セリフ体、漆黒背景＋ネオンアクセント、罫線だらけの新聞レイアウト——このあたりは「AIが作った感」の出る典型パターンなので避けた。今回は「落ち着いた紙のようなニュートラル背景＋深緑がかったティール1色のアクセント」という、業務ツールとして長時間見ても疲れない配色にしている。**この方向性を勝手に別の配色（紫グラデーション、ダークモード基調等）に変えないこと。**

---

## 2. コンポーネント仕様

### 2.1 ボタン

| 種類 | 用途 | スタイル |
|---|---|---|
| Primary | 保存・作成など主操作 | `background: var(--color-accent)`, 文字は `--color-text-on-accent`, hoverで`--color-accent-hover` |
| Secondary | キャンセル・補助操作 | 背景透明、`border: 1px solid var(--color-border-strong)`、hoverで`--color-canvas`背景 |
| Ghost | アイコンボタン等、控えめな操作 | 背景・枠線なし、hoverでのみ`--color-canvas`背景 |
| Destructive | 削除等の破壊的操作 | 通常時は`--color-danger`のテキスト＋透明背景、hoverで`--color-danger-subtle`背景。**確認モーダルを必ず経由し、ボタン単体で即実行しない** |

全ボタン共通：`border-radius: var(--radius-md)`、`padding: var(--space-2) var(--space-4)`、`font-weight: var(--weight-medium)`、`transition: background var(--duration-fast) var(--ease-standard)`。

### 2.2 モーダル / ドロワー（最重要）

**`window.prompt()` / `window.confirm()` / `window.alert()` は一切使用しない。** すべて以下の自作コンポーネントで代替する。

**a) タスク詳細ドロワー（右スライドイン）**
既存ノードを開く・編集する画面はこちら。

- 画面右端から幅 `480px`（デスクトップ）でスライドイン。モバイル幅では画面幅の100%。
- 背景に半透明オーバーレイ `rgba(28, 35, 33, 0.32)` を敷き、オーバーレイクリックまたはEscキーで閉じる。
- アニメーション：`transform: translateX(100%)` → `translateX(0)`、`var(--duration-drawer) var(--ease-standard)`。
- `box-shadow: var(--shadow-lg)`、背景は`--color-surface`。
- 閉じるボタンは左上、「×」アイコンのみ（Ghostボタン）。

**b) 標準モーダル（中央出現）**
新規ノード作成、削除確認、列の追加・編集など、**短い入力・確認**に使う。

- 画面中央、`max-width: 440px`、`border-radius: var(--radius-lg)`、`box-shadow: var(--shadow-lg)`。
- アニメーション：`opacity 0→1` + `scale(0.98)→scale(1)`、`var(--duration-base)`。
- 削除確認モーダルは、対象名と影響件数（例：「このタスクと子タスク3件を削除します」）を必ず表示する。「削除」ボタンは Destructive スタイル。

### 2.3 カスタムドロップダウン

ステータス選択・優先度選択・担当者選択・完了列指定など、**選択を伴うUIすべてで共通の1コンポーネントを使う**。ネイティブ`<select>`の素の見た目のまま使わない。

- 見た目はボタン風：現在の選択値（アイコン/色ドット＋テキスト）＋右端にシェブロンアイコン。`border: 1px solid var(--color-border)`, `border-radius: var(--radius-md)`, 背景`--color-surface`。
- クリックでフローティングパネルが下に開く（`box-shadow: var(--shadow-md)`, `border-radius: var(--radius-lg)`, 背景`--color-surface`）。
- 各選択肢はホバーで`--color-canvas`背景、選択中の項目は`--color-accent-subtle`背景＋チェックアイコン。
- 担当者選択は複数選択可のため、選択済みは丸いアバターチップとしてトリガーボタン内に並べて表示する。
- キーボード操作（↑↓で移動、Enterで確定、Escで閉じる）とフォーカスリング（2.7参照）を必ず実装する。

### 2.4 カード（看板ビュー）

- `background: var(--color-surface)`, `border: 1px solid var(--color-border)`, `border-radius: var(--radius-md)`, `padding: var(--space-3) var(--space-4)`。
- 通常時は`--shadow-sm`、ホバー時は`--shadow-md`に遷移（`var(--duration-fast)`）。ドラッグ中は`--shadow-lg`＋わずかな`rotate(1deg)`。
- カード内レイアウト（上から）：タイトル（`--text-base`, `--weight-medium`）／タグ（あれば、小さいpillバッジ）／下段に担当者アバター（複数は重なり表示）と期限バッジを横並び。
- 期限バッジ：通常は`--color-text-tertiary`、期限3日以内は`--color-warning-subtle`背景＋`--color-warning`文字、超過は`--color-danger-subtle`背景＋`--color-danger`文字。
- 優先度：カード左端に3px幅の縦バーとして色表示（テキストラベルではなく色で表現し、視覚的なノイズを増やさない）。`--color-priority-high/mid/low`を使用。

### 2.5 空状態（Empty State）

要件の「必要最低限のシンプルなUI」「余計な文言を入れない」に従い、**説明文を書き並べない**。

- 看板の空列：`border: 1px dashed var(--color-border-strong)`, `border-radius: var(--radius-md)`の領域を列の高さいっぱいに表示。中央に控えめな「＋」アイコン（`--color-text-tertiary`）のみ。文言は入れない。クリックでその場に新規タスク作成モーダルを開く。
- リストビューが空の場合：中央に小さいアイコン＋1行だけ短い行動喚起（例：「最初のタスクを追加」）をボタンとして提示する。状態説明の長文は書かない。
- ドラッグ中のドロップ先ハイライト：`background: var(--color-accent-subtle)`をその領域に一瞬表示。

### 2.6 トースト通知

保存キュー（基本設計書4.7）の結果、競合警告、カスケードリスケジュール通知などに使う。

- 画面右下にスタック表示。`background: var(--color-surface)`, `box-shadow: var(--shadow-md)`, `border-radius: var(--radius-md)`, 左端に4px幅のカラーバー（成功=accent、警告=warning、エラー=danger）。
- 通常の成功通知（例：「後続タスク3件の日程を自動調整しました」）は3秒で自動的に消える。
- 競合警告（他のユーザーが更新しました）は自動で消さず、「最新の内容を見る」ボタンを常設し、ユーザー操作で閉じる。

### 2.7 フォーカス・アクセシビリティ

すべてのインタラクティブ要素（ボタン、カスタムドロップダウン、カード、入力欄）はキーボードフォーカス時に視覚的なフォーカスリングを表示する。

```css
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

### 2.8 保存中インジケーター

楽観的更新（基本設計書4.7）に対応し、保存確定を待っている個々のノードには**そのノードの近傍にだけ**小さいインジケーター（カード右上に小さい脈動ドット等）を出す。画面全体をブロックするフルスクリーンスピナーは使わない。

### 2.9 ガントチャート特有のビジュアル

- バー：`border-radius: 4px`、ベースは`--color-accent-subtle`、進捗率(%)分だけ`--color-accent`で塗りつぶす（バー内部に進捗バーが埋め込まれている形）。
- 依存関係の矢印：`stroke: var(--color-text-tertiary)`, `stroke-width: 1.5px`、矢印の終端にシンプルな三角マーカー。ホバーで対象タスク・矢印を`--color-accent`にハイライト。
- 今日の日付：縦の基準線を`--color-danger`の細線（1px）で表示。
- ズーム切り替え（日/週/月）：セグメントコントロール風のボタン群、選択中は`--color-accent-subtle`背景。

### 2.10 子ノード追加操作

「親子関係を先に確定させてから、名称・日程などの詳細をドロワーで詰める」という順序を、リストビュー・ガントビューで共通の考え方として採用する。

**リストビュー**：行にカーソルを合わせると行末に「＋」アイコン（2.1のGhostボタン相当）が現れる。クリックすると、その場に子ノードとして即座に`addNode`を実行し、破線境界（`border: 1px dashed var(--color-border-strong)`）のプレースホルダー行として挿入する。同時にタスク詳細ドロワー（2.2a）が開き、名称入力欄に自動でフォーカスが当たった状態にする。「作成」ボタンによる明示的な確定操作は挟まない。

**ガントビュー**：親ノードの行の子インデント位置にあたるタイムライン領域を左右にドラッグすることで、期間（開始日・終了日）を直接指定する。ドラッグを離した時点で子ノードを`addNode`（StartDate/EndDateを指定値で）作成し、同様に詳細ドロワーを名称フォーカス状態で開く。

**共通の後処理ルール**：
- ドロワーを閉じる際、名称が未入力かつ他のフィールドも初期値から変更されていない場合、作成したshellノードは自動的に削除する（ゴミの「無題のタスク」を残さないため）。
- shellノード作成時の初期値：StatusColumnIdは先頭のステータス列、SortOrderは兄弟内の末尾、ParentIdは操作元のノード。

**看板ビュー**：階層構造とカンバンのレイアウトは相性が悪いため、子タスク追加はこの直接操作の対象外とする。従来通り、詳細ドロワーからの「子タスクを追加」操作で行う。

**補助操作（余力があれば）**：リストビューで行にフォーカスした状態でTabキーを押すと、直前の行の子としてインデントする（Shift+Tabで1階層アウトデント）。内部的には既存のドラッグ&ドロップによる親付け替えと同じ処理を呼び出す。

---

- 能動態・現在形で、ユーザーが今できることをそのまま書く（例：「削除」ではなく「タスクを削除」、「送信」ではなく「保存」）。
- ボタンの文言とその結果のトースト文言は同じ動詞を使う（「削除」ボタン→「削除しました」）。
- エラーメッセージは謝罪しない。何が起きたか・次に何をすればよいかだけを書く。
- 空状態は「情報の欠如」ではなく「次にできる行動への誘い」として設計する（2.5参照）。
- 「〜してください」「〜になります」等の冗長な敬体は避け、体言止め・簡潔な言い切りを基本とする。

---

## 4. やってはいけないこと（禁止事項まとめ）

- `prompt()` / `confirm()` / `alert()` の使用
- 空状態・エラー状態への長い説明文のベタ書き
- ネイティブ`<select>`の素のスタイルをそのまま使うこと
- 詳細編集を中央モーダルで実装すること（右ドロワーであること）
- フルスクリーンのブロッキングスピナー（楽観的更新の方針に反する）
- トークン（1章）にない色・px値をコンポーネントに直接ハードコードすること
- このドキュメントで定めたパレット・書体構成を、実装側の判断で別の方向性に変更すること
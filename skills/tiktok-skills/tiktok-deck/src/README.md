# src

PowerPoint 生成コード（pptxgenjs）。入口は `generate.js`（`node src/generate.js --case <案件> --mode <ステータス>`）。

```text
src/
├── generate.js            … 資料モード（MODES）と章の並び。初訪は firstVisit.js へ分岐
├── theme.js               … 寸法・色・書体のトークン
├── helpers/
│   ├── inputParser.js     … INPUT.md → 構造化データ
│   ├── data.js            … 欠損判定（[DATA NOT PROVIDED]）と表記統一
│   ├── text.js            … 文字量に応じた級数の決定（収まらなければ QA ログ）
│   ├── image.js / imageBox.js … 画像の解決と縦横比を保った配置
│   └── caseRoot.js        … --case の解決
├── components/
│   ├── slideBase.js       … 標準ページ・PART扉・フッター
│   ├── storySlide.js      … 初訪（ストーリー型）のページ
│   ├── insightBox.js / metricCard.js / comparisonTable.js
└── slides/                … 章ごとのページ（analysis / keywords / mentions / videos / reviews / platforms / summary / firstVisit）
```

手順と章構成の正本は `../SKILL.md`。

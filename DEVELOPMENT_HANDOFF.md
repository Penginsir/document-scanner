# ドキュメントスキャナー — 開発引き継ぎ資料

このファイルは、別のAI(またはエンジニア)がこのプロジェクトの開発を**ゼロから文脈を持たずに引き継げる**ことを目的にまとめた資料です。要件がどう固まったか、なぜその技術選定をしたか、何にハマってどう直したかを、結論だけでなく経緯込みで書いています。特に「6. 発生した不具合と修正」は同じ失敗を繰り返さないために重要です。

作成日: 2026-07-12(このセッション内で構築・修正が完結)

---

## 0. 30秒でわかるサマリ

- **何を作ったか**: スマホのブラウザで起動する、カメラ撮影→OCR→検索可能PDF出力の「ドキュメントスキャナー」Webアプリ。
- **出力**: 1回のスキャンにつき、テキスト層(透明・検索可能)付きPDFを**1つだけ**。複数ページ結合や画像単体出力は非対応。
- **品質ゲート**: OCRで文字として認識できなかった割合が**30%を超えたら**(＝認識成功率が70%未満なら)スキャンを拒否し、PDFを生成しない。
- **技術**: 完全クライアントサイド(サーバーなし)。カメラ`getUserMedia` + Tesseract.js(端末内OCR、日本語+英語) + pdf-lib(PDF生成、透明テキスト層埋め込み)。ビルド不要、CDN読み込みの素のHTML/CSS/JS。
- **公開先**: GitHub Pages → **https://penginsir.github.io/document-scanner/**
- **リポジトリ**: **https://github.com/Penginsir/document-scanner** (public)
- **現在の状態**: 一通り実装・デプロイ・実データでの不具合修正まで完了。既知のバグは無し(本資料作成時点)。

---

## 1. 要件(最終形)

1. スマホのブラウザで起動し、カメラでドキュメントをスキャンできる
2. 出力は **PDF1つだけ**。しかも**テキスト層(検索・コピー可能な透明文字)付き**であること
3. スキャン対象のうち、**文字として認識できなかった文字列の割合が70%を超える(＝認識成功率が70%未満)場合はスキャンそのものを拒否**し、PDFを作らせない(品質ゲート)
4. OCRは端末内(プライバシー・コスト重視、クラウドAPIは使わない)
5. 対応言語は日本語+英語
6. 複数ページ結合は**非対応**(1回のスキャン=1ページ=1PDF)
7. 専門知識のないユーザーでもスマホで使えること → 最終的に「URLを送るだけで使える」形(GitHub Pages配信)に着地

---

## 2. 要件が固まるまでの経緯(重要な意思決定ログ)

### 2.1 「70%」ルールの解釈が2回揺れた

最初のユーザー発言は次の通りだった:

> スキャンしようとしているドキュメントのうちテキスト化できない文字列が70%以下ではスキャンそのものができない。

これは文字通り読むと「認識できない文字列の割合が70%**以下**(＝わりと綺麗に読めている状態)ならスキャンできない」となり、実用上は逆(汚い書類ほど通る)になってしまう。この矛盾を指摘した上でAskUserQuestionを実施し、いったん次の仕様で確定して実装した:

- **1回目の実装**: `MAX_FAILURE_RATE = 0.70`(失敗率が70%を**超えたら**拒否。つまり成功率30%以上あれば保存できる、かなり緩い基準)

その後、実際にユーザーが自分のスマホの薬品ラベルの写真をスキャンしたところ、**実用に耐えないゴミだらけのテキスト層のPDFが「合格」してしまった**。実測値は以下:

- 単語数153、失敗率(信頼度60未満を失敗扱い) **55.3%**
- 当時の基準(70%まで許容)では合格 → だが内容は「胃腸を元気に」等の正しい語と、`"Rics"` `"TETT"` `"[EEERE"` のような完全なゴミが混在する状態で、ユーザー体感としては「ほぼ読めていない」

ユーザーから「文字認識率が70%以上じゃないと保存させないんじゃなかったっけ?」と指摘があり、**「失敗率70%まで許容」と「成功率70%以上を要求」は全く違う基準だった**ことが判明。後者(成功率70%以上=失敗率30%以下)が本来の意図だったため、下記に修正した。

- **最終(現行)実装**: `MAX_FAILURE_RATE = 0.30`(失敗率が30%を**超えたら**拒否。成功率70%以上でないと保存できない、厳しめの基準)

このやり取りから得られる教訓: **「XX%」という閾値の話をするときは、必ず「失敗率base」か「成功率base」かを具体的な数値例(例:『失敗率55%のドキュメントは保存されるべきか?』)で確認すること。** 言葉の言い回しだけでは同じ人間同士でも解釈がブレる。

### 2.2 OCR実行場所・対応言語・複数ページ(AskUserQuestionで一発確定、以降ブレなし)

- OCR: 「端末内(Tesseract.js)」を選択(クラウドOCRより精度は落ちるが、サーバー不要・プライバシー・無料コストを優先)
- 言語: 「日本語+英語」
- 複数ページ: 「単一ページのみ」

### 2.3 配布方法の転換: ファイル送信 → URL共有

当初ユーザーは「WhatsAppでHTMLファイルをスマホに送って、そのまま使える形にしたい」と要望した。しかし **`getUserMedia`(カメラAPI)はセキュアコンテキスト(HTTPSまたはlocalhost)必須** で、`file://` として開いたHTMLファイルではブラウザ側の制約でカメラが起動できない。これは回避不可能な仕様上の制約。

この制約を説明した上で、代替案として「無料の静的ホスティング(GitHub Pages / Netlify / Vercel)にデプロイし、できあがった1本のURLをWhatsApp等で送る」方式を提案し、了承を得た。ユーザーが既にGitHubアカウントを持っていたため、GitHub Pagesを採用。

**教訓: 「ファイルを送ってそのまま使えるようにしたい」という要望が来たら、対象機能がカメラ・マイク・位置情報などセキュアコンテキスト必須のWeb APIを使うかどうかを真っ先に確認すること。** 使う場合、file://配布は原理的に不可能。

---

## 3. アーキテクチャ・技術選定

### 3.1 全体構成

完全にクライアントサイドで完結する、ビルド不要の静的サイト。サーバーサイドの処理は一切ない。

```
[スマホのブラウザ]
   ├─ カメラ撮影 (getUserMedia + <canvas>)
   ├─ OCR (Tesseract.js, WASM, 端末内実行)
   ├─ 失敗率判定 (JSで単語ごとのconfidenceを集計)
   └─ PDF生成 (pdf-lib, 端末内実行) → Blob → ダウンロードリンク
```

外部通信が発生するのは以下のみ(すべて静的アセットの取得。画像やOCR結果は一切外部送信されない):

| 何を | どこから |
|---|---|
| アプリ本体(HTML/CSS/JS/フォント) | GitHub Pages (`penginsir.github.io`) |
| Tesseract.js本体・Workerスクリプト・OCRエンジン(WASM)・言語データ(jpn/eng) | jsDelivr CDN (`cdn.jsdelivr.net`) |
| pdf-lib / @pdf-lib/fontkit | jsDelivr CDN |

実際にPlaywrightでネットワーク通信を記録して確認済み(下記「7.3」参照)。通信先はこの2ホストのみ。

### 3.2 なぜこの技術を選んだか

- **サーバーなし・完全クライアントサイド**: プライバシー(画像を外部送信したくない)、コスト(サーバー・API課金不要)、デプロイの単純さ(静的ファイルのみ)を優先。ユーザーがAskUserQuestionで「端末内OCR」を選択したことに合わせた設計。
- **Tesseract.js (v5)**: オープンソースのTesseract OCRエンジンをWASM化したもの。ブラウザ内で追加インストールなしにOCRが動く。精度はクラウドOCR(Google Cloud Visionなど)に劣るが、要件上サーバーを使わない前提なのでこれが実質唯一の選択肢。
- **pdf-lib**: JS(ブラウザ)で完結するPDF生成ライブラリ。画像埋め込み+カスタムフォントでのテキスト描画+フォントサブセット化に対応しており、「見た目は写真、裏に透明な検索可能テキスト」という一般的な「サーチャブルPDF(OCR PDF)」の仕組みを自前実装できる。
- **Noto Sans JP(可変フォント)を埋め込み**: 透明テキスト層に日本語グリフを描画するには、日本語グリフを含むフォントをPDFに埋め込む必要がある。Google Fontsの `google/fonts` リポジトリから可変フォント版(約9.5MB)を取得し、`fontkit`(pdf-lib公式のフォントパーサ)経由で**サブセット化**(実際に使われたグリフだけを埋め込む)することで、最終PDFのサイズを抑えている。フォント自体はOFLライセンスで再配布可。
- **CDN経由でライブラリ読み込み(ビルドツールなし)**: `npm install` やバンドラを使わず `<script src="https://cdn.jsdelivr.net/...">` で読み込む素朴な構成。ビルドステップが要らないので、そのままどんな静的ホスティングにもデプロイできる。

### 3.3 PDF生成の仕組み(サーチャブルPDFの作り方)

1. 撮影したフレームをcanvasからJPEG化し、`pdfDoc.embedJpg()` でPDFページの背景画像として全面に描画
2. OCRで得た各「単語」について、そのバウンディングボックス(bbox)の位置・サイズに合わせて `page.drawText()` で文字を描画するが、**視覚的に見えないよう `opacity: 0` を指定**(詳細は6.2)
3. これにより、見た目は撮影した写真そのまま、かつテキスト選択・検索・コピーが可能なPDFになる
4. ページサイズはA4幅(595.28pt)に正規化し、画像の縦横比を保って高さを決定

---

## 4. ファイル構成

```
0000_Claude_Code/
├── index.html                    # 画面構造(6画面のSPA的切り替え)
├── style.css                     # スタイル(ダークテーマ、モバイル最適化)
├── app.js                        # カメラ制御・OCR・PDF生成の全ロジック
├── README.md                     # ユーザー向け説明(起動方法・仕組み)
├── .gitignore                    # *.pdf を除外(個人のスキャン結果を誤コミットしないため)
├── DEVELOPMENT_HANDOFF.md        # このファイル
└── fonts/
    └── NotoSansJP-Regular.ttf    # PDFテキスト層埋め込み用(約9.5MB、可変フォント)
```

以下、全ファイルの現在のソースを掲載する(本資料作成時点の最新版)。

### 4.1 index.html

```html
<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>ドキュメントスキャナー</title>
<link rel="stylesheet" href="style.css" />
</head>
<body>
  <header class="app-header">
    <h1>ドキュメントスキャナー</h1>
    <p class="subtitle">テキスト層付きPDFを1枚生成します</p>
  </header>

  <main id="app">

    <!-- 起動前の警告(非HTTPS等) -->
    <div id="insecure-warning" class="banner banner-warn hidden">
      カメラを使うには HTTPS(または localhost)での接続が必要です。
    </div>

    <!-- 1. スタート画面 -->
    <section id="screen-start" class="screen">
      <p class="lead">書類全体が枠に収まるように、明るい場所で撮影してください。</p>
      <button id="btn-start-camera" class="btn btn-primary">カメラを起動</button>
      <div id="camera-error" class="banner banner-error hidden"></div>
    </section>

    <!-- 2. カメラ画面 -->
    <section id="screen-camera" class="screen hidden">
      <div class="camera-wrap">
        <video id="video" autoplay playsinline muted></video>
        <div class="guide-frame"></div>
      </div>
      <div class="controls">
        <button id="btn-cancel-camera" class="btn btn-secondary">キャンセル</button>
        <button id="btn-capture" class="btn btn-primary btn-large">撮影</button>
      </div>
    </section>

    <!-- 3. プレビュー画面 -->
    <section id="screen-preview" class="screen hidden">
      <div class="preview-wrap">
        <img id="preview-img" alt="撮影した書類のプレビュー" />
      </div>
      <div class="controls">
        <button id="btn-retake" class="btn btn-secondary">撮り直す</button>
        <button id="btn-run-ocr" class="btn btn-primary">この写真で文字認識する</button>
      </div>
    </section>

    <!-- 4. 処理中画面 -->
    <section id="screen-processing" class="screen hidden">
      <div class="spinner" aria-hidden="true"></div>
      <p id="processing-label">文字を認識しています…</p>
      <div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div>
      <p id="progress-pct" class="progress-pct">0%</p>
    </section>

    <!-- 5. 失敗画面(失敗率30%超で拒否 = 成功率70%未満) -->
    <section id="screen-rejected" class="screen hidden">
      <div class="result-icon result-icon-fail">✕</div>
      <h2>スキャンできませんでした</h2>
      <p>認識できなかった文字の割合が <strong id="rejected-rate">--</strong> でした(基準:認識成功率70%以上)。</p>
      <p class="hint">明るい場所で、書類を正面から大きく・水平に写して再度お試しください。ピント合わせのため少し離れてから撮ると安定します。</p>
      <div class="controls">
        <button id="btn-retry-from-rejected" class="btn btn-primary">再撮影する</button>
      </div>
    </section>

    <!-- 6. 成功画面 -->
    <section id="screen-success" class="screen hidden">
      <div class="result-icon result-icon-ok">✓</div>
      <h2>PDFを生成しました</h2>
      <p>文字認識の成功率: <strong id="success-rate">--</strong></p>
      <div class="controls">
        <a id="btn-download" class="btn btn-primary" download>PDFをダウンロード</a>
        <button id="btn-scan-again" class="btn btn-secondary">もう一度スキャンする</button>
      </div>
    </section>

  </main>

  <canvas id="capture-canvas" class="hidden"></canvas>
  <canvas id="ocr-canvas" class="hidden"></canvas>

  <script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

### 4.2 style.css

```css
:root {
  --bg: #0f1216;
  --surface: #1b2028;
  --surface-2: #242b35;
  --text: #eef1f5;
  --text-dim: #9aa4b2;
  --accent: #4f8cff;
  --accent-dim: #2f5fc4;
  --danger: #ff5d5d;
  --ok: #33c37a;
  --radius: 14px;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", Roboto, sans-serif;
  min-height: 100%;
}

.app-header {
  padding: 20px 20px 8px;
  text-align: center;
}
.app-header h1 { font-size: 1.3rem; margin: 0 0 4px; }
.subtitle { margin: 0; color: var(--text-dim); font-size: 0.85rem; }

#app {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px;
}

.screen { display: flex; flex-direction: column; gap: 16px; align-items: stretch; }
.hidden { display: none !important; }

.lead { color: var(--text-dim); text-align: center; margin: 8px 0; }

.btn {
  appearance: none;
  border: none;
  border-radius: 999px;
  padding: 14px 22px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.05s ease, opacity 0.15s ease;
}
.btn:active { transform: scale(0.97); }
.btn-primary { background: var(--accent); color: white; }
.btn-primary:hover { background: var(--accent-dim); }
.btn-secondary { background: var(--surface-2); color: var(--text); }
.btn-large { padding: 18px 28px; font-size: 1.1rem; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.controls { display: flex; gap: 10px; }
.controls .btn { flex: 1; }

.banner {
  border-radius: var(--radius);
  padding: 12px 14px;
  font-size: 0.9rem;
  line-height: 1.5;
}
.banner-warn { background: #4a3a12; color: #ffd479; }
.banner-error { background: #4a1f1f; color: #ffb0b0; }

.camera-wrap, .preview-wrap {
  position: relative;
  border-radius: var(--radius);
  overflow: hidden;
  background: #000;
  aspect-ratio: 3 / 4;
  display: flex;
  align-items: center;
  justify-content: center;
}
#video, #preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.guide-frame {
  position: absolute;
  inset: 6% 6%;
  border: 2px dashed rgba(255,255,255,0.65);
  border-radius: 10px;
  pointer-events: none;
}

.spinner {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 4px solid var(--surface-2);
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
  margin: 24px auto 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

#screen-processing, #screen-rejected, #screen-success {
  text-align: center;
  padding-top: 24px;
}

.progress-bar {
  width: 100%;
  height: 10px;
  background: var(--surface-2);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 8px;
}
.progress-fill {
  height: 100%;
  width: 0%;
  background: var(--accent);
  transition: width 0.15s ease;
}
.progress-pct { color: var(--text-dim); font-size: 0.85rem; margin: 6px 0 0; }

.result-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.8rem;
  margin: 0 auto 8px;
}
.result-icon-fail { background: #4a1f1f; color: var(--danger); }
.result-icon-ok { background: #103a26; color: var(--ok); }

.hint { color: var(--text-dim); font-size: 0.85rem; }
```

### 4.3 app.js (現行・修正済み版)

```javascript
"use strict";

/* ==========================================================================
   設定
   ========================================================================== */

// 単語ごとのOCR信頼度(0-100)がこの値未満なら「認識失敗」として扱う
const WORD_CONFIDENCE_THRESHOLD = 60;

// 失敗文字数の割合がこれを超えたらスキャンを拒否する
// = 認識成功率が70%未満(100% - MAX_FAILURE_RATE)のスキャンは保存させない
const MAX_FAILURE_RATE = 0.30;

// OCR言語(日本語 + 英語)
const OCR_LANGS = "jpn+eng";

// PDFページ幅をA4幅(pt)に正規化する
const PDF_TARGET_WIDTH_PT = 595.28;

const FONT_URL = "fonts/NotoSansJP-Regular.ttf";

/* ==========================================================================
   DOM参照
   ========================================================================== */

const els = {
  insecureWarning: document.getElementById("insecure-warning"),

  screens: {
    start: document.getElementById("screen-start"),
    camera: document.getElementById("screen-camera"),
    preview: document.getElementById("screen-preview"),
    processing: document.getElementById("screen-processing"),
    rejected: document.getElementById("screen-rejected"),
    success: document.getElementById("screen-success"),
  },

  btnStartCamera: document.getElementById("btn-start-camera"),
  cameraError: document.getElementById("camera-error"),

  video: document.getElementById("video"),
  btnCancelCamera: document.getElementById("btn-cancel-camera"),
  btnCapture: document.getElementById("btn-capture"),

  previewImg: document.getElementById("preview-img"),
  btnRetake: document.getElementById("btn-retake"),
  btnRunOcr: document.getElementById("btn-run-ocr"),

  processingLabel: document.getElementById("processing-label"),
  progressFill: document.getElementById("progress-fill"),
  progressPct: document.getElementById("progress-pct"),

  rejectedRate: document.getElementById("rejected-rate"),
  btnRetryFromRejected: document.getElementById("btn-retry-from-rejected"),

  successRate: document.getElementById("success-rate"),
  btnDownload: document.getElementById("btn-download"),
  btnScanAgain: document.getElementById("btn-scan-again"),

  captureCanvas: document.getElementById("capture-canvas"),
  ocrCanvas: document.getElementById("ocr-canvas"),
};

/* ==========================================================================
   状態
   ========================================================================== */

let mediaStream = null;
let capturedImageBitmapSize = { width: 0, height: 0 };
let capturedJpegDataUrl = null;
let lastObjectUrl = null;

/* ==========================================================================
   画面遷移
   ========================================================================== */

function showScreen(name) {
  for (const key of Object.keys(els.screens)) {
    els.screens[key].classList.toggle("hidden", key !== name);
  }
}

/* ==========================================================================
   カメラ
   ========================================================================== */

async function startCamera() {
  els.cameraError.classList.add("hidden");

  if (!window.isSecureContext) {
    els.insecureWarning.classList.remove("hidden");
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1440 },
      },
    });
  } catch (err) {
    els.cameraError.textContent =
      "カメラを起動できませんでした(" + (err && err.message ? err.message : err) + ")。ブラウザのカメラ権限をご確認ください。";
    els.cameraError.classList.remove("hidden");
    return;
  }

  els.video.srcObject = mediaStream;
  await els.video.play();
  showScreen("camera");
}

function stopCamera() {
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
    mediaStream = null;
  }
  els.video.srcObject = null;
}

function capturePhoto() {
  const video = els.video;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;

  const canvas = els.captureCanvas;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, w, h);

  capturedImageBitmapSize = { width: w, height: h };
  capturedJpegDataUrl = canvas.toDataURL("image/jpeg", 0.9);

  els.previewImg.src = capturedJpegDataUrl;
  stopCamera();
  showScreen("preview");
}

/* ==========================================================================
   OCR前処理(グレースケール + コントラスト強調)
   Tesseractへの入力専用。PDFの見た目には元のカラー画像を使う。
   ========================================================================== */

function buildOcrCanvas() {
  const src = els.captureCanvas;
  const w = src.width;
  const h = src.height;

  const out = els.ocrCanvas;
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.drawImage(src, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // グレースケール化
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }

  // コントラストの最小-最大正規化(ストレッチ)
  const range = Math.max(1, max - min);
  for (let i = 0; i < data.length; i += 4) {
    const v = ((data[i] - min) / range) * 255;
    data[i] = data[i + 1] = data[i + 2] = v;
  }

  ctx.putImageData(imageData, 0, 0);
  return out;
}

/* ==========================================================================
   OCR実行 + 失敗率判定
   ========================================================================== */

function setProgress(ratio, label) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  els.progressFill.style.width = pct + "%";
  els.progressPct.textContent = pct + "%";
  if (label) els.processingLabel.textContent = label;
}

async function runOcrPipeline() {
  showScreen("processing");
  setProgress(0, "文字を認識しています…");

  const ocrCanvas = buildOcrCanvas();

  const worker = await Tesseract.createWorker(OCR_LANGS, 1, {
    logger: (msg) => {
      if (msg.status === "recognizing text" && typeof msg.progress === "number") {
        setProgress(msg.progress, "文字を認識しています…");
      } else if (msg.status) {
        setProgress(0, translateStatus(msg.status));
      }
    },
  });

  let result;
  try {
    result = await worker.recognize(ocrCanvas, {}, { blocks: true, text: false });
  } finally {
    await worker.terminate();
  }

  const words = flattenWords(result.data.blocks).filter(
    (w) => w.text && w.text.trim().length > 0
  );

  let totalChars = 0;
  let failedChars = 0;
  for (const w of words) {
    const len = w.text.length;
    totalChars += len;
    if (w.confidence < WORD_CONFIDENCE_THRESHOLD) failedChars += len;
  }
  const failureRate = totalChars === 0 ? 1 : failedChars / totalChars;

  if (failureRate > MAX_FAILURE_RATE) {
    els.rejectedRate.textContent = formatPct(failureRate);
    showScreen("rejected");
    return;
  }

  setProgress(1, "PDFを生成しています…");
  await new Promise((r) => setTimeout(r, 0)); // UI更新を反映

  const pdfBytes = await buildSearchablePdf({
    jpegDataUrl: capturedJpegDataUrl,
    imgWidth: capturedImageBitmapSize.width,
    imgHeight: capturedImageBitmapSize.height,
    words,
  });

  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  lastObjectUrl = URL.createObjectURL(blob);

  const filename = "scan_" + timestampForFilename() + ".pdf";
  els.btnDownload.href = lastObjectUrl;
  els.btnDownload.download = filename;
  els.successRate.textContent = formatPct(1 - failureRate);

  showScreen("success");
}

function flattenWords(blocks) {
  const words = [];
  for (const block of blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const word of line.words || []) {
          words.push(word);
        }
      }
    }
  }
  return words;
}

function translateStatus(status) {
  const map = {
    "loading tesseract core": "OCRエンジンを読み込んでいます…",
    "initializing tesseract": "OCRエンジンを初期化しています…",
    "loading language traineddata": "言語データを読み込んでいます…",
    "initializing api": "準備しています…",
  };
  return map[status] || status;
}

function formatPct(ratio) {
  return Math.round(ratio * 1000) / 10 + "%";
}

function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/* ==========================================================================
   テキスト層付きPDF生成
   ========================================================================== */

let cachedFontBytes = null;

async function loadFontBytes() {
  if (cachedFontBytes) return cachedFontBytes;
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error("フォントの読み込みに失敗しました: " + res.status);
  cachedFontBytes = await res.arrayBuffer();
  return cachedFontBytes;
}

async function dataUrlToArrayBuffer(dataUrl) {
  const res = await fetch(dataUrl);
  return await res.arrayBuffer();
}

async function buildSearchablePdf({ jpegDataUrl, imgWidth, imgHeight, words }) {
  const { PDFDocument } = PDFLib;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = await loadFontBytes();
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  const jpegBytes = await dataUrlToArrayBuffer(jpegDataUrl);
  const jpgImage = await pdfDoc.embedJpg(jpegBytes);

  const scale = PDF_TARGET_WIDTH_PT / imgWidth;
  const pageWidth = imgWidth * scale;
  const pageHeight = imgHeight * scale;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  page.drawImage(jpgImage, { x: 0, y: 0, width: pageWidth, height: pageHeight });

  for (const w of words) {
    const text = w.text;
    if (!text || !text.trim()) continue;

    const bbox = w.bbox;
    const boxWidthPt = (bbox.x1 - bbox.x0) * scale;
    const boxHeightPt = (bbox.y1 - bbox.y0) * scale;
    if (boxWidthPt <= 0 || boxHeightPt <= 0) continue;

    let fontSize = boxHeightPt * 0.85;
    if (fontSize < 1) fontSize = 1;

    // 横幅がはみ出す場合はフォントサイズを縮めて選択範囲のズレを抑える
    let measuredWidth = 0;
    try {
      measuredWidth = font.widthOfTextAtSize(text, fontSize);
    } catch {
      continue; // フォントに存在しないグリフを含む場合はスキップ
    }
    if (measuredWidth > boxWidthPt && measuredWidth > 0) {
      fontSize = fontSize * (boxWidthPt / measuredWidth);
      if (fontSize < 1) fontSize = 1;
    }

    const xPt = bbox.x0 * scale;
    const yPt = pageHeight - bbox.y1 * scale;

    try {
      // pdf-lib の drawText() に "renderMode" オプションは存在しない(黙って無視される)ため、
      // 透明度0(ExtGState /ca 0)で視覚的に不可視化する。Tj自体は通常どおり出力されるため
      // 検索・選択・コピーは可能なまま。
      page.drawText(text, {
        x: xPt,
        y: yPt,
        size: fontSize,
        font,
        opacity: 0,
      });
    } catch {
      // フォントが対応しない文字が含まれる単語はテキスト層から除外する
      // (画像自体は表示されるため、視覚的な内容は失われない)
    }
  }

  return await pdfDoc.save();
}

/* ==========================================================================
   イベント配線
   ========================================================================== */

els.btnStartCamera.addEventListener("click", startCamera);
els.btnCancelCamera.addEventListener("click", () => {
  stopCamera();
  showScreen("start");
});
els.btnCapture.addEventListener("click", capturePhoto);

els.btnRetake.addEventListener("click", async () => {
  await startCamera();
});
els.btnRunOcr.addEventListener("click", () => {
  runOcrPipeline().catch((err) => {
    console.error(err);
    alert("処理中にエラーが発生しました: " + (err && err.message ? err.message : err));
    showScreen("preview");
  });
});

els.btnRetryFromRejected.addEventListener("click", async () => {
  await startCamera();
});
els.btnScanAgain.addEventListener("click", async () => {
  await startCamera();
});

if (!window.isSecureContext) {
  els.insecureWarning.classList.remove("hidden");
}
```

### 4.4 .gitignore

```
# スキャン結果(ユーザーの個人データ)を誤って公開リポジトリに含めないため
*.pdf
```

---

## 5. 発生した不具合と修正(最重要セクション)

このプロジェクトで実際に踏んだ地雷と、その直し方。**同じ実装をゼロから書き直す場合、以下は初回から回避できる。**

### 5.1 tesseract.js v5: `data.words` は存在しない

**症状**: 最初、`worker.recognize(image)` の戻り値 `result.data.words` を直接使おうとしたが、v5では**トップレベルの `words` 配列は存在しない**。

**原因**: tesseract.js v5では、デフォルトで `text` 出力しか返らない。単語のbbox・confidenceが欲しい場合は `output` 引数で明示的に `{ blocks: true }` を指定する必要があり、しかも返ってくるのは `data.blocks[].paragraphs[].lines[].words[]` という階層構造であって、フラットな `data.words` ではない。

**対処**(実装済み):

```javascript
const result = await worker.recognize(ocrCanvas, {}, { blocks: true, text: false });

function flattenWords(blocks) {
  const words = [];
  for (const block of blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const word of line.words || []) {
          words.push(word);
        }
      }
    }
  }
  return words;
}
```

**教訓**: バージョンが変わったライブラリのAPIは、公式docsの説明文だけでなく型定義ファイル(`.d.ts`)や実際のソースを当たること。AIによる要約(WebFetchの結果など)は誤りうる。実際、この後の5.2でさらに深刻な誤情報に当たった。

### 5.2 【最重要】pdf-lib: `drawText()` に `renderMode` オプションは存在しない

**症状**: OCRテキスト層を「透明(不可視)」にする目的で `page.drawText(text, { ..., renderMode: TextRenderingMode.Invisible })` を実装し、`pdf-lib` は `TextRenderingMode.Invisible` というenumも実際に export している(ここまでは事実)。実装当初のテスト(pypdfでのテキスト抽出確認)ではすべて成功していたため、しばらく気づかなかった。しかし後日、**ユーザーが実際にスキャンしたPDFを開いたところ、本来不可視のはずのOCRテキストが黒い文字としてそのまま見えていた**(「謎の文字列が写真に見えている」と報告)。

**原因の特定方法**: PyMuPDF (`fitz`) でPDFの生コンテンツストリームを直接ダンプしたところ、`Tr`(テキストレンダリングモード)オペレータが**一つも存在せず**、代わりに `0 0 0 rg`(黒色で塗りつぶし)が入っており、`Tj`(文字表示)が通常の可視モード(デフォルトのレンダリングモード0=塗りつぶし)で実行されていることが判明。

**根本原因**: pdf-libの実際のソースコード(GitHub上の `src/api/PDFPage.ts` の `drawText()` 実装、および `PDFPageDrawTextOptions` 型定義)を直接確認したところ、**`drawText()` は `renderMode` というオプションを一切受け付けていない**。pdf-libの高レベルAPIである `drawText()` は内部で `assertOrUndefined` によるオプション検証を行っているが、そこに `renderMode` は含まれておらず、渡しても**型エラーにも実行時エラーにもならず単に無視される**(JSはオブジェクトの余剰プロパティを黙って無視するため)。これが今回のバグが「エラーは出ないのに実際には効いていない」という厄介な形で発生した理由。

`TextRenderingMode` enumや、それを実際に使う `setTextRenderingMode()` オペレータ関数自体はpdf-libに存在するが、これらは**低レベルAPI**(`page.pushOperators(...)` で自前のPDFオペレータ列を組み立てる場合専用)であり、高レベルAPIの `drawText()` からは使えない。

**教訓(最重要)**: **WebFetchでdocsページを要約させた回答を鵜呑みにしない。** 今回、事前に「pdf-libはTextRenderingMode.Invisibleをrenderモードオプションとしてdraw Textで使える」という趣旨の回答をWebFetch経由で得ており、それを信じて実装した。しかし実際にはこれは誤り(存在しないAPIを「存在する」と回答された)。**correctness-criticalな実装をする前には、必ずGitHub上の実ソースコード(型定義やメソッド実装そのもの)を直接読んで裏取りすること。** また、**「不可視のはずのテキストが本当に不可視か」は、テキスト抽出の成否だけでなく、実際にPDFページをラスタライズ(画像化)して目視確認する**べきだった。抽出可能性(検索・コピー)と視覚的な不可視性は、PDFの中では別々の仕組み(前者はTjオペレータの存在、後者はレンダリングモードや透明度)で制御されており、片方が動いていてももう片方が動いているとは限らない。

**対処**(実装済み): `renderMode` の代わりに **`opacity: 0`** を使う。これは `drawText()` が正式にサポートしているオプションで、内部的にはPDFの `ExtGState`(`/ca 0`、塗りつぶしの透明度を0にする)を生成し、`gs` オペレータとして各テキスト描画の直前に挿入する。`Tj`(文字表示)自体は通常どおり実行されるため、テキストの選択・検索・コピーは可能なまま、視覚的には完全に透明になる。

```javascript
page.drawText(text, {
  x: xPt,
  y: yPt,
  size: fontSize,
  font,
  opacity: 0,   // ← これが正解。renderModeではない
});
```

**修正の検証方法**(実際に行った手順、再利用可):

1. 生成したPDFの生コンテンツストリームを取得し、`/ca 0` を持つ `ExtGState` と、それを参照する `gs` オペレータがテキスト描画の直前に入っていることを確認(`PyMuPDF` の `page.read_contents()` / `doc.xref_get_key(page.xref, 'Resources')`)
2. PDFページを実際に画像にラスタライズし(`page.get_pixmap(dpi=150)`)、目視で黒い文字が写真の上に重なっていないことを確認
3. `pypdf` の `page.extract_text()` で、想定通りの文字列が抽出できる(検索性が壊れていない)ことを確認

3つとも揃って初めて「本当に直った」と言える。1つでも欠けると再発に気づけない。

### 5.3 品質ゲートの閾値実装ミス(2.1節の帰結)

上記2.1の経緯の通り、`MAX_FAILURE_RATE` を `0.70`(失敗率70%まで許容)から `0.30`(失敗率30%まで、つまり成功率70%以上必須)に修正した。あわせて、`index.html` 内の失敗画面の文言(「基準:70%以下」という**古いまま**だった表示テキスト)も実際のロジックに合わせて「基準:認識成功率70%以上」に修正した。

**教訓**: 閾値の意味を変更したら、コード内の定数だけでなく、**ユーザー向けの表示文言・READMEの説明文もすべて grep して同期すること**。今回、`index.html` の文言修正漏れをこの引き継ぎ資料作成時に見つけた(ユーザー指摘ではなく、コードレビューで気づいた)。

### 5.4 個人データの誤コミット未遂(セキュリティインシデント・未遂)

プロジェクトフォルダ(`0000_Claude_Code/`)は、ユーザーが実際にダウンロードしたスキャン結果PDF(`scan_20260712_221247.pdf`、医薬品/サプリのラベル写真)を置く場所としても使われていた。バグ修正のコミット時に `git add -A` を実行したところ、**このユーザーの個人データファイルが意図せずステージングされてしまった**。

**発覚**: コミット後に `git status` / `git show --stat HEAD` を確認する習慣があったため、push前に気づいた。**まだリモートにpushしていなかったため**、以下の手順で被害なく修正できた:

```bash
git rm --cached "scan_20260712_221247.pdf"   # インデックスから除外(ファイル自体は disk に残す)
# .gitignore に *.pdf を追加
git add .gitignore
git commit --amend                             # 該当ファイルを含まない形でコミットを作り直す
git push origin master                         # この時点で初めてpush
```

**教訓**: **プロジェクトフォルダがユーザーの一般作業フォルダと兼用されている場合、`git add -A` は非常に危険。** 広く `add` した後は必ず `git status` で内容を確認し、覚えのないファイル(特に `.pdf` / `.jpg` / `.png` などのユーザー生成物)が混ざっていないかを見る。**pushする前に**気づけるかどうかが被害の有無を分ける。公開リポジトリの場合、一度pushすると(force-pushで消しても)Gitの履歴やGitHubのキャッシュに残るリスクがあるため、pushは取り消しの効く操作ではないと考えること。

再発防止として `.gitignore` に `*.pdf` を追加済み(このプロジェクトの成果物であるPDFはユーザーがダウンロードして使うものであり、リポジトリに含める必要がそもそもない)。

---

## 6. 開発・検証環境(Windows / PowerShell特有の注意点)

このセッションでは、開発マシン(Windows 11)に以下がすべて**未インストール**の状態からスタートしたため、`winget` で導入した。次回セッションでは既にインストール済みのはずだが、別環境で再構築する場合の参考として残す。

- Node.js LTS (`winget install --id OpenJS.NodeJS.LTS`)
- GitHub CLI (`winget install --id GitHub.cli`)
- Git (`winget install --id Git.Git`)
- Playwright + Chromium (`npm install playwright` → `npx playwright install chromium --with-deps`、開発補助用。プロジェクト本体の依存ではない)

### 6.1 PowerShellツール呼び出し特有の罠

- **各PowerShellコマンド呼び出しは環境変数(PATH含む)を引き継がない**(作業ディレクトリは引き継ぐが、シェル変数・PATHは引き継がれない)。`winget` でインストール直後の新規ツール(`node` / `git` / `gh`)を使うには、毎回コマンド冒頭で以下のようにPATHを明示的に足す必要があった:
  ```powershell
  $env:Path = "C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;C:\Program Files\nodejs;" + $env:Path
  ```
- **`winget install` のMSIインストーラーはUAC(管理者権限)の確認ダイアログを出すことがあり、非対話シェルではそこで無限に待ち続ける。** ユーザーに画面を見てもらい、手動で「はい」を押してもらう必要があった(Node.js・GitHub CLI・Gitのインストール全てで発生)。
- **`git push` が無限にハングする問題が発生した。** 原因は `credential.helper = manager`(Windows Credential Manager)が対話的なポップアップ/ブラウザ認証を試みて非対話シェルでは完了しなかったこと。`gh auth login` 自体は成功していても、git単体のcredential helperとは別物である点に注意。対処:
  ```powershell
  gh auth setup-git   # git の credential helper を "gh auth git-credential" に切り替える(非対話で動く)
  ```
  これで `git push` が正常に完了するようになった。

### 6.2 GitHubへのログイン(デバイスフロー)

`gh auth login --hostname github.com --git-protocol https --web` を実行すると、ワンタイムコードとURL(`https://github.com/login/device`)が標準エラー出力に表示される。ユーザーに自分のブラウザでコードを入力してもらい、認証完了後にコマンドが自動的に終了する(ポーリング待機)。ログインアカウント: `Penginsir`。

### 6.3 GitHub Pagesの設定で詰まった点

- `gh api -X POST repos/{owner}/{repo}/pages` でPages有効化する際、`build_type` を明示しないと **`workflow`(GitHub Actionsによるビルドが必要)がデフォルトで選ばれてしまう。** 今回のような素の静的サイト(ビルド不要)では、明示的に `build_type=legacy` を指定する必要がある:
  ```powershell
  gh api -X PUT repos/{owner}/{repo}/pages -f "build_type=legacy" -f "source[branch]=master" -f "source[path]=/"
  ```
- Pages有効化直後は自動的にビルドがトリガーされないことがあった。`status` が `null` のまま変化しない場合、手動でビルドをキックする:
  ```powershell
  gh api -X POST repos/{owner}/{repo}/pages/builds
  ```
  その後 `gh api repos/{owner}/{repo}/pages/builds/latest` をポーリングし、`"status":"built"` になるのを待つ。

### 6.4 コミット時のメールアドレス(プライバシー配慮)

ユーザーから「個人情報が漏れないように」との要望があったため、`git config user.email` には実際のGmailアドレスではなく、**GitHubのnoreplyエイリアス**を設定した:

```powershell
# gh api user --jq '{login, id}' で id と login を取得した上で:
git config user.email "{id}+{login}@users.noreply.github.com"
# 例: 218430554+Penginsir@users.noreply.github.com
```

公開リポジトリのコミット履歴は誰でも閲覧できるため、**publicリポジトリで作業する場合は常にこれを最初に設定する**こと。

---

## 7. 動作検証の方法(ヘッドレスブラウザでの実機なしE2Eテスト)

この開発環境には実機のスマホ・カメラがないため、**Playwright + Chromiumのヘッドレスブラウザ**でE2E検証を行った。以下、実際に使ったテスト手法とスクリプトの要点を残す(スクリプト自体はリポジトリには含めていない。`scratchpad` に置いて都度実行した使い捨てNode.jsスクリプト)。

### 7.1 カメラのモック

Chromium起動時に以下のフラグを付けると、実カメラなしで `getUserMedia` が偽の映像ストリームを返すようになり、カメラ許可UIやプレビュー表示までは実UIフローのままテストできる:

```javascript
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const context = await browser.newContext({ permissions: ['camera'] });
```

ただし偽の映像ストリームは実際の文字が写っていないただの模様なので、OCRの中身までは検証できない(→ 100%失敗率になり、必ず「拒否」パスに入ることの確認には使える)。

### 7.2 OCR/PDF生成ロジック自体のテスト(カメラを介さず直接実行)

`app.js` は `<script src="app.js">` で読み込む**素のクラシックスクリプト**(`type="module"` ではない)であるため、トップレベルで `function` 宣言された関数(`buildOcrCanvas`, `flattenWords`, `buildSearchablePdf` など)は**自動的に `window` のプロパティとして生えている**(ただし `const` / `let` はグローバルオブジェクトには乗らない、という違いに注意)。これを利用し、`page.evaluate()` 内から直接これらの関数を呼び出すことで、カメラを介さずに「本物の写真らしい画像」でOCR〜PDF生成の本番ロジックをそのまま検証できる:

```javascript
const result = await page.evaluate(async () => {
  const canvas = document.getElementById('capture-canvas'); // appの実DOM要素を直接操作
  canvas.width = 1200; canvas.height = 1600;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000'; ctx.font = '60px sans-serif';
  ctx.fillText('Hello World Test Document', 80, 150);
  // ...

  const ocrCanvas = buildOcrCanvas();                 // ← window.buildOcrCanvas() 相当
  const worker = await Tesseract.createWorker('jpn+eng', 1, {});
  const ocrResult = await worker.recognize(ocrCanvas, {}, { blocks: true, text: false });
  await worker.terminate();
  const words = flattenWords(ocrResult.data.blocks).filter(w => w.text.trim());

  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const pdfBytes = await buildSearchablePdf({ jpegDataUrl, imgWidth: canvas.width, imgHeight: canvas.height, words });
  // pdfBytes を base64 化して Node 側に返し、fs.writeFileSync で保存 → Pythonのpypdf/PyMuPDFで検証
});
```

### 7.3 検証した項目と結果(最終確認時点)

| 検証項目 | 方法 | 結果 |
|---|---|---|
| コンソール/ページエラーが出ないか | `page.on('console')` / `page.on('pageerror')` を全操作フローで記録 | エラー0件 |
| ネットワーク通信先の確認 | `page.on('request')` で全リクエストのホストを記録 | `cdn.jsdelivr.net` と自ホストのみ。画像・OCR結果の外部送信なし |
| 拒否パス(低品質画像) | fakeカメラの模様(文字なし)でスキャン実行 | 失敗率100% → 正しく「拒否」画面 |
| 合格パス(読みやすい画像) | 合成した英字テキスト画像でスキャン実行 | 失敗率0% → PDF生成成功 |
| PDFのテキスト抽出(検索性) | `pypdf` の `extract_text()` | 想定通りの文字列が正しく抽出される |
| **PDFの視覚的な不可視性**(5.2のバグ発見後に追加した検証項目) | `PyMuPDF` でコンテンツストリームの `gs`/`ExtGState /ca` を確認 + ページをラスタライズして目視 | 黒文字の重なりなし。写真のみが見える |
| 実データでの品質ゲート | ユーザー実写真(薬品ラベル)のJPEGをPDFから抽出し、同じOCRパイプラインに再投入 | 失敗率55.3% → 現行基準(30%)で正しく「拒否」 |
| 本番URL(GitHub Pages)での再現性 | 上記すべてを `localhost` だけでなく `https://penginsir.github.io/document-scanner/` に対しても再実行 | ローカルと同一結果 |

**教訓**: 「PDFが作れてテキストが抽出できる」だけでは検証として不十分だった(5.2のバグを見逃した)。**見た目(ラスタライズ画像)・中身(コンテンツストリームの生データ)・機能(テキスト抽出)の3方向から検証する**ことで初めて「意図通り動いている」と言える。

---

## 8. デプロイ状態

- **GitHubリポジトリ**: https://github.com/Penginsir/document-scanner (public)
  - `gh repo create --public` はClaude Codeの自動モードの安全機構により一度ブロックされ、ユーザーに名前・公開範囲を明示確認してから実行した(公開リポジトリの新規作成は人間の承認が必要な操作として扱われる)
- **GitHub Pages URL**: https://penginsir.github.io/document-scanner/ (`master` ブランチ、ルート `/` を配信、`build_type: legacy`)
- **ブランチ**: `master` のみ。運用ルールなし(個人プロジェクト規模)
- **コミット履歴**: 本資料作成時点で2コミット
  1. `Initial commit: document scanner PWA`
  2. `Fix invisible text layer (opacity instead of nonexistent renderMode) and tighten quality gate to 30% failure rate`

### デプロイ手順の再現方法(別環境で最初からやる場合)

```powershell
git init
git config user.email "{id}+{login}@users.noreply.github.com"
git config user.name "{github-username}"
git add -A
git status              # ★ 必ず内容確認。個人ファイルが混ざっていないか
git commit -m "..."
gh repo create {repo-name} --public --source=. --remote=origin --push
gh api -X PUT repos/{owner}/{repo}/pages -f "build_type=legacy" -f "source[branch]=master" -f "source[path]=/"
gh api -X POST repos/{owner}/{repo}/pages/builds   # 初回ビルドが自動で走らない場合
```

---

## 9. セキュリティ・プライバシー方針(このプロジェクトにおける)

1. **画像・OCR結果は一切外部送信しない**(Tesseract.js・pdf-libとも端末内=ブラウザ内で完結。実際にネットワークトレースで確認済み)
2. スキャン結果PDFは**サーバーに保存されない**。ブラウザのダウンロード機能でユーザー端末のダウンロードフォルダに保存されるのみ
3. リポジトリは public だが、**ソースコード自体に個人情報は含まれない**(コード・フォント・READMEのみ)
4. **コミット作者情報にはGitHubのnoreplyメールを使用**(実メールアドレスを公開リポジトリの履歴に残さない)
5. **`.gitignore` で `*.pdf` を除外**(ユーザーの実スキャン結果が誤ってリポジトリに入らないようにする、5.4のインシデントを受けての対処)
6. 新規の公開リポジトリ作成・publicへのpushのような「元に戻しにくい/共有範囲が広がる」操作は、実行前に必ずユーザーへ具体的な内容(リポジトリ名・公開範囲)を確認してから行う

---

## 10. 既知の制約・未着手の改善候補

READMEにも記載しているものを含め、現状把握している制約:

- **複数ページ結合は非対応**(要件として明示的に対象外。将来対応するなら「スキャン継続」ボタンでページを貯めて最後に1PDFにまとめる設計変更が必要)
- **認識失敗率は単語単位のconfidenceベースの推定値であり、完全な精度指標ではない**。5.3で判明した通り、Tesseractは密な多段組み・小さい文字(薬品ラベル等)に対して、断片的な1〜2文字の「単語」に不自然に高いconfidenceを付けることがある。将来的な改善候補:
  - 極端に短い(1文字)語のconfidenceの重み付けを下げる
  - 画像の傾き補正(deskew)・輪郭検出による用紙切り出し(現状は撮った写真をそのまま使うのみで、台形補正等は一切していない)
  - 単語のconfidenceだけでなく、認識された「単語」の総文字数が画像サイズに対して極端に少ない場合(=そもそも大部分が未認識/未検出)も別途弾く、といったカバレッジ側の指標の追加
- **フォントは日本語(Noto Sans JP)のみ埋め込み**。中国語・韓国語等のCJK以外の非ラテン文字(アラビア語等)は埋め込みフォントに存在せず、該当する単語はテキスト層から静かにスキップされる(`buildSearchablePdf` 内の `catch` 節、380行目付近)
- **プログレス表示は簡易的**。Tesseractのlogger経由の進捗(0-100%)をそのまま表示しているのみで、OCRエンジン初期化・言語データダウンロードの待ち時間の体感が長い場合がある(特に初回アクセス時、jsDelivrから約9MBの日本語学習データをダウンロードするため)
- **オフライン非対応**(Service Worker未実装。CDN・フォントとも毎回ネットワークが必要。ただしブラウザキャッシュは効く)
- **カスタムドメイン未設定**(`penginsir.github.io` のサブパスのまま)

これらは**要件として依頼されたものではなく、実装上の制約として認識しているだけ**の項目である。着手する場合は必ずユーザーに優先度を確認すること。

---

## 11. 次のセッションで最初にやるべきこと

新しいAIセッションがこのプロジェクトを引き継ぐ場合の推奨手順:

1. このファイル(`DEVELOPMENT_HANDOFF.md`)と `README.md` を読む
2. `git log --oneline` で現在のコミット状態を確認し、このドキュメントの「8. デプロイ状態」と食い違いがないか確認する(このドキュメント自体が古くなっている可能性を疑うこと)
3. 本番URL (https://penginsir.github.io/document-scanner/) が実際に生きているか確認する
4. コードに変更を加える場合、5節の「発生した不具合と修正」を先に読み、同じ罠(特に5.2のpdf-lib `renderMode`)を踏まないようにする
5. 変更後は7節の検証方法(視覚的ラスタライズ確認を含む3方向検証)を踏襲してから、8節の手順でコミット・push・Pages反映を行う
6. `git add` 前に必ず `git status` を確認し、プロジェクトフォルダに紛れ込んでいるかもしれないユーザーの個人ファイル(スキャン結果PDF等)を巻き込んでいないか注意する

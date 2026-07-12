"use strict";

/* ==========================================================================
   設定
   ========================================================================== */

// 単語ごとのOCR信頼度(0-100)がこの値未満なら「認識失敗」として扱う
const WORD_CONFIDENCE_THRESHOLD = 60;

// 失敗文字数の割合がこれを超えたらスキャンを拒否する(通常の品質ゲート)
const MAX_FAILURE_RATE = 0.70;

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
  const { PDFDocument, TextRenderingMode } = PDFLib;

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
      page.drawText(text, {
        x: xPt,
        y: yPt,
        size: fontSize,
        font,
        renderMode: TextRenderingMode.Invisible,
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

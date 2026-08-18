const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PYTHON_OCR_URL = 'http://localhost:5001';
const upload = multer({ dest: path.join(__dirname, 'uploads/') });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// POST /upload - accept a file, run OCR/LLM pipeline (placeholder), store parsed JSON
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });

    const filePath = req.file.path;

    // TODO: Replace parseReceipt with real OCR + LLM processing.
    // - For OCR: Paddle,
    //   or a cloud OCR API (Google Vision, AWS Textract, Azure Form Recognizer).
    // - For LLM: send OCR text to OpenAI/other LLM with a prompt that extracts
    //   fields (date, vendor, line items, total) and returns JSON.
    const parsed = await parseReceipt(filePath, req.file.originalname);

    const stmt = db.prepare('INSERT INTO expenses (date, vendor, amount, category, raw_json) VALUES (?, ?, ?, ?, ?)');
    stmt.run(parsed.date, parsed.vendor, parsed.amount, parsed.category || null, JSON.stringify(parsed), function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, parsed });
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/expenses - return all stored expenses
app.get('/api/expenses', (req, res) => {
  db.all('SELECT * FROM expenses ORDER BY id DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Simple parser placeholder - returns mocked parsed data from filename
async function parseReceipt(filePath, originalName) {
  // Basic heuristic: use filename and file size to generate demo data.
  const stat = fs.statSync(filePath);
  const base = path.basename(filePath);
  // Send the uploaded file to the Python OCR microservice
  let ocrText = '';
  let pages = [];
  try {
    const form = new FormData();
    // preserve the original filename so OCR service can detect extension
    const uploadName = originalName || base;
    form.append('receipt', fs.createReadStream(filePath), { filename: uploadName });
    const headers = form.getHeaders();
    const resp = await axios.post(`${PYTHON_OCR_URL}/ocr`, form, { headers, timeout: 120000 });
    if (resp && resp.data) {
      ocrText = resp.data.full_text || '';
      pages = resp.data.pages || [];
    }
  } catch (err) {
    // If OCR call fails, fall back to empty text and let heuristics handle it
    console.error('OCR service error:', err && err.stack ? err.stack : (err.message || err));
    ocrText = '';
  }

  // Heuristic parsing from OCR text and boxes
  const raw = (ocrText || '').trim();
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Build line objects from OCR pages (if available) to use position info
  const lineObjs = [];
  if (Array.isArray(pages) && pages.length) {
    for (let p = 0; p < pages.length; p++) {
      const pg = pages[p];
      const texts = pg.texts || [];
      const boxes = pg.boxes || [];
      for (let i = 0; i < texts.length; i++) {
        const txt = texts[i] || '';
        const box = boxes[i] || null; // box = [[x,y],...]
        let cx = null, cy = null;
        if (Array.isArray(box) && box.length) {
          let sx = 0, sy = 0;
          for (const pt of box) { sx += Number(pt[0]); sy += Number(pt[1]); }
          cx = sx / box.length; cy = sy / box.length;
        }
        lineObjs.push({ text: txt, page: p, cx, cy });
      }
    }
  }

  // Vendor: choose the top-most non-empty textual line that isn't a label
  const vendorBlacklist = /total|subtotal|tax|invoice|receipt|amount|date|qty|qty\.|balance/i;
  let vendor = null;
  if (lineObjs.length) {
    // sort by y (cy) ascending (top of page)
    const topCandidates = lineObjs.filter(l => l.text && /[A-Za-z]/.test(l.text)).sort((a,b) => (a.cy||0) - (b.cy||0));
    for (const c of topCandidates) {
      if (!vendorBlacklist.test(c.text) && c.text.length > 2) { vendor = c.text; break; }
    }
  }
  if (!vendor) vendor = lines.length ? lines[0] : base;

  // Amount detection: prefer numbers with decimals or currency symbols; ignore long integer sequences (merchant codes)
  const moneyRegex = /(?:\$\s*\d{1,3}(?:[\,\d]*)(?:\.\d{1,2})?)|(?:\b\d{1,3}(?:[\,\d]*)(?:\.\d{1,2})\b)/g;
  const keywordHint = /total|balance|amount|grand total|amount due|due/i;
  const candidates = [];

  // Use positional candidates from lineObjs when available
  if (lineObjs.length) {
    for (const l of lineObjs) {
      const txt = l.text || '';
      let m;
      while ((m = moneyRegex.exec(txt)) !== null) {
        // use the full match (m[0]) because capture groups may be absent
        const matched = m[0] || '';
        const rawNum = matched.replace(/[^0-9.]/g, '');
        const val = parseFloat(rawNum);
        if (Number.isFinite(val)) {
          const hasKeyword = keywordHint.test(txt);
          const score = (hasKeyword ? 100000 : 0) + val * 100 + (l.cy || 0) * 0.1 + (l.cx || 0) * 0.05;
          candidates.push({ val, text: txt, cx: l.cx, cy: l.cy, score });
        }
      }
    }
  }

  // Fallback: scan raw text for money-like tokens (last 2-decimal number often total)
  let amount = null;
  if (!candidates.length) {
    // find decimal numbers (xx.yy) and currency-prefixed numbers; ignore long integers
    const allNums = (raw.match(/\b\d{1,5}\.\d{2}\b/g) || []).map(s => parseFloat(s.replace(/,/g,'')));
    if (allNums.length) {
      amount = allNums[allNums.length - 1];
    } else {
      // as a last resort, find any $... pattern
      const symbolNums = [];
      let m;
      const symRe = /\$\s*(\d{1,3}(?:[\,\d]*)(?:\.\d{1,2})?)/g;
      while ((m = symRe.exec(raw)) !== null) {
        const matched = m[0] || '';
        const num = matched.replace(/[^0-9.]/g, '');
        const parsedNum = parseFloat(num);
        if (Number.isFinite(parsedNum)) symbolNums.push(parsedNum);
      }
      if (symbolNums.length) amount = symbolNums[symbolNums.length-1];
    }
  } else {
    // Prefer highest score candidate
    candidates.sort((a,b) => b.score - a.score);
    amount = candidates.length ? candidates[0].val : null;
  }

  // Date detection: try line-level regexes first, then raw text
  let date = null;
  const dateRegexes = [
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
    /\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/,
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[ .,-]*(\d{1,2}),?[ .,-]*(\d{4})/i
  ];
  // check lineObjs first
  for (const l of lineObjs) {
    for (const rx of dateRegexes) {
      const m = l.text.match(rx);
      if (m) {
        const parsed = new Date(m[0]);
        if (!Number.isNaN(parsed.getTime())) { date = parsed.toISOString().slice(0,10); break; }
      }
    }
    if (date) break;
  }
  // fallback to raw
  if (!date) {
    for (const rx of dateRegexes) {
      const m = raw.match(rx);
      if (m) {
        const parsed = new Date(m[0]);
        if (!Number.isNaN(parsed.getTime())) { date = parsed.toISOString().slice(0,10); break; }
      }
    }
  }
  if (!date) date = new Date().toISOString().slice(0,10);

  return {
    source_file: base,
    bytes: stat.size,
    date,
    vendor,
    amount,
    category: 'uncategorized',
    raw_text_excerpt: raw.slice(0, 2000)
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

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
    // - For OCR: use Tesseract (tesseract.js or system tesseract via child_process),
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

  // Heuristic parsing from OCR text
  const raw = (ocrText || '').trim();
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Vendor: assume first non-empty line (often merchant name)
  const vendor = lines.length ? lines[0] : base;

  // Amount detection: find all currency-like numbers and pick the largest plausible total
  const amountCandidates = [];
  const moneyRegex = /(?:[$€£]\s?\d{1,3}(?:[\,\d]*)(?:\.\d{1,2})?)|\d{1,3}(?:[\,\d]*)(?:\.\d{1,2})?/g;
  const matches = raw.match(moneyRegex) || [];
  for (const m of matches) {
    // strip currency symbols and commas
    const cleaned = m.replace(/[^0-9.]/g, '');
    const n = parseFloat(cleaned);
    if (!Number.isNaN(n)) amountCandidates.push(n);
  }
  // pick the largest candidate as total (simple heuristic)
  const amount = amountCandidates.length ? Math.max(...amountCandidates) : null;

  // Date detection: simple regex for common date patterns
  let date = null;
  const dateRegexes = [
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
    /\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/,
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[ .,-]*(\d{1,2}),?[ .,-]*(\d{4})/i
  ];
  for (const rx of dateRegexes) {
    const m = raw.match(rx);
    if (m) {
      // attempt to parse with Date
      const candidate = m[0];
      const parsed = new Date(candidate);
      if (!Number.isNaN(parsed.getTime())) {
        date = parsed.toISOString().slice(0, 10);
        break;
      }
    }
  }
  // fallback: use upload date
  if (!date) date = new Date().toISOString().slice(0, 10);

  return {
    source_file: base,
    bytes: stat.size,
    date,
    vendor,
    amount,
    category: 'uncategorized',
    raw_text_excerpt: raw.slice(0, 1000)
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const cors = require('cors');

const app = express();
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
    const parsed = await parseReceipt(filePath);

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
async function parseReceipt(filePath) {
  // Basic heuristic: use filename and file size to generate demo data.
  const stat = fs.statSync(filePath);
  const base = path.basename(filePath);

  // In a real pipeline, run OCR here and then call an LLM to convert to structured JSON.
  return {
    source_file: base,
    bytes: stat.size,
    date: new Date().toISOString().slice(0, 10),
    vendor: 'Demo Vendor',
    amount: parseFloat((Math.random() * 100).toFixed(2)),
    category: 'uncategorized',
    raw_text_excerpt: 'OCR/LLM pipeline not configured yet. Replace parseReceipt()'.slice(0, 200)
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

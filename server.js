require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
const { buildReceiptExtractionPrompt } = require('./llm/prompt');

const app = express();

const PYTHON_OCR_URL =
  process.env.OCR_SERVICE_URL || 'http://localhost:5001';

const LOCAL_LLM_URL =
  process.env.LOCAL_LLM_URL || 'http://localhost:5002';

const LOCAL_LLM_MODEL =
  process.env.LOCAL_LLM_MODEL || 'qwen3:1.7b';

const LLM_OCR_MAX_CHARS =
  Number.parseInt(process.env.LLM_OCR_MAX_CHARS || '24000', 10);

const upload = multer({
  dest: path.join(__dirname, 'uploads/')
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// ============================================================
// POST /upload
// Receipt -> PaddleOCR -> Qwen -> Database
// ============================================================

app.post('/upload', upload.single('file'), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'no file uploaded'
      });
    }

    filePath = req.file.path;

    const parsed = await parseReceipt(
      filePath,
      req.file.originalname
    );

    const stmt = db.prepare(`
      INSERT INTO expenses
      (date, vendor, amount, category, raw_json)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      parsed.date,
      parsed.vendor,
      parsed.amount,
      parsed.category || null,
      JSON.stringify(parsed),
      function (err) {
        if (err) {
          console.error('DATABASE ERROR:', err);

          return res.status(500).json({
            error: err.message
          });
        }

        res.json({
          id: this.lastID,
          parsed
        });
      }
    );

  } catch (err) {

    console.error('UPLOAD ERROR:', err);

    res.status(500).json({
      error: err.message
    });


  } 
  finally {
    if (filePath) {
      try {
        await fs.promises.unlink(filePath);
        console.log('Temporary upload deleted:', filePath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          console.warn(
            'Could not delete temporary upload:',
            cleanupError.message
          );
        }
      }
    }
  }
});


// ============================================================
// GET /api/expenses
// ============================================================

app.get('/api/expenses', (req, res) => {

  db.all(
    'SELECT * FROM expenses ORDER BY id DESC',
    (err, rows) => {

      if (err) {
        return res.status(500).json({
          error: err.message
        });
      }

      res.json(rows);
    }
  );

});


// ============================================================
// MAIN RECEIPT PIPELINE
// ============================================================

async function parseReceipt(filePath, originalName) {

  // ----------------------------------------------------------
  // STEP 1: PaddleOCR
  // ----------------------------------------------------------

  console.log('Running PaddleOCR...');

  const ocrResult = await runOCR(
    filePath,
    originalName
  );

  const ocrText = ocrResult.full_text;

  if (!ocrText || !ocrText.trim()) {
    throw new Error(
      'PaddleOCR returned no readable text.'
    );
  }

  console.log('PaddleOCR completed.');
  console.log('OCR text:');
  console.log(ocrText);


  // ----------------------------------------------------------
  // STEP 2: Qwen
  // ----------------------------------------------------------

  console.log(
    `Sending OCR text to ${LOCAL_LLM_MODEL}...`
  );

  const extracted =
    await extractReceiptWithLocalQwen(ocrText);

  console.log('Qwen extraction completed.');
  console.log('Qwen result:', extracted);


  // ----------------------------------------------------------
  // STEP 3: Validate the result
  // ----------------------------------------------------------

  validateExtraction(extracted);


  // ----------------------------------------------------------
  // STEP 4: Return final receipt object
  // ----------------------------------------------------------

  return {
    source_file:
      path.basename(originalName || filePath),

    bytes:
      fs.statSync(filePath).size,

    vendor:
      extracted.vendor ?? null,

    date:
      extracted.date ?? null,

    amount:
      extracted.amount ?? null,

    currency:
      extracted.currency ?? null,

    category:
      extracted.category ?? null,

    line_items:
      extracted.line_items ?? [],

    confidence:
      extracted.confidence ?? null,

    overall_confidence:
      extracted.overall_confidence ?? null,

    extraction_method:
      'paddleocr-qwen-local',

    raw_text_excerpt:
      ocrText.slice(0, 2000)
  };
}


// ============================================================
// PADDLEOCR
// ============================================================

async function runOCR(filePath, originalName) {

  const form = new FormData();

  const uploadName =
    originalName || path.basename(filePath);

  form.append(
    'receipt',
    fs.createReadStream(filePath),
    {
      filename: uploadName
    }
  );

  try {

    const response = await axios.post(
      `${PYTHON_OCR_URL}/ocr`,
      form,
      {
        headers: form.getHeaders(),
        timeout: 300000
      }
    );

    if (
      !response.data ||
      response.data.success !== true
    ) {
      throw new Error(
        response.data?.error ||
        'OCR service returned an invalid response.'
      );
    }

    return {
      full_text:
        typeof response.data.full_text === 'string'
          ? response.data.full_text
          : ''
    };

  } catch (err) {

    const status =
      err.response?.status;

    const serviceMessage =
      err.response?.data?.error;

    throw new Error(
      `PaddleOCR request failed${
        status ? ` (HTTP ${status})` : ''
      }: ${
        serviceMessage || err.message
      }`
    );
  }
}


// ============================================================
// LOCAL QWEN / OLLAMA
// ============================================================

async function extractReceiptWithLocalQwen(ocrText) {

  if (
    typeof ocrText !== 'string' ||
    !ocrText.trim()
  ) {
    throw new Error(
      'PaddleOCR returned no readable text.'
    );
  }

  const receiptText =
    ocrText.slice(
      0,
      Number.isFinite(LLM_OCR_MAX_CHARS)
        ? LLM_OCR_MAX_CHARS
        : 24000
    );

  // Build the prompt using prompt.js
  const prompt =
    buildReceiptExtractionPrompt(receiptText);

  console.log('Sending OCR text to local Qwen service...');

  let response;

  try {

    response = await axios.post(
      `${LOCAL_LLM_URL}/extract`,
      {
        prompt
      },
      {
        timeout: 180000
      }
    );

  } catch (error) {

    if (error.code === 'ECONNREFUSED') {
      throw new Error(
        `Qwen service is not running at ${LOCAL_LLM_URL}`
      );
    }

    const status =
      error.response?.status;

    const message =
      error.response?.data?.error ||
      error.message;

    throw new Error(
      `Qwen service request failed${
        status ? ` (HTTP ${status})` : ''
      }: ${message}`
    );
  }

  if (
    !response.data ||
    response.data.success !== true
  ) {

    throw new Error(
      response.data?.error ||
      'Qwen service returned an invalid response.'
    );
  }

  const extracted =
    response.data.data;

  if (
    !extracted ||
    Array.isArray(extracted) ||
    typeof extracted !== 'object'
  ) {

    throw new Error(
      'Qwen returned an invalid JSON object.'
    );
  }

  return extracted;
}

// ============================================================
// VALIDATE QWEN EXTRACTION
// ============================================================

function validateExtraction(extracted) {

  const allowedFields = [
    'vendor',
    'date',
    'amount',
    'currency',
    'category',
    'confidence',
    'line_items',
    'overall_confidence'
  ];

  const keys =
    Object.keys(extracted);

  const unexpected =
    keys.filter(
      key => !allowedFields.includes(key)
    );

  if (unexpected.length > 0) {
    throw new Error(
      `Qwen returned unexpected fields: ${
        unexpected.join(', ')
      }`
    );
  }
  const requiredFields = [
    'vendor',
    'date',
    'amount',
    'currency',
    'category',
    'line_items',
    'confidence',
    'overall_confidence'
  ];

  for (const field of requiredFields) {
    if (!(field in extracted)) {
      throw new Error(
        `Qwen response is missing required field: ${field}`
      );
    }
  }

  if (
    extracted.amount !== null &&
    typeof extracted.amount !== 'number'
  ) {

    throw new Error(
      'Qwen returned an invalid amount.'
    );
  }

  if (
    extracted.date !== null &&
    !/^\d{4}-\d{2}-\d{2}$/.test(
      extracted.date
    )
  ) {

    throw new Error(
      'Qwen returned an invalid date format.'
    );
  }

  const stringFields = [
    'vendor',
    'currency',
    'category'
  ];

  for (const field of stringFields) {

    if (
      extracted[field] !== null &&
      typeof extracted[field] !== 'string'
    ) {

      throw new Error(
        `Qwen returned an invalid ${field}.`
      );
    }
  }
  if (
    extracted.overall_confidence !== undefined &&
    (
      typeof extracted.overall_confidence !== 'number' ||
      extracted.overall_confidence < 0 ||
      extracted.overall_confidence > 1
    )
  ) {

    throw new Error(
      'Qwen returned an invalid overall_confidence.'
    );
  }

  if (
    extracted.confidence !== undefined
  ) {

    if (
      typeof extracted.confidence !== 'object' ||
      extracted.confidence === null ||
      Array.isArray(extracted.confidence)
    ) {

      throw new Error(
        'Qwen returned an invalid confidence object.'
      );
    }

    for (
      const [field, value]
      of Object.entries(extracted.confidence)
    ) {

      if (
        typeof value !== 'number' ||
        value < 0 ||
        value > 1
      ) {

        throw new Error(
          `Qwen returned an invalid confidence value for ${field}.`
        );
      }
    }
  }
  if (!Array.isArray(extracted.line_items)) {
  throw new Error(
    'Qwen returned invalid line_items.'
  );
  if (extracted.line_items.length > 0) {

  const allowedLineItemFields = [
    'description',
    'quantity',
    'unit_price',
    'total_price'
  ];

  for (const item of extracted.line_items) {

    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item)
    ) {
      throw new Error(
        'Qwen returned an invalid line item.'
      );
    }

    const unexpectedLineItemFields =
      Object.keys(item).filter(
        key => !allowedLineItemFields.includes(key)
      );

    if (unexpectedLineItemFields.length > 0) {
      throw new Error(
        `Qwen returned unexpected line item fields: ${
          unexpectedLineItemFields.join(', ')
        }`
      );
    }

    if (
      item.description !== null &&
      typeof item.description !== 'string'
    ) {
      throw new Error(
        'Qwen returned an invalid line item description.'
      );
    }

    if (
      item.quantity !== null &&
      typeof item.quantity !== 'number'
    ) {
      throw new Error(
        'Qwen returned an invalid line item quantity.'
      );
    }

    if (
      item.unit_price !== null &&
      typeof item.unit_price !== 'number'
    ) {
      throw new Error(
        'Qwen returned an invalid line item unit price.'
      );
    }

    if (
      item.total_price !== null &&
      typeof item.total_price !== 'number'
    ) {
      throw new Error(
        'Qwen returned an invalid line item total price.'
      );
    }
  }
}


}

for (const item of extracted.line_items) {

  const requiredItemFields = [
    'description',
    'quantity',
    'unit_price',
    'total_price'
  ];

  const itemKeys = Object.keys(item);

  const unexpectedItemFields =
    itemKeys.filter(
      key => !requiredItemFields.includes(key)
    );

  if (unexpectedItemFields.length > 0) {
    throw new Error(
      `Qwen returned unexpected line item fields: ${
        unexpectedItemFields.join(', ')
      }`
    );
  }

  for (const field of requiredItemFields) {

    if (!(field in item)) {
      throw new Error(
        `Qwen line item is missing ${field}.`
      );
    }
  }

  if (item.description !== null && typeof item.description !== 'string') {
    throw new Error(
      'Qwen returned an invalid line item description.'
    );
  }

  for (const field of ['quantity','unit_price','total_price']) {
    if (item[field] !== null && typeof item[field] !== 'number') {
      throw new Error(`Qwen returned an invalid line item ${field}.`);
    }
  }
}
}


// ============================================================
// SERVER
// ============================================================

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {
    console.log(
      `Server listening on http://localhost:${PORT}`
    );
  }
);
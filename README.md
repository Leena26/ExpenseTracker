Expense Receipt OCR - Demo
==========================

Quick demo scaffold that accepts uploads, stores a mocked parsed JSON into SQLite, and shows a tiny analytics UI.

Run
---

This repo now runs as two processes:

- A small Node/Express app that serves the frontend and stores parsed records (`server.js`).
- A Python Flask OCR microservice using PaddleOCR (`ocr/paddle_ocr.py`) that extracts text from uploaded images/PDFs.

Quick start (recommended — runs both services locally):

1. Install Node dependencies (only if you need to run the Node app or add packages). `node_modules` is ignored by git to keep the repo small:

```bash
npm install    # optional, only if you need to edit server code or add packages
```

2. Install Python dependencies for the OCR service and (optionally) Poppler/pdf2image for PDF support:

```bash
python -m venv .venv
.venv\Scripts\activate    # Windows
pip install -r ocr/requirements.txt
# If you need PDF support: pip install pdf2image and install poppler for Windows (add to PATH)
```

3. Start the OCR microservice (in the Python venv):

```bash
python ocr/paddle_ocr.py
```

4. Start the Node server (project root):

```bash
node server.js
```

5. Open the UI: http://localhost:3000

What I created
--------------
- server: [server.js](server.js)
- database: [db.js](db.js)
- UI: [public/index.html](public/index.html) (client JS inlined) 
- OCR microservice: [ocr/paddle_ocr.py](ocr/paddle_ocr.py)
- `.gitignore` ignores `node_modules/`, `uploads/`, and `data.sqlite` to keep the repo small

Pathway to production-ready OCR + LLM pipeline
---------------------------------------------
1. OCR extraction
   - Option A (local): use `tesseract` (via `tesseract.js` or calling system binary) to extract raw text for images and PDFs (use `pdf2image` in Python or `pdf-poppler` to convert PDF pages to images first).
   - Option B (cloud): use Google Vision, AWS Textract, or Azure Form Recognizer for higher accuracy and structured fields.

2. LLM field extraction
   - Send OCR text (or OCR + bounding boxes) to an LLM with a deterministic prompt asking for JSON output fields: date, vendor, line items, subtotal, tax, total, currency.
   - Use tools like OpenAI function-calling or validation code to enforce JSON schema.

3. Validation & enrichment
   - Validate amounts, parse dates with `date-fns` or `moment`.
   - Optionally call an autop-categorization model (simple rules or an LLM with category taxonomy).

4. Storage
   - Small scale: SQLite (demo) or Postgres for multi-user apps.
   - Store raw OCR text, parsed JSON, and canonical expense rows.

5. Security & privacy
   - Use server-side virus scanning for uploads.
   - Store files encrypted at rest; redact PII where unnecessary.
   - Add authentication (JWT / sessions) before storing user data.

6. UI / Analytics
   - Expand the demo UI to show per-user dashboards, time-series charts, category breakdowns, and export CSV.
   - Add pagination and filters on the server for large datasets.

7. Scaling
   - Offload OCR/LLM to background workers (RabbitMQ, Redis queues, or serverless functions).
   - Use object storage (S3) for uploaded files and DB for structured data.


Troubleshooting & notes
-----------------------
- 400 from OCR service: the OCR endpoint validates file extensions. The Node server preserves the original filename when posting to OCR so the extension is visible. If you see 400, confirm the Node request includes a filename and that the file extension is one of: `.png .jpg .jpeg .bmp .tiff .pdf`.
- `req is not defined` error: fixed — `server.js` now passes the original filename into the OCR call.
- If `parsed.amount` is `null` or `raw_text_excerpt` is empty:
   - Check the OCR service directly:
      ```bash
      curl -F "receipt=@/path/to/receipt.jpg;filename=receipt.jpg" http://localhost:5001/ocr
      ```
      Inspect `full_text` and `pages` in the response. If `full_text` is empty, the OCR step failed (Paddle, pdf2image/poppler, or unsupported file).
   - If OCR `full_text` looks correct but `amount` is null, the extractor heuristics may miss totals. I can add box-aware heuristics (prefer bottom/right numbers) or an LLM extraction step.
- PaddlePaddle installation: Windows + GPU requires the correct paddle wheel for your Python and CUDA. If you're using GPU, follow the official guide: https://www.paddlepaddle.org.cn/install/quick. If installation fails, you can run the OCR microservice in CPU mode by installing the CPU wheel.

Contact / next step
-------------------
Tell me which improvement you'd like: bottom-right numeric heuristic, LLM extraction, or help installing Paddle/Poppler — and I'll implement the change.

Expense Receipt OCR - Demo
==========================

Quick demo scaffold that accepts uploads, stores a mocked parsed JSON into SQLite, and shows a tiny analytics UI.

Run
---

Install and start:

```bash
npm install
npm start
```

Then open http://localhost:3000

What I created
--------------
- server: [server.js](server.js)
- database: [db.js](db.js)
- UI: [public/index.html](public/index.html) and [public/app.js](public/app.js)

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

Next steps I can take for you
----------------------------
- Integrate a real OCR engine (Tesseract or cloud) into `parseReceipt()` in [server.js](server.js).
- Add OpenAI / other LLM call to convert OCR text to validated JSON and schema enforcement.
- Add user authentication and per-user storage.
- Replace SQLite with Postgres and add migrations.

Expense Receipt OCR — Demo

Quick local demo for testing receipt uploads, OCR, and simple extraction.

Run
1. Start the OCR microservice (Python):

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r ocr/requirements.txt
python ocr/paddle_ocr.py
```

2. Start the Node server (project root):

```bash
node server.js
```

3. Open the UI: http://localhost:3000

Clear stored data
- Development: delete the SQLite file to wipe stored expenses:

```bash
del data.sqlite        # Windows (PowerShell/CMD)
# or: rm data.sqlite   # Unix
```

Quick tests
- OCR health: `GET http://localhost:5001/health`
- Direct OCR: `curl -F "receipt=@/path/to/receipt.jpg;filename=receipt.jpg" http://localhost:5001/ocr`
- Full pipeline: `curl -F "file=@/path/to/receipt.jpg" http://localhost:3000/upload`

Notes
- The Node server forwards uploads to the OCR microservice and extracts `vendor`, `date`, and `amount` using simple heuristics. For production use, replace heuristics with an LLM or stricter field-extraction logic.

Next steps
- Improve extractor heuristics (bottom-right / total detection) — implemented in `server.js`.
- Add LLM extraction for robust parsing.
- Harden OCR service (Poppler/pdf2image, Paddle wheel installation) or use a cloud OCR provider.

# Expense Receipt OCR

A local expense receipt OCR app that takes a receipt image or PDF, extracts
the text, uses a local Gemma 4 model through Ollama to turn that text into
structured receipt data, and then displays the result and basic spending
analytics.

## Current Pipeline

1. A user uploads a receipt through the web interface.

2. The Node.js server receives the upload.

3. The receipt is sent to the PaddleOCR Python microservice.

4. PaddleOCR extracts the text from the receipt. PDFs are converted into
   images first using `pdf2image` and Poppler.

5. The extracted OCR text is sent to the local Gemma 4 service.

6. Gemma extracts structured fields such as:
   - Vendor
   - Date
   - Amount
   - Currency
   - Category
   - Line items
   - Confidence scores
   - Receipt validity

7. The Node.js server validates the extracted data before storing it.

8. The frontend displays the parsed receipt and provides simple spending
   analytics by category.

## Project Structure

The main parts of the project are:

- `server.js` - Node.js/Express backend. Handles uploads, connects the
  different services, validates extracted receipt data, stores expenses,
  and serves the frontend.

- `index.html` - Frontend for uploading receipts, viewing parsed results,
  and displaying analytics.

- `ocr/paddle_ocr.py` - Flask microservice running PaddleOCR.

- `ocr/requirements.txt` - Python dependencies for the OCR service.

- `llm/qwen_service.py` - Flask service that sends extraction requests to
  the local Gemma model through Ollama.

- `llm/schema.json` - JSON schema used to control the structure of the
  model's output.

- `data.sqlite` - Local SQLite database containing stored expenses.

- `clear_db.js` - Development script for clearing stored database contents.

## Running the Project

### 1. Start the OCR Microservice

Create and activate the Python virtual environment:

```bash
python -m venv .venv
.venv\Scripts\activate
```

Install the OCR dependencies:

```bash
pip install -r ocr/requirements.txt
```

Make sure `pdf2image` is installed:

```bash
pip install pdf2image
```

Poppler must also be installed and available to `pdf2image`.

Start PaddleOCR:

```bash
python ocr/paddle_ocr.py
```

The OCR service runs on:

`http://localhost:5001`

### 2. Start the Local Gemma Service

The LLM service uses Ollama to run Gemma locally.

Pull the model:

```bash
ollama pull gemma4:e2b
```

Check that it is available:

```bash
ollama list
```

Then start the Python Gemma service:

```bash
python llm/qwen_service.py
```

The extraction service runs on:

`http://localhost:5002`

It sends requests to Ollama at:

`http://localhost:11434/api/chat`

### 3. Start the Node Server

From the project root:

```bash
npm start
```

Or:

```bash
node server.js
```

The application runs on:

`http://localhost:3000`

Open that address in a browser to use the application.

## Clearing Stored Data

For development, `clear_db.js` can be used to remove existing expense data
and start again.

Run:

```bash
node clear_db.js
```

This is useful when testing the receipt extraction pipeline from a clean
database.

## Receipt Extraction

The OCR service is responsible for reading the receipt, but OCR alone does
not understand what each piece of text represents.

PaddleOCR extracts raw text from the receipt. The local Gemma model then
interprets that text and converts it into structured receipt data.

The extraction prompt contains rules for:

- Dates
- Vendors
- Amounts
- Currencies
- Categories
- Line items
- Confidence scores
- Receipt validation

The output is then validated by the Node.js server before it is accepted.

## Receipt Validation

The application also checks whether the uploaded document appears to be
an actual receipt.

If the OCR text clearly does not represent a receipt, the LLM returns:

```json
{
  "is_receipt": false
}
```

The Node.js server then rejects the upload rather than storing it as an
expense.

This prevents unrelated images or documents from being treated as receipts.

## Issues Faced and How They Were Solved

### 1. Incorrect Price Extraction

- The first version of the extraction logic used a simple approach that
  could treat the highest numerical value on the receipt as the price.

- This caused problems because receipts contain many numbers that are not
  prices, such as transaction IDs, account numbers, dates, quantities,
  and balances.

- The extraction was changed to specifically identify the final receipt
  total instead of simply choosing the largest number.

### 2. OCR Could Read the Receipt, but Not Understand It

- PaddleOCR was generally able to extract text from receipts correctly.

- However, OCR only provides text. It does not reliably understand which
  text represents the vendor, total, category, or transaction date.

- A local LLM was therefore added after the OCR stage to interpret the
  extracted text and return structured data.

### 3. Running Larger LLMs Locally Was Too Slow

- Larger local models require significantly more memory and computational
  resources.

- The project therefore uses the smaller `gemma4:e2b` model through Ollama.

- This provides a lightweight local LLM for receipt extraction while
  avoiding dependence on a hosted API.

### 4. Hosted LLM APIs Required Billing

- Using a hosted LLM API would require payment or billing details.

- Rather than relying on a paid external API, the project uses Ollama to
  run the model locally.

### 5. LLM Hallucinated Values

The LLM could sometimes make up values that were not actually present in
the receipt.

For example, it could invent a line item when the OCR did not contain that
item. It could also return incorrect confidence values or copy information
from another example.

To reduce this, the extraction prompt was made much stricter.

The prompt now tells the model to:

- Only use information from the current receipt.
- Never copy values from examples.
- Never invent missing information.
- Use `null` when there is not enough evidence.
- Return an empty `line_items` array when there are no identifiable products.
- Keep confidence values at the top level.
- Use the exact required fields for line items.
- Never turn the receipt total into a line item.

The Node.js server also validates the response against the expected schema.

### 6. Non-Receipt Images Were Being Accepted

Initially, any image containing readable text could be processed as a
receipt.

For example, an ID card or presentation slide could be passed through OCR
and then interpreted by the LLM.

Receipt validation was added to prevent this.

The LLM is now instructed to determine whether the OCR content represents
an actual receipt. Non-receipt documents return `is_receipt: false` and are
rejected by the Node.js validation layer.

### 7. Inconsistent Date Formats

Receipts can use different date formats, for example:

- `12/01/19`
- `10/16/21`
- `18/08/2026`

The extraction prompt was updated with explicit date rules requiring every
valid date to be returned as:

```text
YYYY-MM-DD
```

For example:

- `10/16/21` → `2021-10-16`
- `12/01/19` → `2019-12-01`
- `18/08/2026` → `2026-08-18`

The Node.js server also validates the date format before accepting the
result.

### 8. PDF Processing

PDF uploads are converted into individual page images using `pdf2image`
and Poppler before being passed to PaddleOCR.

Each page is processed independently by PaddleOCR, and the resulting OCR
text is combined before being passed to the LLM.

This allows the application to process PDFs containing multiple receipt
pages.

Multi-page PDFs can take significantly longer because each page requires
a separate OCR operation.

## Categories

The extraction prompt currently supports categories including:

- Groceries
- Food & Dining
- Shopping
- Transport
- Entertainment
- Travel
- Health
- Bills & Utilities
- Education
- Subscriptions
- Business
- Other

The category is chosen based on the merchant and the products or services
visible on the current receipt.

A supermarket receipt made up mostly of food items should normally be
classified as `Groceries`, while a supermarket receipt containing a mixture
of food and general retail products may be classified as `Shopping`.

## Frontend

The current frontend provides:

- Receipt file upload
- Parsed receipt output
- Stored expense data
- Category-based spending chart
- Total spending
- Receipt count

The frontend communicates with the Node.js backend rather than calling the
OCR or LLM services directly.

## Current Limitations

- OCR quality still depends on the receipt image.

- The `gemma4:e2b` local model is relatively small, so some receipts may
  still require additional prompting or validation.

- Complex receipts with unusual layouts can be difficult to interpret.

- Line-item quantities can be ambiguous when OCR separates a quantity from
  its product.

- Category classification is based on the information available in the
  OCR text.

- Multi-page PDFs take longer because each page is processed separately
  by PaddleOCR.

- PDF processing requires `pdf2image` and Poppler to be available on the
  system.

- The current analytics are intentionally simple and are mainly for
  demonstrating the extracted data.

## Next Steps

Some areas that could be improved further:

- Improve multi-page receipt processing and reduce OCR processing time.

- Process multiple PDF pages more efficiently.

- Improve line-item extraction for complicated receipt layouts.

- Improve category classification using more examples and/or a dedicated
  classifier.

- Add stronger validation between line-item totals and the receipt total.

- Improve OCR preprocessing for low-quality or rotated receipts.

- Add authentication and better database handling for a production version.

- Move the services to a hosted environment if local model performance
  becomes a limitation.
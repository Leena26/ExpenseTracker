# Expense Receipt OCR — Demo

A local expense receipt OCR app that takes a receipt image or PDF, extracts the text, uses a local Qwen 3:1.7B model to turn that text into structured receipt data, and then displays the result and basic spending analytics.

## What it does

The current pipeline works like this:

1. A user uploads a receipt through the web interface.
2. The Node.js server receives the upload.
3. The receipt is sent to the PaddleOCR Python microservice.
4. PaddleOCR extracts the text from the receipt. PDFs are converted into images first using `pdf2image`.
5. The extracted OCR text is sent to the local Qwen 3:1.7B service.
6. Qwen extracts structured fields such as:
   - Vendor
   - Date
   - Amount
   - Currency
   - Category
   - Line items
   - Confidence scores
7. The Node.js server validates the extracted data before storing it.
8. The frontend displays the parsed receipt and provides simple spending analytics by category.

## Project structure

The main parts of the project are:

- `server.js` — Node.js/Express backend. Handles uploads, connects the different services, validates the extracted receipt data, stores expenses, and serves the frontend.
- `index.html` — frontend demo for uploading receipts, viewing parsed results, and displaying analytics.
- `ocr/paddle_ocr.py` — Flask microservice running PaddleOCR.
- `ocr/requirements.txt` — Python dependencies for the OCR service.
- `llm/qwen_service.py` — Flask service that sends extraction requests to the local Qwen model through Ollama.
- `llm/schema.json` — JSON schema used to control the structure of Qwen's output.
- `data.sqlite` — local SQLite database containing stored expenses.
- `clear_db.js` — development script for clearing the stored database contents.

## Running the project

### 1. Start the OCR microservice

Create and activate the Python virtual environment:

```bash
python -m venv .venv
.venv\Scripts\activate
```

Install the OCR dependencies:

```bash
pip install -r ocr/requirements.txt
```

Start PaddleOCR:

```bash
python ocr/paddle_ocr.py
```

The OCR service runs on:

```
http://localhost:5001
```

### 2. Start the local Qwen service

Make sure Ollama is installed and that the Qwen model is available:

```bash
ollama pull qwen3:1.7b
```

Then start the Python Qwen service:

```bash
python llm/qwen_service.py
```

The Qwen extraction service runs on:

```
http://localhost:5002
```

It sends requests to Ollama at:

```
http://localhost:11434/api/chat
```

### 3. Start the Node server

From the project root:

```bash
node server.js
```

The application runs on:

```
http://localhost:3000
```

Open that address in a browser to use the demo.

## Clearing stored data

For development, `clear_db.js` can be used to remove the existing expense data and start again.

Run:

```bash
node clear_db.js
```

This is useful when testing the receipt extraction pipeline from a clean database.

## Quick tests

Check that the OCR service is running:

```
GET http://localhost:5001/health
```

Test OCR directly:

```bash
curl -F "receipt=@/path/to/receipt.jpg;filename=receipt.jpg" http://localhost:5001/ocr
```

Check the Qwen service:

```
GET http://localhost:5002/health
```

Test the full pipeline:

```bash
curl -F "file=@/path/to/receipt.jpg" http://localhost:3000/upload
```

## Receipt extraction

The OCR service is responsible for reading the receipt, but OCR alone does not understand what each piece of text represents.

For example, PaddleOCR can correctly return:

```
Walmart
TOTAL
35.05
10/16/21
```

but the application still needs to work out that:

- Walmart is the vendor
- 35.05 is the final amount
- 10/16/21 is the transaction date
- the receipt is mainly a grocery/retail purchase

The Qwen model handles this second stage.

The extraction prompt in the project contains rules for dates, currencies, categories, line items, amounts, and confidence values. The output is then validated by the Node server before it is accepted.

## Issues faced and how they were solved

### 1. Incorrect price extraction

The first version of the extraction logic used a simple approach that could treat the highest numerical value on the receipt as the price.

This caused problems because receipts contain lots of numbers that are not prices, such as transaction IDs, account numbers, dates, quantities, and balances.

The extraction was changed to specifically identify the final receipt total instead of simply choosing the largest number.

### 2. OCR could read the receipt, but not understand it

PaddleOCR was generally able to extract the text from the receipts correctly.

The problem was that OCR only gives us text. It does not reliably understand which text is the vendor, which number is the total, what category the purchase belongs to, or which date is the transaction date.

An LLM was therefore added after the OCR stage to interpret the extracted text and return structured data.

### 3. Running Qwen 3 8B locally required too much RAM

The original plan was to run Qwen 3 8B locally.

The current device only has around 2GB of RAM available for this workload, which was not enough to run the model properly.

A hosted Qwen API was considered instead.

### 4. Hosted Qwen API required billing

Using a hosted Qwen API would require payment/billing details.

Rather than relying on a paid API, the project switched to a much smaller local model:

**Qwen 3:1.7B**

It runs through Ollama and is exposed to the Node application through the local Flask service in `llm/qwen_service.py`.

### 5. Qwen hallucinated values

The smaller local model sometimes made up values that were not actually present in the receipt.

For example, it could invent a line item such as "Burger" or "Drink" when the OCR did not contain that item. It could also return incorrect confidence values or copy information from another example.

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

The Node server also validates the response schema after Qwen returns it.

### 6. Inconsistent date formats

Receipts can use different date formats, for example:

- `12/01/19`
- `10/16/21`
- `18/08/2026`

The model initially returned some dates in the original receipt format instead of the format expected by the application.

The extraction prompt was updated with explicit date rules requiring every valid date to be returned as:

```
YYYY-MM-DD
```

For example:

- `10/16/21` → `2021-10-16`
- `12/01/19` → `2019-12-01`
- `18/08/2026` → `2026-08-18`

The Node server also validates the date format before accepting the result.

## Current extraction example

For a Walmart receipt containing items such as a grill cover, Fiber Choice, celery hearts, and red grapes, the pipeline can now return structured data similar to:

```json
{
  "vendor": "Walmart",
  "date": "2021-10-16",
  "amount": 35.05,
  "currency": "USD",
  "category": "Shopping",
  "line_items": [
    {
      "description": "GRILL COVER",
      "quantity": null,
      "unit_price": 14.97,
      "total_price": 14.97
    },
    {
      "description": "FIBER CHOICE",
      "quantity": null,
      "unit_price": 12.94,
      "total_price": 12.94
    },
    {
      "description": "CELERY HEART",
      "quantity": 8,
      "unit_price": 2.48,
      "total_price": 19.84
    },
    {
      "description": "RED GRAPE",
      "quantity": 1,
      "unit_price": 3.61,
      "total_price": 3.61
    }
  ]
}
```

The exact output depends on the receipt and the quality of the OCR.

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

The category is chosen based on the merchant and the products or services visible on the current receipt.

For example, a supermarket receipt made up mostly of food items should normally be classified as Groceries, while a supermarket receipt containing a mixture of food and general retail products may be classified as Shopping.

## Frontend

The current frontend provides:

- Receipt file upload
- Parsed receipt output
- Stored expense data
- A category-based spending chart
- Total spending and receipt count

The frontend communicates with the Node backend rather than calling the OCR or Qwen services directly.

## Current limitations

- OCR quality still depends on the receipt image.
- The 1.7B local Qwen model is relatively small, so some receipts may still need better prompting or validation.
- Complex receipts with unusual layouts can be difficult to interpret.
- Line-item quantities can be ambiguous when OCR separates a quantity from its product.
- Category classification is based on the information available in the OCR text.
- PDF processing requires `pdf2image` and Poppler to be available on the system.
- The current analytics are intentionally simple and are mainly for demonstrating the extracted data.

## Next steps

Some areas that could be improved further:

- Improve line-item extraction for more complicated receipt layouts.
- Add better handling for multi-page receipts.
- Improve category classification using more examples and/or a dedicated classifier.
- Add stronger validation between line-item totals and the receipt total.
- Improve OCR preprocessing for low-quality or rotated receipts.
- Add authentication and better database handling for a production version.
- Move the services to a hosted environment if local model performance becomes a limitation.
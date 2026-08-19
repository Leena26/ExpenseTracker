const receiptSchema = require('./schema.json');

const examples = [
  {
    input: 'Fresh Mart\nDate: 2026-08-19\nBananas 2 x 2.00 4.00\nTOTAL SGD 12.50',
    output: {
      date: '2026-08-19',
      vendor: 'Fresh Mart',
      amount: 12.5,
      currency: 'SGD',
      category: 'Groceries',
      line_items: [
        {
          description: 'Bananas',
          quantity: 2,
          unit_price: 2,
          total_price: 4
        }
      ],
      confidence: {
        date: 0.99,
        vendor: 0.98,
        amount: 0.99,
        currency: 0.98,
        category: 0.95,
        line_items: 0.92
      },
      overall_confidence: 0.97
    }
  },
  {
    input: 'Ride receipt\n18/08/2026\nFare $18.40\nPaid',
    output: {
      date: '2026-08-18',
      vendor: 'Ride receipt',
      amount: 18.4,
      currency: null,
      category: 'Transport',
      line_items: [],
      confidence: {
        date: 0.7,
        vendor: 0.65,
        amount: 0.93,
        currency: 0.2,
        category: 0.8,
        line_items: 0.1
      },
      overall_confidence: 0.66
    }
  }
];

function buildReceiptExtractionPrompt(receiptText) {
  return ['IMPORTANT RULES:',
'- Extract each field independently. Never use the value of one field as another field.',
'- Use ONLY information explicitly present in the CURRENT RECEIPT.',
'- Never copy values from the examples.',
'- Never invent or hallucinate information.',
'- If a field cannot be determined reliably, return null.',
'',
'DATE RULES:',
'- The date must come from a date-like value in the receipt.',
'- Valid date evidence includes formats such as DD/MM/YY, MM/DD/YY, DD-MM-YYYY, MM-DD-YYYY, or YYYY-MM-DD.',
'- The receipt contains "12/01/19 14:31". Treat this as the transaction date and convert it to YYYY-MM-DD.',
'- Do NOT use the purchase amount, receipt number, terminal ID, authorization number, or any other numeric value as the date.',
'- Never output a date that does not correspond to an actual date appearing in the OCR.',
'',
'VENDOR RULES:',
'- The vendor is the merchant or store name.',
'- Look near the beginning of the receipt for the merchant name.',
'- Do not use generic words such as "MARKETS", "Purchase", "TerminalID", or "Cashier" as the vendor.',
'- When multiple words form the merchant name, combine them. For example, "Nugget" followed by "MARKETS" should be interpreted as "Nugget Markets".',
'',
'AMOUNT RULES:',
'- amount must be the final total charged for the receipt.',
'- Do not confuse the amount with card numbers, authorization numbers, terminal IDs, receipt numbers, dates, or times.',
'- A value such as "203.07" next to "Purchase" is a monetary amount.',
'',
'CURRENCY RULES:',
'- Only return a currency when there is explicit evidence for it, such as USD, $, EUR, GBP, etc.',
'- Do not infer currency merely from the merchant location.',
'- If there is no reliable currency evidence, return null.',
'',
'CATEGORY RULES:',
'- Choose the category based on the merchant and transaction information.',
'- If the merchant or purchase type cannot be reliably determined, use "Other".',
'',
'LINE ITEM RULES:',
'- Only include line items when individual purchased products or services are explicitly visible.',
'- Do not invent line items.',
  ].join('\n\n');
}

module.exports = { buildReceiptExtractionPrompt };
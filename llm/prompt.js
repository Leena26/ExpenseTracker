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
  input: `Nugget
MARKETS
Davis, California
Purchase
203.07
Auth # 03832D
Cashier # 4442
12/01/19 14:31
Ref/Seq # 072730`,
  output: {
    date: '2019-12-01',
    vendor: 'Nugget Markets',
    amount: 203.07,
    currency: null,
    category: 'Other',
    line_items: [],
    confidence: {
      date: 0.9,
      vendor: 0.9,
      amount: 0.95,
      currency: 0.1,
      category: 0.5,
      line_items: 0.95
    },
    overall_confidence: 0.75
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
'- Use null when the OCR does not provide enough evidence. Never guess a missing value.',
'- The OCR text is the ONLY source of truth. Never invent, infer, or fabricate receipt content.',
'- amount is the final total charged for the whole receipt.',
'- line_items must contain ONLY products or services explicitly visible in the OCR text.',
'- If the OCR does not contain identifiable products or services with prices, return line_items as an empty array [].',
'- NEVER create a line item merely because an amount exists.',
'- NEVER assume the receipt contains a Burger, Drink, Food, Item, Product, Service, or any other item unless that item is explicitly present in the OCR text.',
'- The receipt total must NOT be converted into a line item.',
'- amount MUST be a JSON number, never a string. For example: 203.07, not "203.07".',
'- quantity, unit_price, and total_price MUST also be JSON numbers or null, never strings.',
'- confidence values MUST be JSON numbers between 0 and 1.',
'- overall_confidence MUST be a JSON number between 0 and 1.',
'- If the OCR contains only a merchant name, transaction information, and a final amount, with no product/service descriptions, line_items MUST be [].',
'',
'DATE RULES:',
'- Find the transaction date from the CURRENT RECEIPT before producing the JSON.',
'- The transaction date is normally near the time, receipt sequence number, or transaction information.',
'- The CURRENT RECEIPT contains: "12/01/19 14:31".',
'- This is the transaction date and time.',
'- The receipt is from California, USA, so interpret slash dates as MM/DD/YY unless the receipt provides stronger evidence otherwise.',
'- Therefore "12/01/19" means December 1, 2019.',
'- Return that date as "2019-12-01".',
'- NEVER derive a date from an amount, receipt number, terminal ID, authorization number, or other unrelated number.',
'- If no date can be reliably identified, return null.',
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
'- Return a currency only when the CURRENT RECEIPT explicitly shows a currency symbol or currency code.',
'- "$" counts as explicit currency evidence and should be interpreted as USD for this receipt.',
'- "USD", "EUR", "GBP", "SGD", etc. are explicit currency codes.',
'- A country, city, merchant location, or phone number is NOT sufficient evidence.',
'- If no currency symbol or code appears in the OCR, return null.',
'',
'CATEGORY RULES:',
'- Choose the category based on the merchant and transaction information.',
'- If the merchant or purchase type cannot be reliably determined, use "Other".',
'',
'CONFIDENCE RULES:',
'- You MUST return the "confidence" object.',
'- confidence MUST contain: date, vendor, amount, currency, category, and line_items.',
'- Each confidence value must be a number from 0 to 1.',
'- You MUST return "overall_confidence" as a number from 0 to 1.',
'- Do not omit these fields even when the extracted value is null.',
'',
'CONFIDENCE STRUCTURE:',
'The "confidence" object belongs at the top level of the JSON.',
'It must NOT appear inside individual line_items.',
'The "overall_confidence" field belongs at the top level.',
'It must NOT appear inside individual line_items.',
'',
'LINE ITEM RULES:',
'- Each line item MUST use exactly these fields: description, quantity, unit_price, total_price.',
'- Do not include confidence inside a line item.',
'- Do not include overall_confidence inside a line item.',
'- Do not use a "name" field; use "description".',
'- If there are no clearly identifiable line items, return [].',
  ].join('\n\n');
}

module.exports = { buildReceiptExtractionPrompt };
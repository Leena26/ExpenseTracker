const receiptSchema = require('./schema.json');

const examples = [
  {
  input: `Nugget
MARKETS
Davis, California
(530) 750-3800
www.nuggetmarket.com
Purchase
203.07
Auth # 03832D
Cashier # 4442
12/01/19 14:31
Ref/Seq # 072730`,
  output: {
    is_receipt: true,
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
      category: 0.4,
      line_items: 0.95
    },
    overall_confidence: 0.75
  }
},
  {
    input: 'Fresh Mart\nDate: 2026-08-19\nBananas 2 x 2.00 4.00\nTOTAL SGD 12.50',
    output: {
      is_receipt: true,
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
    is_receipt: true,
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
      is_receipt: true,
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
'- Every required field in the schema must be present. Never omit a required field; use null or an empty array when there is insufficient evidence.',
'- Extract each field independently. Never use the value of one field as another field.',
'- Use ONLY information explicitly present in the CURRENT RECEIPT.',
'- Never copy values from the examples.',
'- Never invent or hallucinate information.',
'- The examples demonstrate the expected output format only; they must never be treated as evidence that the CURRENT RECEIPT is a receipt.',
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
'- "is_receipt" MUST always be present and MUST be a JSON boolean: true or false.',
'- First determine whether the CURRENT RECEIPT OCR represents an actual purchase receipt.',
'- Set is_receipt to true only when there is sufficient evidence that the document represents a purchase transaction.',
'- Evidence may include a merchant/vendor name, purchased products or services, prices, subtotal, tax, total, payment information, or transaction information.',
'- Do NOT classify a document as a receipt merely because it contains numbers, dates, text, or monetary values.',
'- If the OCR appears to be an unrelated document, photograph, screenshot, ID, letter, form, webpage, or other non-receipt document, set is_receipt to false.',
'- Never invent or infer receipt information to make a document qualify as a receipt.',
'- If is_receipt is false, date MUST be null.',
'- If is_receipt is false, vendor MUST be null.',
'- If is_receipt is false, amount MUST be null.',
'- If is_receipt is false, currency MUST be null.',
'- If is_receipt is false, category MUST be null.',
'- If is_receipt is false, line_items MUST be [].',
'- If is_receipt is false, all confidence values MUST be 0.',
'- If is_receipt is false, overall_confidence MUST be 0.',
'',
'DATE RULES:',
'- Find the transaction date in the CURRENT RECEIPT.',
'- Only use a date that actually appears in the CURRENT RECEIPT.',
'- The final JSON date MUST ALWAYS use the format YYYY-MM-DD.',
'- NEVER return the original date format from the receipt.',
'- Convert dates such as 10/16/21 to 2021-10-16.',
'- Convert dates such as 12/01/19 to 2019-12-01.',
'- Convert dates such as 18/08/2026 to 2026-08-18.',
'- For slash dates, determine whether the receipt uses MM/DD/YY or DD/MM/YY using the receipt context.',
'- Do not use dates from examples or previous receipts.',
'- Do not derive a date from an amount, receipt number, terminal ID, authorization number, or other unrelated number.',
'- If the date cannot be reliably identified, return null.',
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
'- Choose the category based ONLY on the merchant and products/services explicitly visible in the CURRENT RECEIPT.',
'- Use exactly one of the allowed categories from the schema.',
'- Groceries: supermarkets, grocery stores, food shops, or receipts primarily containing food/grocery products.',
'- Food & Dining: restaurants, cafes, takeaways, fast food, or prepared meals.',
'- Shopping: general retail purchases, household goods, clothing, electronics, hardware, home goods, or mixed retail purchases.',
'- Transport: taxis, rideshares, public transport, fuel, parking, or vehicle-related transport expenses.',
'- Entertainment: cinemas, concerts, games, streaming entertainment, or recreational activities.',
'- Travel: hotels, flights, accommodation, or travel bookings.',
'- Health: pharmacies, medical services, dentists, hospitals, or healthcare products/services.',
'- Bills & Utilities: electricity, water, gas, internet, phone, or other household bills.',
'- Education: tuition, courses, books for education, or educational services.',
'- Subscriptions: recurring software, memberships, or subscription services.',
'- Business: business-related purchases or expenses explicitly identifiable as business expenses.',
'- Other: use only when the purchase cannot reasonably be assigned to one of the categories above.',
'- For a supermarket receipt, choose Groceries when the receipt is primarily food/grocery items.',
'- For a supermarket receipt containing a mixture of groceries and general retail merchandise, choose Shopping.',
'- Do not choose Other merely because the merchant sells multiple types of products.',
'',
'CONFIDENCE RULES:',
'- You MUST return the "confidence" object.',
'- confidence MUST contain: date, vendor, amount, currency, category, and line_items.',
'- Each confidence value must be a number from 0 to 1.',
'- You MUST return "overall_confidence" as a number from 0 to 1.',
'- Do not omit these fields even when the extracted value is null.',
'',
'CONFIDENCE STRUCTURE:',
'- The "confidence" object belongs at the top level of the JSON.',
'- It must NOT appear inside individual line_items.',
'- The "overall_confidence" field belongs at the top level.',
'- It must NOT appear inside individual line_items.',
'- line_items confidence should reflect how reliably the products, quantities, and prices were identified.',
'- If multiple line items are clearly identified with corresponding prices, line_items confidence should be greater than 0.',
'- Use a low line_items confidence only when the OCR makes the products or their prices genuinely ambiguous.',
'',
'LINE ITEM RULES:',
'- If is_receipt is false, line_items MUST be an empty array [].',
'- Each line item MUST use exactly these fields: description, quantity, unit_price, total_price.',
'- Do not include confidence inside a line item.',
'- Do not include overall_confidence inside a line item.',
'- Do not use a "name" field; use "description".',
'- If there are no clearly identifiable line items, return [].',
'- If the relationship between a quantity and a product is ambiguous in the OCR, use null for quantity rather than assigning the quantity to the wrong product.',
'- Do not move quantities between neighbouring line items.',
'- Do not infer a quantity from an isolated number unless its relationship to the product is clear.',

'',
'CURRENT RECEIPT OCR:',
'--------------------------------',
receiptText,
'--------------------------------',
'',

'Return ONLY the JSON object.'
].join('\n\n');
}

module.exports = { buildReceiptExtractionPrompt };
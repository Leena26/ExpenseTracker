function extractReceiptWithHeuristics(ocrText) {
  const lines = String(ocrText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const vendor = findVendor(lines);
  const date = findDate(lines);
  const amount = findAmount(lines);
  const currency = findCurrency(ocrText);
  const category = findCategory(ocrText);
  const confidence = {
    date: date ? 0.45 : 0,
    vendor: vendor ? 0.4 : 0,
    amount: amount === null ? 0 : 0.45,
    currency: currency ? 0.45 : 0,
    category: 0.2,
    line_items: 0
  };

  return {
    date,
    vendor,
    amount,
    currency,
    category,
    line_items: [],
    confidence,
    overall_confidence: Number(
      (Object.values(confidence).reduce((total, value) => total + value, 0) /
        Object.keys(confidence).length).toFixed(2)
    )
  };
}

function findVendor(lines) {
  const ignored = /total|subtotal|tax|invoice|receipt|amount|date|qty|balance/i;
  return lines.find((line) => /[a-z]/i.test(line) && line.length > 2 && !ignored.test(line)) || null;
}

function findDate(lines) {
  for (const line of lines) {
    const isoMatch = line.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/);
    if (isoMatch) return toIsoDate(isoMatch[1], isoMatch[2], isoMatch[3]);

    const numericMatch = line.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
    if (numericMatch) {
      const first = Number(numericMatch[1]);
      const second = Number(numericMatch[2]);
      const [month, day] = first > 12 ? [second, first] : [first, second];
      return toIsoDate(numericMatch[3], month, day);
    }
  }
  return null;
}

function toIsoDate(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function findAmount(lines) {
  const candidates = [];
  const moneyPattern = /(?:S\$|US\$|USD|SGD|EUR|GBP|\$|€|£)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/gi;

  for (const line of lines) {
    for (const match of line.matchAll(moneyPattern)) {
      const value = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(value)) {
        candidates.push({ value, isTotal: /grand total|total|amount due|balance due/i.test(line) });
      }
    }
  }

  const total = candidates.filter((candidate) => candidate.isTotal).at(-1);
  return total ? total.value : candidates.at(-1)?.value ?? null;
}

function findCurrency(ocrText) {
  const text = String(ocrText || '').toUpperCase();
  if (/S\$|\bSGD\b/.test(text)) return 'SGD';
  if (/US\$|\bUSD\b/.test(text)) return 'USD';
  if (/€|\bEUR\b/.test(text)) return 'EUR';
  if (/£|\bGBP\b/.test(text)) return 'GBP';
  return null;
}

function findCategory(ocrText) {
  const text = String(ocrText || '').toLowerCase();
  if (/taxi|ride|train|bus|metro|grab|uber/.test(text)) return 'Transport';
  if (/restaurant|cafe|coffee|food|meal|dining/.test(text)) return 'Food & Dining';
  if (/market|grocery|supermarket|produce/.test(text)) return 'Groceries';
  return 'Other';
}

module.exports = { extractReceiptWithHeuristics };

const form = document.getElementById('uploadForm');
const parsedEl = document.getElementById('parsed');
const chartCtx = document.getElementById('chart').getContext('2d');
let chart;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('file');
  if (!fileInput.files.length) return alert('Choose a file');

  const fd = new FormData();
  fd.append('file', fileInput.files[0]);

  parsedEl.textContent = 'Uploading...';
  const res = await fetch('/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (res.ok) {
    parsedEl.textContent = JSON.stringify(data.parsed, null, 2);
    await refreshAnalytics();
  } else {
    parsedEl.textContent = 'Error: ' + (data.error || JSON.stringify(data));
  }
});

async function refreshAnalytics() {
  const res = await fetch('/api/expenses');
  const rows = await res.json();

  // Simple analytics: total amount and count by category
  const byCategory = {};
  let total = 0;
  rows.forEach(r => {
    const amt = Number(r.amount) || 0;
    total += amt;
    const cat = r.category || 'uncategorized';
    byCategory[cat] = (byCategory[cat] || 0) + amt;
  });

  const labels = Object.keys(byCategory);
  const values = labels.map(l => byCategory[l]);

  if (chart) chart.destroy();
  chart = new Chart(chartCtx, {
    type: 'pie',
    data: { labels, datasets: [{ data: values, backgroundColor: ['#4dc9f6','#f67019','#f53794','#537bc4','#acc236'] }] },
    options: { plugins: { title: { display: true, text: `Total: $${total.toFixed(2)} (${rows.length} receipts)` } } }
  });
}

// initial load
refreshAnalytics();

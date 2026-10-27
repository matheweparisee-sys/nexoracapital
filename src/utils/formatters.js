export function fmtMoney(value, currency = 'USD') {
  const n = Number(value ?? 0);
  if (!isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)}`;
  }
}

export function fmtQty(value, symbol = '') {
  const n = Number(value ?? 0);
  if (!isFinite(n) || n === 0) return symbol ? `0 ${symbol}` : '0';
  const s = n.toLocaleString('en-US', { maximumFractionDigits: 8 });
  return symbol ? `${s} ${symbol}` : s;
}

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtPct(value) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

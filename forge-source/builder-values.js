/* Builder values and exports: keep quoted/range prices distinct from known amounts. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ForgeBuilderValues = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function finiteAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!/^(?:\$\s*|USD\s*)?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
    const amount = Number(text.replace(/^(?:\$\s*|USD\s*)/, '').replace(/,/g, ''));
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  }
  function price(part) {
    const raw = part?.approx_price;
    const amount = finiteAmount(raw);
    return { amount, note: amount == null ? (typeof raw === 'string' && raw.trim() ? raw.trim() : 'Price unavailable') : '' };
  }
  function weight(part) {
    for (const value of [part?.schema_data?.weight_g, part?.weight_g]) {
      if (typeof value === 'string' && !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value.trim())) continue;
      const amount = finiteAmount(value);
      if (amount != null) return amount;
    }
    return null;
  }
  function rows(build, parts) {
    const byPid = new Map();
    for (const part of parts) if (part.pid && !byPid.has(part.pid)) byPid.set(part.pid, part);
    return build.map(item => {
      const part = byPid.get(item.pid);
      const value = price(part);
      return { pid: item.pid, name: part?.name || item.name || item.pid, cat: part?._cat || item.cat || '', price: value.amount, priceNote: value.note, weight: weight(part) };
    });
  }
  function totals(items) {
    return items.reduce((total, item) => {
      if (item.price == null) total.unknownPrices++; else total.price += item.price;
      if (item.weight == null) total.unknownWeights++; else total.weight += item.weight;
      return total;
    }, { price: 0, weight: 0, unknownPrices: 0, unknownWeights: 0 });
  }
  const csvCell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  function csv(items) {
    const total = totals(items);
    const cells = [
      ['PID', 'Name', 'Category', 'Price_USD', 'Weight_g', 'Price_Notes', 'Weight_Notes'],
      ...items.map(item => [item.pid, item.name, item.cat, item.price, item.weight, item.priceNote, item.weight == null ? 'Weight unavailable' : '']),
      ['', '', total.unknownPrices || total.unknownWeights ? 'KNOWN TOTAL' : 'TOTAL', total.price.toFixed(2), total.weight.toFixed(1), total.unknownPrices ? `${total.unknownPrices} part prices excluded` : '', total.unknownWeights ? `${total.unknownWeights} part weights excluded` : ''],
    ];
    return cells.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  function encode(pids) {
    const bytes = new TextEncoder().encode(JSON.stringify(pids));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(encoded) {
    try {
      const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))); }
      catch { text = binary; } // Existing Latin-1 links used raw btoa(JSON.stringify(...)).
      const pids = JSON.parse(text);
      return Array.isArray(pids) && pids.every(pid => typeof pid === 'string') ? pids : null;
    } catch { return null; }
  }
  return { finiteAmount, price, weight, rows, totals, csv, encode, decode };
});

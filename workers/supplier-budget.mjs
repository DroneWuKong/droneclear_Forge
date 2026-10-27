// Integer micro-USD accounting. Reservations survive failures and process restarts.
export const MONTHLY_LIMIT = 25_000_000;
export const SUPPLIER_PRICING = Object.freeze({
  model: 'gpt-5-mini', checkedAt: '2026-10-27', context: 400_000,
  inputPerMillion: 250_000, outputPerMillion: 2_000_000, searchCall: 10_000,
  maxToolCalls: 3, maxOutputTokens: 2000,
  source: 'https://developers.openai.com/api/docs/models/gpt-5-mini',
});
export function reservationCost(pricing = SUPPLIER_PRICING) {
  // Reserve the full context on every possible model turn, without cache discounts.
  return Math.ceil(pricing.context * (pricing.maxToolCalls + 1) * pricing.inputPerMillion / 1e6
    + pricing.maxOutputTokens * pricing.outputPerMillion / 1e6 + pricing.maxToolCalls * pricing.searchCall);
}
export function usageCost(response, pricing = SUPPLIER_PRICING) {
  const usage = response?.usage;
  if (!usage || !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0
      || !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0) return null;
  const calls = (response.output || []).filter(item => item.type === 'web_search_call').length;
  return Math.ceil(usage.input_tokens * pricing.inputPerMillion / 1e6
    + usage.output_tokens * pricing.outputPerMillion / 1e6 + calls * pricing.searchCall);
}
export function reserveSupplier(previous, {id, amount, week}, now = Date.now()) {
  const month = new Date(now).toISOString().slice(0, 7);
  const state = previous || {month, entries:{}};
  if (state.month !== month) throw new Error('Budget object month mismatch');
  if (!/^[0-9]{4}-W[0-9]{2}-[A-Z]{2}$/.test(id || '') || !id.startsWith(week + '-')
      || !Number.isSafeInteger(amount) || amount <= 0 || amount > MONTHLY_LIMIT) throw new Error('Invalid reservation');
  if (state.entries[id]) return {allowed:false, duplicate:true, entry:state.entries[id], state};
  const entries = Object.values(state.entries);
  const charged = entries.reduce((n, row) => n + (row.actual ?? row.reserved), 0);
  if (entries.filter(row => row.week === week).length >= 10 || charged + amount > MONTHLY_LIMIT)
    return {allowed:false, reason:'budget_exhausted', state};
  const next = structuredClone(state);
  next.entries[id] = {reserved:amount, actual:null, week, status:'reserved', created_at:new Date(now).toISOString()};
  return {allowed:true, state:next};
}
export function settleSupplier(state, {id, actual, result}) {
  const entry = state?.entries?.[id];
  if (!entry) throw new Error('Reservation missing');
  if (entry.status === 'settled') return state;
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > entry.reserved)
    throw new Error('Usage cannot safely settle reservation');
  const next = structuredClone(state);
  next.entries[id] = {...entry, actual, status:'settled', result};
  return next;
}
export function supplierBudgetStatus(state) {
  const entries = Object.values(state?.entries || {});
  return {month:state?.month, limit_micro_usd:MONTHLY_LIMIT,
    committed_micro_usd:entries.reduce((n, row) => n + (row.actual ?? row.reserved), 0),
    pending_reservations:entries.filter(row => row.status !== 'settled').length, tasks:entries.length};
}

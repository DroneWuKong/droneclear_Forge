import { DurableObject } from 'cloudflare:workers';
import { budgetDecision } from './proxy-policy.mjs';
import { reserveSupplier, settleSupplier, supplierBudgetStatus } from './supplier-budget.mjs';
export class ModelBudget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS budget (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS supplier_budget (month TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }
  async reserve({ units }) {
    return this.ctx.storage.transactionSync(() => {
      const rows = this.ctx.storage.sql.exec('SELECT value FROM budget WHERE id = 1').toArray();
      const result = budgetDecision(rows.length ? JSON.parse(rows[0].value) : null, units, Date.now());
      if (result.allowed) this.ctx.storage.sql.exec('INSERT INTO budget (id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify(result.state));
      return { allowed: result.allowed, retryAfter: result.retryAfter };
    });
  }
  async reserveSupplier(input) {
    return this.ctx.storage.transactionSync(() => {
      const now = new Date();
      const month = now.toISOString().slice(0, 7);
      const priorMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-1, 1)).toISOString().slice(0,7);
      const priorRow = this.ctx.storage.sql.exec('SELECT value FROM supplier_budget WHERE month=?', priorMonth).toArray()[0];
      const prior = priorRow ? JSON.parse(priorRow.value) : {entries:{}};
      if (prior.entries[input.id]) return {allowed:false, duplicate:true, entry:prior.entries[input.id], month:priorMonth};
      const row = this.ctx.storage.sql.exec('SELECT value FROM supplier_budget WHERE month=?', month).toArray()[0];
      const current = row ? JSON.parse(row.value) : null;
      const weeklyCount = [...Object.values(prior.entries), ...Object.values(current?.entries || {})].filter(entry=>entry.week===input.week).length;
      if (!current?.entries[input.id] && weeklyCount >= 10) return {allowed:false, reason:'weekly_limit', month};
      const result = reserveSupplier(current, input);
      if (result.allowed) this.ctx.storage.sql.exec('INSERT INTO supplier_budget(month,value) VALUES(?,?) ON CONFLICT(month) DO UPDATE SET value=excluded.value', month, JSON.stringify(result.state));
      return {allowed:result.allowed, duplicate:result.duplicate || false, entry:result.entry, reason:result.reason, month};
    });
  }
  async settleSupplier({month, ...input}) {
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec('SELECT value FROM supplier_budget WHERE month=?', month).toArray()[0];
      const state = settleSupplier(row ? JSON.parse(row.value) : null, input);
      this.ctx.storage.sql.exec('UPDATE supplier_budget SET value=? WHERE month=?', JSON.stringify(state), month);
      return supplierBudgetStatus(state);
    });
  }
  async supplierStatus() {
    const month = new Date().toISOString().slice(0, 7);
    const row = this.ctx.storage.sql.exec('SELECT value FROM supplier_budget WHERE month=?', month).toArray()[0];
    return supplierBudgetStatus(row ? JSON.parse(row.value) : {month, entries:{}});
  }
}
export default { fetch() { return new Response('Not found', { status: 404 }); } };

import { DurableObject } from 'cloudflare:workers';
import { budgetDecision } from './proxy-policy.mjs';
export class ModelBudget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS budget (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  }
  async reserve({ units }) {
    return this.ctx.storage.transactionSync(() => {
      const rows = this.ctx.storage.sql.exec('SELECT value FROM budget WHERE id = 1').toArray();
      const result = budgetDecision(rows.length ? JSON.parse(rows[0].value) : null, units, Date.now());
      if (result.allowed) this.ctx.storage.sql.exec('INSERT INTO budget (id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify(result.state));
      return { allowed: result.allowed, retryAfter: result.retryAfter };
    });
  }
}
export default { fetch() { return new Response('Not found', { status: 404 }); } };

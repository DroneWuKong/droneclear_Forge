import { authorize, json, PROXY_HEADERS, readBoundedJson, outputLimit, allowedModel, reserve } from './proxy-policy.mjs';
export default {
  async fetch(req, env) {
    const denied = await authorize(req, env);
    if (denied) return denied;
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Provider not configured' }, 503);
    try {
      const { body, inputUnits } = await readBoundedJson(req);
      if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100) throw new Error('1-100 messages required');
      const messages = body.messages.map(message => {
        if (!message || !['user', 'assistant', 'system'].includes(message.role) || typeof message.content !== 'string') throw new Error('Text messages with valid roles required');
        return { role: message.role, content: message.content };
      });
      const tokens = outputLimit(body.max_tokens);
      const model = allowedModel(body, env, 'CLAUDE', 'claude-sonnet-4-6');
      const url = 'https://api.anthropic.com/v1/messages';
      const headers = { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };
      if (messages.some(m => m.role === 'system')) throw new Error('Use the system field for Claude instructions');
      if (body.system != null && typeof body.system !== 'string') throw new Error('System instructions must be text');
      const outbound = { model, messages, max_tokens: tokens, ...(body.system ? { system: body.system } : {}) };
      const limited = await reserve(env, inputUnits, tokens);
      if (limited) return limited;
      let upstream;
      try { upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(outbound), signal: AbortSignal.timeout(30000) }); }
      catch { return json({ error: 'Provider unavailable' }, 502); }
      return new Response(upstream.body, { status: upstream.status, headers: PROXY_HEADERS });
    } catch (error) { return json({ error: error.message || 'Invalid request' }, 400); }
  },
};

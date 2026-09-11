import { authorize, json, PROXY_HEADERS, readBoundedJson, outputLimit, allowedModel, reserve } from './proxy-policy.mjs';
export default {
  async fetch(req, env) {
    const denied = await authorize(req, env);
    if (denied) return denied;
    if (!env.GROQ_API_KEY) return json({ error: 'Provider not configured' }, 503);
    try {
      const { body, inputUnits } = await readBoundedJson(req);
      if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100) throw new Error('1-100 messages required');
      const messages = body.messages.map(message => {
        if (!message || !['user', 'assistant', 'system'].includes(message.role) || typeof message.content !== 'string') throw new Error('Text messages with valid roles required');
        return { role: message.role, content: message.content };
      });
      const tokens = outputLimit(body.max_tokens);
      const model = allowedModel(body, env, 'GROQ', 'openai/gpt-oss-120b');
      const url = 'https://api.groq.com/openai/v1/chat/completions';
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` };
      const outbound = { model, messages, max_tokens: tokens, n: 1, ...(model.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low', include_reasoning: false } : {}) };
      const limited = await reserve(env, inputUnits, tokens);
      if (limited) return limited;
      let upstream;
      try { upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(outbound), signal: AbortSignal.timeout(30000) }); }
      catch { return json({ error: 'Provider unavailable' }, 502); }
      return new Response(upstream.body, { status: upstream.status, headers: PROXY_HEADERS });
    } catch (error) { return json({ error: error.message || 'Invalid request' }, 400); }
  },
};

import { authorize, json, PROXY_HEADERS, readBoundedJson, outputLimit, allowedModel, reserve } from './proxy-policy.mjs';
export default {
  async fetch(req, env) {
    const denied = await authorize(req, env);
    if (denied) return denied;
    if (!env.GEMINI_API_KEY) return json({ error: 'Provider not configured' }, 503);
    try {
      const { body, inputUnits } = await readBoundedJson(req);
      const model = allowedModel(body, env, 'GEMINI', 'gemini-2.5-flash');
      let contents = body.contents;
      if (body.messages) {
        if (!Array.isArray(body.messages)) throw new Error('Messages must be a list');
        contents = body.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : m.role, parts: [{ text: m.content }] }));
      }
      if (!Array.isArray(contents) || !contents.length || contents.length > 100) throw new Error('1-100 contents required');
      contents = contents.map(c => {
        if (!c || !['user','model'].includes(c.role || 'user') || !Array.isArray(c.parts) || !c.parts.length) throw new Error('Invalid content');
        return { role: c.role || 'user', parts: c.parts.map(p => {
          if (!p || typeof p.text !== 'string') throw new Error('Text parts required');
          return { text: p.text };
        }) };
      });
      const tokens = outputLimit(body.max_tokens ?? body.generationConfig?.maxOutputTokens);
      const outbound = { contents, generationConfig: { maxOutputTokens: tokens, candidateCount: 1, ...(model.startsWith('gemini-2.5-flash') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } };
      if (body.systemInstruction != null) {
        const parts = body.systemInstruction?.parts;
        if (!Array.isArray(parts) || !parts.length || parts.some(p => !p || typeof p.text !== 'string')) throw new Error('System instructions must contain text parts');
        outbound.systemInstruction = { parts: parts.map(p => ({ text: p.text })) };
      }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY };
      const limited = await reserve(env, inputUnits, tokens);
      if (limited) return limited;
      let upstream;
      try { upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(outbound), signal: AbortSignal.timeout(30000) }); }
      catch { return json({ error: 'Provider unavailable' }, 502); }
      return new Response(upstream.body, { status: upstream.status, headers: PROXY_HEADERS });
    } catch (error) { return json({ error: error.message || 'Invalid request' }, 400); }
  },
};

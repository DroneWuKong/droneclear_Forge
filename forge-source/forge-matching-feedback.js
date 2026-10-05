// Explicit product judgments only. Adding a part or browsing never creates a label.
export async function prepareMatchingSnapshot(snapshot) {
  const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify(value))))].map(v => v.toString(16).padStart(2, '0')).join('');
  const [context_sha256, catalog_revision] = await Promise.all([digest(snapshot.context), digest(snapshot.catalog)]);
  return { context_sha256, catalog_revision, category: snapshot.category };
}

export function attachMatchingFeedback(card, comp, snapshot) {
  if (!crypto.randomUUID || !comp.pid) return;
  const weight = Number(comp.schema_data?.weight_g);
  const specs = Object.values(comp.schema_data || {});
  const features = { weight_known: Number.isFinite(weight) && weight > 0,
    weight_g: Number.isFinite(weight) && weight > 0 ? Math.min(weight, 100000) : 0,
    warning_count: snapshot.warningCount,
    specification_completeness: specs.length ? specs.filter(v => v != null && v !== '').length / specs.length : 0 };
  const controls = document.createElement('div');
  controls.className = 'matching-feedback';
  controls.setAttribute('aria-label', 'Was this component suggestion useful?');
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  for (const [label, title] of [['helpful', 'Useful match'], ['wrong_match', 'Poor match'], ['catalog_error', 'Data issue']]) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = title;
    button.addEventListener('click', async event => {
      event.stopPropagation();
      const buttons = [...controls.querySelectorAll('button')];
      buttons.forEach(b => { b.disabled = true; }); status.textContent = 'Sending…';
      // Keep the same id/body on transport retry; changing judgment creates a new event.
      button.feedbackBody ||= { schema_version: 'forge-match-feedback-v1', feedback_id: crypto.randomUUID(),
        context_sha256: snapshot.context_sha256, catalog_revision: snapshot.catalog_revision, policy_version: 'compatibility-weight-v1',
        category: snapshot.category, label, target: { product_id: String(comp.pid),
          compatibility_group: snapshot.group, position: snapshot.position, features } };
      try {
        const response = await fetch('/api/autonomy/forge-feedback', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(button.feedbackBody) });
        if (!response.ok) throw Error('Feedback could not be saved. Try again.');
        status.textContent = 'Saved for review';
      } catch (error) { status.textContent = error.message; buttons.forEach(b => { b.disabled = false; }); }
    });
    controls.appendChild(button);
  }
  controls.addEventListener('click', event => event.stopPropagation());
  controls.appendChild(status); card.appendChild(controls);
}

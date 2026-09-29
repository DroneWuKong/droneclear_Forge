/* Shared DDG program context for the gated workspace. */
(async function () {
  const heading = document.querySelector('h1');
  if (!heading) return;
  const panel = document.createElement('section');
  panel.id = 'ddg-program-update';
  panel.setAttribute('aria-label', 'Latest verified DDG program update');
  panel.style.cssText = 'margin:18px 0;padding:16px;border:1px solid #40554a;border-left:3px solid #84cc91;background:#141a17;color:#dbe4dd;font:13px/1.65 sans-serif;max-width:1100px;overflow-wrap:anywhere';
  panel.textContent = 'Loading verified DDG program update…';
  heading.insertAdjacentElement('afterend', panel);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  try {
    const response = await fetch('/private/data/ddg_program_update.json', {cache:'no-store'});
    if (!response.ok) throw new Error('Update unavailable');
    const d = await response.json();
    if (d.schema_version !== 1 || !d.rfs_confirmed || !Array.isArray(d.phase_2_5.invitees)) throw new Error('Invalid update');
    panel.innerHTML = '<strong style="color:#a3e6b1">VERIFIED '+esc(d.as_of)+' · '+esc(d.headline)+'</strong>'+
      '<p>'+esc(d.summary)+'</p><p><b>Phase 2.5:</b> '+esc(d.phase_2_5.invitee_count)+' invited organizations · '+esc(d.phase_2_5.window)+' · '+esc(d.phase_2_5.venue)+'. Invitations are not awards.</p>'+
      '<details><summary style="cursor:pointer">Invitees, entry policy, supply-chain context and sources</summary>'+
      '<p>'+d.phase_2_5.invitees.map(esc).join(' · ')+'</p><p>'+esc(d.entry_policy.value)+'</p>'+
      '<p>'+esc(d.supply_chain_note)+'</p><p>'+esc(d.date_note)+'</p><p>'+esc(d.phase_2_5.date_note)+'</p>'+
      '<ul>'+Object.values(d.sources).filter(x=>/^https:\/\//.test(x.url)).map(x=>'<li><a style="color:#9dccff" target="_blank" rel="noopener noreferrer" href="'+esc(x.url)+'">'+esc(x.title)+'</a></li>').join('')+'</ul></details>'+
      '<p style="margin-bottom:0"><a style="color:#9dccff" href="/private/ddg/#g3">Phase 3 tracker</a> · <a style="color:#9dccff" href="/private/dossiers/#ddg-program-update">Research note</a> · <a style="color:#9dccff" href="/private/data/">Source datasets</a></p>';
  } catch (_) {
    panel.textContent = 'Latest DDG program update could not be loaded. Open the DDG tracker for the dated reviewed snapshot.';
  }
})();

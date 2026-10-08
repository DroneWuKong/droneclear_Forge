(function (root) {
  'use strict';
  const labels = {pass:'Recorded pass',fail:'Recorded failure',blocked:'Blocked',not_run:'Not run',review_required:'Human review',external_required:'External acceptance'};
  function checks(catalog, profile) {
    if (!Object.hasOwn(catalog.profiles, profile)) throw new Error('Unknown profile');
    return [...catalog.profiles.general.checks, ...(profile === 'general' ? [] : catalog.profiles[profile].checks)];
  }
  function validateReport(report, catalog, catalogHash) {
    if (!report || report.schema_version !== 1 || report.tool !== 'forge-system-test-lab' || report.tool_version !== catalog.version || report.profile_version !== catalog.version || report.catalog_sha256 !== catalogHash || report.scope !== 'local_software_preparation' || report.certification !== false || report.program_acceptance !== false || typeof report.commands_executed !== 'boolean') throw new Error('Wrong report, version, profile bytes or scope.');
    if (!report.system || Object.keys(report.system).sort().join(',') !== 'name,source_commit,version' || Object.values(report.system).some(v => typeof v !== 'string' || v.length > 200)) throw new Error('Invalid release identity.');
    if (!/^[a-f0-9]{64}$/.test(report.config_sha256 || '') || typeof report.recorded_at !== 'string' || !Number.isFinite(Date.parse(report.recorded_at))) throw new Error('Missing configuration digest or recorded date.');
    const expected = checks(catalog, report.profile);
    if (!Array.isArray(report.results) || report.results.length !== expected.length) throw new Error('Incomplete report.');
    for (let i = 0; i < expected.length; i++) {
      const row = report.results[i], check = expected[i];
      if (!row || row.id !== check.id || row.kind !== check.kind || !Object.hasOwn(labels, row.status) || typeof row.detail !== 'string' || row.detail.length > 2000 || !Array.isArray(row.evidence) || row.evidence.length > 100) throw new Error('Invalid or duplicate check result.');
      if ((check.kind === 'external' && row.status !== 'external_required') || (check.kind === 'review' && row.status !== 'review_required') || (!['external','review'].includes(check.kind) && ['review_required','external_required'].includes(row.status))) throw new Error('A report cannot close human or external acceptance.');
      if (check.kind === 'command' && row.status === 'pass' && !report.commands_executed) throw new Error('Unexecuted command cannot pass.');
      for (const evidence of row.evidence) {
        if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('Invalid evidence reference.');
        const fields = Object.keys(evidence).sort().join(',');
        if (fields === 'adapter_output_sha256') {
          if (!/^[a-f0-9]{64}$/.test(evidence.adapter_output_sha256)) throw new Error('Invalid output digest.');
        } else if (fields === 'path,sha256') {
          if (typeof evidence.path !== 'string' || evidence.path.length > 4096 || !/^[a-f0-9]{64}$/.test(evidence.sha256)) throw new Error('Invalid file digest.');
        } else throw new Error('Unsupported evidence fields.');
      }
      if (row.status === 'pass' && ['document','artifacts','command'].includes(check.kind) && !row.evidence.length) throw new Error('Passing result is missing evidence.');
      if (row.status === 'pass' && check.kind === 'identity' && (!Object.values(report.system).every(Boolean) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(report.system.source_commit))) throw new Error('Passing identity is incomplete.');
      if (row.status === 'pass' && check.kind === 'command' && (row.evidence.length !== 1 || !Object.hasOwn(row.evidence[0], 'adapter_output_sha256'))) throw new Error('Passing command needs its output digest.');
      if (row.status === 'pass' && ['document','artifacts'].includes(check.kind) && row.evidence.some(e => !Object.hasOwn(e, 'path'))) throw new Error('Passing file check needs file evidence.');
      if (row.status === 'pass' && check.kind === 'document' && (row.evidence.length !== 1 || (check.expected_sha256 && row.evidence[0].sha256 !== check.expected_sha256))) throw new Error('Document does not match the reviewed source.');
    }
    return report;
  }
  function validateReview(review, catalog, catalogHash) {
    if (!review || review.schema_version !== 1 || review.tool !== 'forge-test-review' || review.profile_version !== catalog.version || review.catalog_sha256 !== catalogHash || review.certification !== false || review.program_acceptance !== false || review.report_verified !== false) throw new Error('Invalid saved review or scope.');
    const allowed = new Set(checks(catalog, review.profile).map(row => row.id));
    if (!review.reviewer_notes || typeof review.reviewer_notes !== 'object' || Array.isArray(review.reviewer_notes) || Object.keys(review.reviewer_notes).length > allowed.size || Object.entries(review.reviewer_notes).some(([id,text]) => !allowed.has(id) || typeof text !== 'string' || text.length > 2000)) throw new Error('Invalid reviewer notes.');
    if (review.runner_report !== null && validateReport(review.runner_report,catalog,catalogHash).profile !== review.profile) throw new Error('Mismatched review profile.');
    return review;
  }
  const api = {checks, validateReport, validateReview};
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ForgeTestLab = api;
  if (typeof document === 'undefined' || !document.getElementById('lab-status')) return;

  let catalog, catalogHash, profile = 'general', report = null, notes = Object.create(null);
  const byId = id => document.getElementById(id);
  const status = text => { byId('lab-status').textContent = text; };
  function render() {
    const selected = catalog.profiles[profile], rows = checks(catalog, profile);
    byId('profile-name').textContent = selected.name;
    byId('profile-description').textContent = selected.description;
    byId('profile-basis').textContent = selected.basis + ' Reviewed ' + catalog.reviewed_on + '.';
    byId('run-command').textContent = `python /path/to/toolkit/run_tests.py --profile ${profile} --config system.json --system-root /path/to/system --output ${profile}-report.json`;
    document.querySelectorAll('[data-profile]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.profile === profile)));
    const counts = {}, list = byId('checklist'); list.replaceChildren();
    rows.forEach((check, index) => {
      const result = report?.results[index], state = result?.status || (check.kind === 'review' ? 'review_required' : check.kind === 'external' ? 'external_required' : 'not_run');
      counts[state] = (counts[state] || 0) + 1;
      const item = document.createElement('article'); item.className = 'check-row';
      const heading = document.createElement('div'); heading.className = 'check-heading';
      const title = document.createElement('h3'); title.textContent = check.id + ' · ' + check.title;
      const chip = document.createElement('span'); chip.className = 'status-chip ' + state; chip.textContent = labels[state];
      heading.append(title, chip); item.append(heading);
      const procedure = document.createElement('p'); procedure.textContent = check.procedure; item.append(procedure);
      const source = document.createElement('p'); source.className = 'check-source'; source.textContent = check.source + ' · ' + ({identity:'Identity declaration',artifacts:'File hash check',document:'Document hash check',command:'Your test adapter',review:'Manual procedure',external:'External gate'}[check.kind]); item.append(source);
      if (result) { const detail = document.createElement('p'); detail.textContent = result.detail; item.append(detail); }
      const label = document.createElement('label'); label.className = 'review-label'; label.textContent = 'Reviewer notes / evidence reference';
      const input = document.createElement('textarea'); input.maxLength = 2000; input.value = notes[check.id] || ''; input.setAttribute('aria-label', check.title + ' reviewer notes');
      input.addEventListener('input', () => { notes[check.id] = input.value; }); label.append(input); item.append(label); list.append(item);
    });
    const summary = byId('result-summary'); summary.replaceChildren();
    for (const [state, count] of Object.entries(counts)) { const chip = document.createElement('span'); chip.className = 'status-chip ' + state; chip.textContent = count + ' · ' + labels[state]; summary.append(chip); }
    byId('report-identity').textContent = report ? `${report.system.name || 'Unnamed system'} · ${report.system.version || 'Unspecified version'} · source ${report.system.source_commit || 'Unspecified'} · recorded ${report.recorded_at}` : 'No system report imported. Checklist entries are not test results.';
  }
  document.querySelectorAll('[data-profile]').forEach(button => button.addEventListener('click', () => {
    if (!catalog || profile === button.dataset.profile) return;
    ++importGeneration; profile = button.dataset.profile; report = null; notes = Object.create(null); byId('report-file').value = ''; render(); status('Profile changed. Previous report and notes cleared.');
  }));
  byId('clear-report').addEventListener('click', () => { if (!catalog) return; ++importGeneration; report = null; notes = Object.create(null); byId('report-file').value = ''; render(); status('Report and notes cleared.'); });
  let importGeneration = 0;
  byId('report-file').addEventListener('change', async event => {
    const file = event.target.files[0], generation = ++importGeneration;
    if (!catalog || !file) return;
    try {
      if (file.size > 1048576) throw new Error('Report exceeds 1 MiB.');
      const parsed = JSON.parse(await file.text());
      const saved = parsed?.tool === 'forge-test-review' ? validateReview(parsed,catalog,catalogHash) : null;
      const candidate = saved ? saved.runner_report : validateReport(parsed, catalog, catalogHash);
      if (generation !== importGeneration) return;
      profile = saved ? saved.profile : candidate.profile; report = candidate; notes = Object.assign(Object.create(null),saved?.reviewer_notes || {}); render(); status('Imported ' + (saved ? 'saved review' : 'local runner report') + '. Recorded claims remain unverified; review and external gates stay open.');
    } catch (error) { if (generation === importGeneration) status('Report rejected: ' + error.message + ' Existing results retained.'); }
  });
  byId('export-review').addEventListener('click', () => {
    if (!catalog) return;
    const review = {schema_version:1,tool:'forge-test-review',profile,profile_version:catalog.version,catalog_sha256:catalogHash,recorded_at:new Date().toISOString(),certification:false,program_acceptance:false,report_verified:false,runner_report:report,reviewer_notes:notes};
    const url = URL.createObjectURL(new Blob([JSON.stringify(review,null,2)+'\n'], {type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'forge-'+profile+'-review.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('Review downloaded. Notes are self-recorded; it contains no certification.');
  });
  (async () => {
    try {
      const response = await fetch('/system-tests/profiles.json', {cache:'no-cache'});
      if (!response.ok) throw new Error('Profile definitions unavailable.');
      const bytes = await response.arrayBuffer();
      catalog = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
      catalogHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2,'0')).join('');
      if (catalog.schema_version !== 1 || catalog.version !== '1.0.0') throw new Error('Unsupported profile definitions.');
      render(); status('Ready. Choose a profile, download the toolkit, then import your local report.');
    } catch (error) { catalog = null; status('Checklist unavailable. The direct toolkit and instructions above remain available.'); }
  })();
}(globalThis));

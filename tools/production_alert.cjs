'use strict';

// Notification policy only: never changes a run's actual check outcome.
const WORKFLOWS = new Set([
  'Deploy Forge to Cloudflare Pages',
  'Forge + Patterns Production Smoke',
]);
const FAILURES = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

function production(run) {
  return run && WORKFLOWS.has(run.name) && run.head_branch === 'master' &&
    ['push', 'schedule', 'workflow_dispatch'].includes(run.event);
}

function decisive(run) {
  return run.status === 'completed' &&
    (run.conclusion === 'success' || FAILURES.has(run.conclusion));
}

function decide(run, history) {
  if (!production(run) || !decisive(run)) return { send: false, reason: 'Not a completed production result' };
  const peers = history.filter(old => production(old) && decisive(old) &&
    old.workflow_id === run.workflow_id && old.id !== run.id);
  if (peers.some(old => old.run_number > run.run_number)) {
    return { send: false, reason: 'Superseded by a newer completed production run' };
  }
  const previous = peers.filter(old => old.run_number < run.run_number)
    .sort((a, b) => b.run_number - a.run_number)[0];
  if (FAILURES.has(run.conclusion)) {
    if ((run.run_attempt || 1) > 1) return { send: false, reason: 'Repeated failure of the same run' };
    if (previous && FAILURES.has(previous.conclusion)) {
      return { send: false, reason: 'Existing failure streak; included in daily health summary' };
    }
    return { send: true, kind: 'failure', reason: 'New production failure' };
  }
  if (previous && FAILURES.has(previous.conclusion)) {
    return { send: true, kind: 'recovery', reason: 'Production workflow recovered' };
  }
  return { send: false, reason: 'Routine success' };
}

async function prepare({ github, context, core }) {
  const run = context.payload.workflow_run;
  if (!production(run)) {
    core.setOutput('send', 'false');
    return;
  }
  const { data } = await github.rest.actions.listWorkflowRuns({
    ...context.repo, workflow_id: run.workflow_id, branch: 'master',
    status: 'completed', per_page: 100,
  });
  const decision = decide(run, data.workflow_runs);
  core.setOutput('send', String(decision.send));
  await core.summary.addHeading('Production notification policy')
    .addRaw(decision.reason).write();
  if (!decision.send) return;
  core.setOutput('subject', `[UAS production ${decision.kind}] ${run.name}`);
  core.setOutput('body', [
    decision.reason,
    `Workflow: ${run.name}`,
    `Result: ${run.conclusion}`,
    `Run: ${run.html_url}`,
    `Commit: ${run.head_sha}`,
    '',
    run.name === 'Deploy Forge to Cloudflare Pages'
      ? 'This is a deployment result; the previous deployed version may still be serving.'
      : 'This checks the deployed Forge and Patterns trust surfaces.',
    'Repeated failures stay visible in GitHub and the daily health summary.',
  ].join('\n'));
}

module.exports = { production, decide, prepare };

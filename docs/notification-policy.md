# Owner health notifications

Routine GitHub Actions email delivery is disabled in the owner's account under
Settings → Notifications → System → Actions. GitHub delivery remains enabled
for failed workflows. Security notifications use separate settings.

The Forge Intelligence Pipeline keeps its run summary and check conclusion but
does not send routine email for changed data or miner failures. These results
are covered by the `Prismo daily health` ChatGPT automation, delivered in
ChatGPT each morning around 08:00 America/Chicago beginning 2026-10-05. This
automation is separate from GitHub and must be managed in ChatGPT Tasks.

Production emails to the existing owner address are owned by
`.github/workflows/production-notifications.yml`. It observes completed runs
of `Deploy Forge to Cloudflare Pages` and `Forge + Patterns Production Smoke`
on `master`, excluding pull requests. A new failure streak sends one incident
email; subsequent failed runs are quiet. The next successful distinct run
sends one recovery email. Routine successes are quiet. Cancelled/skipped runs
do not reset a failure streak, and newer completed results suppress delayed
obsolete completions. Repeated failed attempts of the same run are quiet.

Policy decisions use the previous completed workflow results, not a durable
SMTP delivery ledger. A successful retry of the same originally failed run
may not produce a recovery email; the daily health summary must use the latest
attempt. Deleted run history or replayed completion events can affect
deduplication. Failed mail delivery is a failed notification workflow, visible
in Actions and included in the daily health summary. Existing `SMTP_USER` and
`SMTP_PASS` secrets are reused without changing recipients or access.

Deployment failures do not prove the previously deployed site is down; smoke
failures identify a failed live check. Build/PR failures remain separate from
production state. The policy changes notifications only and does not disable
tests, change check conclusions, or modify hardware gates.

The privileged `workflow_run` handler checks out only trusted `master` code,
never triggering branch code or artifacts. Permissions are `contents: read`
and `actions: read`. Validate without network, credentials, or email:

```sh
node --test tests/test_production_alert.cjs
```

# Forecast freshness investigation — 2026-10-15

Observed production `/api/data?type=pie_predictions`: 69 retained records, with
59 issuance dates between September 12 and October 2 and ten undated rule-based
records last updated October 14. Publishing the array daily does not issue new
forecasts. Cards were in probability order, without issuance or deadline labels.
A live set below ten records was also replaced by a larger historical archive.

The [October 14 daily run](https://github.com/DroneWuKong/Ai-Project/actions/runs/38557691747)
logged depleted Anthropic credits, depleted Gemini prepayment credits and Groq
HTTP 403 / error 1010. All three synthesis domains returned no predictions.
Existing forecasts were deliberately retained and the workflow completed.
On October 15, run 38728347480 was queued on the self-hosted runner.

The screenshot's Anzu alert had an April 4 claim date and October 14 `last_seen`.
Its own metadata explicitly defines `last_seen` as pipeline emission, not evidence
freshness. The priorities card incorrectly chose that date first.

This change labels issuance, deadline and review state, puts newly issued
forecasts first, preserves any nonempty live set, identifies archive fallback,
separates the alert's claim/source date from indexing, and corrects the probability
label. Long impact and probability notes are expandable to preserve mobile layout.
It does not change forecast probabilities, issuance history or reviewed outcomes.

Validation: 22 focused Node tests, including actual inline-script parsing and
forecast rendering. Chromium rendered all 69 captured production records at
390px with issuance/probability labels and no horizontal overflow. This was a
local renderer harness, not a signed-in production session or a full site build.
The full Pages build was not run: GupB had about 100 MiB free. Source and history
were preserved in a separate sparse worktree based on origin/master efaaa0b.

Related infrastructure diagnosis: GupC had zero allocatable disk space. Its
training worker and Actions runners logged ENOSPC. Training's last status was
October 14 09:16 UTC, WAITING_FOR_CAPACITY / DISK_RESERVE, with the last completed
cycle on October 13. The existing trainer requires 10 GiB free; recovering a small
amount restores heartbeat writes but does not satisfy that capacity gate. No
repositories, historical receipts, model artifacts or checkpoints were deleted.
Gauntlet was observed inactive and was left untouched.

These source changes are prepared for review; production recovery also requires
disk capacity and at least one usable synthesis provider. No billing change or
model request was made during this investigation.

## Approved cache recovery

After the user explicitly approved cache cleanup, removed only the listed
Gradle/npm caches on GupB and Gradle/npm/pip caches on GupC. GupC's trainer and
both Actions runner services recovered automatically. At 17:59 UTC the worker
published a current WAITING_FOR_CAPACITY snapshot (MEMORY_RESERVE / DISK_RESERVE),
the mirror became available, and the unchanged reporter validated its projection.
The trainer checkpoint remained at cycle 6246; no new training progress is claimed.
Forecast synthesis still needs a usable funded provider. The self-hosted daily
run was still queued at this check.

PR #205's Cloudflare Pages preview and full source/built-site audit passed on
GitHub. This is additional build evidence beyond the disk-limited local checks.

# Forge matching learning

The builder's compatible and caution cards expose three explicit judgments:
Useful match, Poor match, and Data issue. Browsing and adding a component never
create a training label. Feedback snapshots contain a hash of the build context,
a hash of the displayed catalog, product ID, category, policy version, position,
compatibility group and bounded features. They exclude build contents, raw text,
account identity and network addresses. The rate-limit bucket is opaque.

`POST /api/autonomy/forge-feedback` accepts same-origin Forge or Patterns feedback
and returns an idempotent event receipt. Reusing an event ID for a different
snapshot is a conflict. Signals are stored as `explicit-unreviewed` in the
existing D1 evidence ledger and retained for 180 days; their dispositions share
that retention. No migration or new signing secret is required.

Reviewer-token-only `GET /api/autonomy/forge-feedback` exports up to 1,000 events
with latest dispositions. `truncated:true` blocks candidate building. Reviewer
`POST /api/autonomy/forge-feedback/<event_id>` supports only
`accept-as-judgment`, `reject-as-noise` and `needs-context`, with required notes.
No feedback endpoint can activate or promote a policy.

The Ai-Project software learning cycle fits bounded matching weights from the
reviewed export and writes minimized, frozen evidence to its private archive.
Compatibility groups and warning-count ordering remain fixed. Matching is
candidate-only until a separate serving adapter, signed promotion chain and
shadow monitoring are implemented and approved. The builder continues to serve
its existing compatibility/weight ranking.

The UAS Portfolio Learning tab consolidates Ask PIE and Forge feedback review.
It requires a server-side reviewer credential; raw feedback is never exposed
by a public status endpoint. Test the D1 integration with
`node --test tests/test_patterns_autonomy.mjs`.

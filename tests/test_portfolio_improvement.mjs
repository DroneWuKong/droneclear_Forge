import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVED_CHAIN_STATES,
  createActivationDecision,
  createRollbackDecision,
  improvementDecisionDigest,
  validateApprovedDecisionChain,
  validateImprovementDecision,
} from '../workers/portfolio-improvement.mjs';
import { canonicalJson, sha256 } from '../workers/retrieval-policy.mjs';

const CANDIDATE_HEX = 'a'.repeat(64);
const MANIFEST_HEX = 'b'.repeat(64);

async function approvedChain(generation = 0) {
  const manifest = {
    candidate_bundle_sha256: CANDIDATE_HEX,
    manifest_sha256: MANIFEST_HEX,
  };
  const decidedAtMs = Date.parse('2026-10-02T00:00:00Z');
  const decisions = APPROVED_CHAIN_STATES.map((state, index) => ({
    schemaVersion: 'patterns.improvement-decision.v1',
    decisionId: `decision:${CANDIDATE_HEX.slice(0, 24)}:${String(index + 1).padStart(2, '0')}:${state}`,
    lane: 'ask-pie-ranking',
    candidateDigest: `sha256:${CANDIDATE_HEX}`,
    evidenceChainDigest: `sha256:${MANIFEST_HEX}`,
    previousState: index === 0 ? null : APPROVED_CHAIN_STATES[index - 1],
    newState: state,
    decidedAtMs,
    automatedGateRefs: index < 2 ? [] : ['gate:protected-evaluator'],
    humanApprovals: state === 'approved' ? [{
      role: 'RELEASE_APPROVER',
      approvalRef: 'approval:ask-pie-1',
      approvedBy: 'release-reviewer-1',
      approvedAtMs: decidedAtMs,
    }] : [],
    permittedSurface: 'forge.ask-pie-ranking',
    autonomyRing: 2,
    activeGeneration: generation,
    rollbackGeneration: null,
    effectiveFromMs: decidedAtMs,
    expiresAtMs: null,
    rationale: `Advance to ${state}`,
    unresolvedObjections: [],
    changesServing: false,
    changesAuthority: false,
    changesHardware: false,
    authorizesAction: false,
  }));
  return {
    manifest,
    chain: {
      schema_version: 'patterns.improvement-decision-chain.v1',
      candidate_digest: `sha256:${CANDIDATE_HEX}`,
      evidence_chain_digest: `sha256:${MANIFEST_HEX}`,
      decisions,
      activation_included: false,
      serving_changes: false,
      changes_authority: false,
      changes_hardware: false,
      authorizes_action: false,
      chain_digest: `sha256:${await sha256(canonicalJson(decisions))}`,
    },
  };
}

test('Forge independently validates the complete approved-not-active decision chain', async () => {
  const { manifest, chain } = await approvedChain(3);
  const validated = await validateApprovedDecisionChain(chain, manifest, 3);
  assert.equal(validated.approvedDecision.newState, 'approved');
  assert.equal(validated.chainDigest, chain.chain_digest);
  assert.equal(validated.candidateDigest, chain.candidate_digest);
  assert.match(await improvementDecisionDigest(validated.approvedDecision), /^sha256:[0-9a-f]{64}$/);
});

test('admission rejects missing stages, manifest mismatch and authority drift', async () => {
  const { manifest, chain } = await approvedChain();
  const incomplete = structuredClone(chain);
  incomplete.decisions.splice(5, 1);
  incomplete.chain_digest = `sha256:${await sha256(canonicalJson(incomplete.decisions))}`;
  await assert.rejects(validateApprovedDecisionChain(incomplete, manifest, 0), /incomplete/);
  const mismatch = structuredClone(chain);
  mismatch.evidence_chain_digest = `sha256:${'c'.repeat(64)}`;
  await assert.rejects(validateApprovedDecisionChain(mismatch, manifest, 0), /does not match/);
  const unsafe = structuredClone(chain.decisions[0]);
  unsafe.changesAuthority = true;
  assert.throws(() => validateImprovementDecision(unsafe), /non-authorizing boundary/);
});

test('activation and rollback decisions remain generation checked and non-authorizing', async () => {
  const { manifest, chain } = await approvedChain(2);
  const { approvedDecision } = await validateApprovedDecisionChain(chain, manifest, 2);
  const active = createActivationDecision({
    approvedDecision,
    expectedGeneration: 2,
    nowMs: Date.parse('2026-10-02T01:00:00Z'),
    notes: 'Release reviewer activated the signed candidate after shadow was disabled.',
  });
  assert.equal(active.newState, 'active');
  assert.equal(active.activeGeneration, 3);
  assert.equal(active.rollbackGeneration, 2);
  assert.equal(active.changesServing, true);
  assert.equal(active.changesAuthority, false);
  assert.equal(active.authorizesAction, false);
  assert.throws(() => createRollbackDecision({
    activeDecision: active,
    expectedGeneration: 2,
    nowMs: Date.parse('2026-10-02T02:00:00Z'),
    notes: 'Stale rollback.',
  }), /generation is stale/);
  const rollback = createRollbackDecision({
    activeDecision: active,
    expectedGeneration: 3,
    nowMs: Date.parse('2026-10-02T02:00:00Z'),
    notes: 'Rollback to the deterministic incumbent after a hard-gate breach.',
    monitorEvidenceRef: 'monitor:hard-gate-1',
  });
  assert.equal(rollback.previousState, 'active');
  assert.equal(rollback.newState, 'rolled-back');
  assert.equal(rollback.activeGeneration, 4);
  assert.equal(rollback.changesServing, true);
  assert.equal(rollback.changesHardware, false);
});

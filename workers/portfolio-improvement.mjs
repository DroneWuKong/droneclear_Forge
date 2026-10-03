import { canonicalJson, sha256 } from './retrieval-policy.mjs';

export const IMPROVEMENT_DECISION_SCHEMA = 'patterns.improvement-decision.v1';
export const IMPROVEMENT_STATES = Object.freeze([
  'observed', 'admitted', 'experiment-registered', 'candidate-built',
  'sandbox-passed', 'evaluator-passed', 'holdout-passed',
  'registered-shadow-only', 'shadowing', 'promotion-proposed', 'approved',
  'rejected', 'quarantined', 'active', 'monitored', 'superseded', 'rolled-back',
]);
export const APPROVED_CHAIN_STATES = Object.freeze([
  'observed', 'admitted', 'experiment-registered', 'candidate-built',
  'sandbox-passed', 'evaluator-passed', 'holdout-passed',
  'registered-shadow-only', 'shadowing', 'promotion-proposed', 'approved',
]);

const DECISION_FIELDS = Object.freeze([
  'schemaVersion', 'decisionId', 'lane', 'candidateDigest', 'evidenceChainDigest',
  'previousState', 'newState', 'decidedAtMs', 'automatedGateRefs', 'humanApprovals',
  'permittedSurface', 'autonomyRing', 'activeGeneration', 'rollbackGeneration',
  'effectiveFromMs', 'expiresAtMs', 'rationale', 'unresolvedObjections',
  'changesServing', 'changesAuthority', 'changesHardware', 'authorizesAction',
]);
const APPROVAL_FIELDS = Object.freeze(['role', 'approvalRef', 'approvedBy', 'approvedAtMs']);
const CHAIN_FIELDS = Object.freeze([
  'schema_version', 'candidate_digest', 'evidence_chain_digest', 'decisions',
  'activation_included', 'serving_changes', 'changes_authority',
  'changes_hardware', 'authorizes_action', 'chain_digest',
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const APPROVAL_ROLES = new Set([
  'ANALYST', 'MAINTAINER', 'RELEASE_APPROVER', 'OPERATOR', 'SECURITY_REVIEWER',
]);
const ALLOWED = new Map([
  [null, new Set(['observed'])],
  ['observed', new Set(['admitted', 'rejected', 'quarantined'])],
  ['admitted', new Set(['experiment-registered', 'rejected', 'quarantined'])],
  ['experiment-registered', new Set(['candidate-built', 'rejected', 'quarantined'])],
  ['candidate-built', new Set(['sandbox-passed', 'rejected', 'quarantined'])],
  ['sandbox-passed', new Set(['evaluator-passed', 'rejected', 'quarantined'])],
  ['evaluator-passed', new Set(['holdout-passed', 'rejected', 'quarantined'])],
  ['holdout-passed', new Set(['registered-shadow-only', 'rejected', 'quarantined'])],
  ['registered-shadow-only', new Set(['shadowing', 'rejected', 'quarantined'])],
  ['shadowing', new Set(['promotion-proposed', 'rejected', 'quarantined'])],
  ['promotion-proposed', new Set(['approved', 'rejected', 'quarantined'])],
  ['approved', new Set(['active', 'rejected', 'quarantined'])],
  ['active', new Set(['monitored', 'superseded', 'rolled-back', 'quarantined'])],
  ['monitored', new Set(['superseded', 'rolled-back', 'quarantined'])],
  ['rejected', new Set()], ['quarantined', new Set()],
  ['superseded', new Set()], ['rolled-back', new Set()],
]);

function exactKeys(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

function identifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} is invalid`);
  return value;
}

function stringList(value, label) {
  if (!Array.isArray(value) || value.length > 1024
    || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 4096)
    || new Set(value).size !== value.length) throw new Error(`${label} are invalid`);
  return [...value].sort();
}

export function validateImprovementDecision(value) {
  exactKeys(value, DECISION_FIELDS, 'Improvement decision');
  if (value.schemaVersion !== IMPROVEMENT_DECISION_SCHEMA) throw new Error('Unsupported improvement decision schema');
  if (value.changesAuthority !== false || value.changesHardware !== false || value.authorizesAction !== false) {
    throw new Error('Improvement decision violates the non-authorizing boundary');
  }
  const previous = value.previousState;
  const next = value.newState;
  if (previous !== null && !IMPROVEMENT_STATES.includes(previous)) throw new Error('Previous improvement state is unsupported');
  if (!IMPROVEMENT_STATES.includes(next)) throw new Error('New improvement state is unsupported');
  if (!ALLOWED.get(previous)?.has(next)) throw new Error(`Invalid improvement transition ${String(previous)} -> ${next}`);
  identifier(value.decisionId, 'Improvement decision id');
  identifier(value.lane, 'Improvement lane');
  digest(value.candidateDigest, 'Improvement candidate digest');
  digest(value.evidenceChainDigest, 'Improvement evidence-chain digest');
  identifier(value.permittedSurface, 'Improvement permitted surface');
  const decidedAtMs = integer(value.decidedAtMs, 'Improvement decision time');
  const effectiveFromMs = integer(value.effectiveFromMs, 'Improvement effective time');
  if (effectiveFromMs < decidedAtMs) throw new Error('Improvement cannot become effective before its decision');
  if (value.expiresAtMs !== null && integer(value.expiresAtMs, 'Improvement expiry time') <= effectiveFromMs) {
    throw new Error('Improvement expiry must follow its effective time');
  }
  const ring = integer(value.autonomyRing, 'Improvement autonomy ring');
  if (ring > 5) throw new Error('Improvement autonomy ring is unsupported');
  integer(value.activeGeneration, 'Improvement active generation');
  if (value.rollbackGeneration !== null) integer(value.rollbackGeneration, 'Improvement rollback generation');
  stringList(value.automatedGateRefs, 'Improvement automated gate references');
  const objections = stringList(value.unresolvedObjections, 'Improvement unresolved objections');
  if (typeof value.rationale !== 'string' || !value.rationale.trim() || value.rationale.length > 4096) {
    throw new Error('Improvement rationale is invalid');
  }
  if (typeof value.changesServing !== 'boolean') throw new Error('Improvement serving-change flag is invalid');
  if (['active', 'rolled-back', 'superseded'].includes(next)) {
    if (!value.changesServing) throw new Error('Serving transition must declare a serving change');
  } else if (value.changesServing) throw new Error('Non-serving transition cannot change serving');
  if (!Array.isArray(value.humanApprovals) || value.humanApprovals.length > 32) {
    throw new Error('Improvement human approvals are invalid');
  }
  const approvalKeys = [];
  for (const approval of value.humanApprovals) {
    exactKeys(approval, APPROVAL_FIELDS, 'Improvement approval');
    if (!APPROVAL_ROLES.has(approval.role)) throw new Error('Improvement approval role is unsupported');
    identifier(approval.approvalRef, 'Improvement approval reference');
    identifier(approval.approvedBy, 'Improvement approver');
    if (integer(approval.approvedAtMs, 'Improvement approval time') > decidedAtMs) {
      throw new Error('Improvement approval follows the decision');
    }
    approvalKeys.push(`${approval.role}:${approval.approvalRef}`);
  }
  if (new Set(approvalKeys).size !== approvalKeys.length) throw new Error('Improvement approvals must be unique');
  const releaseApproved = value.humanApprovals.some(approval => approval.role === 'RELEASE_APPROVER');
  if (next === 'approved' && ring >= 2 && !releaseApproved) {
    throw new Error('Higher-ring improvement approval requires a release approver');
  }
  if (next === 'active' && !releaseApproved) throw new Error('Improvement activation requires release approval');
  if (objections.length && ['approved', 'active'].includes(next)) {
    throw new Error('Improvement with unresolved objections cannot be approved or activated');
  }
  return structuredClone(value);
}

export async function improvementDecisionDigest(value) {
  return `sha256:${await sha256(canonicalJson(validateImprovementDecision(value)))}`;
}

export async function validateApprovedDecisionChain(chain, manifest, currentGeneration) {
  exactKeys(chain, CHAIN_FIELDS, 'Improvement decision chain');
  if (chain.schema_version !== 'patterns.improvement-decision-chain.v1') {
    throw new Error('Unsupported improvement decision chain');
  }
  if (chain.activation_included !== false || chain.serving_changes !== false
    || chain.changes_authority !== false || chain.changes_hardware !== false
    || chain.authorizes_action !== false) {
    throw new Error('Improvement decision chain violates the approved-not-active boundary');
  }
  const candidateDigest = `sha256:${manifest.candidate_bundle_sha256}`;
  const evidenceChainDigest = `sha256:${manifest.manifest_sha256}`;
  if (chain.candidate_digest !== candidateDigest || chain.evidence_chain_digest !== evidenceChainDigest) {
    throw new Error('Improvement decision chain does not match the signed manifest');
  }
  if (!Array.isArray(chain.decisions) || chain.decisions.length !== APPROVED_CHAIN_STATES.length) {
    throw new Error('Improvement decision chain is incomplete');
  }
  let previous = null;
  const decisionIds = new Set();
  for (const [index, decision] of chain.decisions.entries()) {
    validateImprovementDecision(decision);
    if (decisionIds.has(decision.decisionId)) throw new Error('Improvement decision ids must be unique');
    decisionIds.add(decision.decisionId);
    if (decision.previousState !== previous || decision.newState !== APPROVED_CHAIN_STATES[index]
      || decision.candidateDigest !== candidateDigest || decision.evidenceChainDigest !== evidenceChainDigest
      || decision.lane !== 'ask-pie-ranking' || decision.permittedSurface !== 'forge.ask-pie-ranking'
      || decision.autonomyRing !== 2 || decision.activeGeneration !== currentGeneration
      || decision.changesServing !== false) {
      throw new Error('Improvement decision chain contains inconsistent lifecycle evidence');
    }
    previous = decision.newState;
  }
  const chainDigest = `sha256:${await sha256(canonicalJson(chain.decisions))}`;
  if (chain.chain_digest !== chainDigest) throw new Error('Improvement decision chain digest mismatch');
  return {
    chain: structuredClone(chain),
    approvedDecision: structuredClone(chain.decisions.at(-1)),
    chainDigest,
    candidateDigest,
    evidenceChainDigest,
  };
}

function boundedNotes(notes) {
  const value = String(notes || '').trim();
  if (!value || value.length > 5000) throw new Error('Improvement transition notes are invalid');
  return value;
}

export function createActivationDecision(input) {
  const approved = validateImprovementDecision(input.approvedDecision);
  if (approved.newState !== 'approved') throw new Error('Activation requires an approved improvement decision');
  const generation = integer(input.expectedGeneration, 'Expected active generation');
  const nowMs = integer(input.nowMs, 'Activation decision time');
  const decision = {
    ...approved,
    decisionId: `decision:${approved.candidateDigest.slice(7, 31)}:active:g${generation + 1}`,
    previousState: 'approved',
    newState: 'active',
    decidedAtMs: nowMs,
    automatedGateRefs: [...new Set([
      ...approved.automatedGateRefs,
      `manifest:${approved.evidenceChainDigest}`,
      `active-generation:${generation}`,
      'shadow-disabled:forge.ask-pie-ranking',
    ])].sort(),
    activeGeneration: generation + 1,
    rollbackGeneration: generation,
    effectiveFromMs: nowMs,
    rationale: boundedNotes(input.notes),
    changesServing: true,
  };
  return validateImprovementDecision(decision);
}

export function createRollbackDecision(input) {
  const active = validateImprovementDecision(input.activeDecision);
  if (!['active', 'monitored'].includes(active.newState)) throw new Error('Rollback requires an active or monitored decision');
  const generation = integer(input.expectedGeneration, 'Expected active generation', 1);
  if (active.activeGeneration !== generation) throw new Error('Rollback decision generation is stale');
  const nowMs = integer(input.nowMs, 'Rollback decision time');
  const decision = {
    ...active,
    decisionId: `decision:${active.candidateDigest.slice(7, 31)}:rolled-back:g${generation + 1}`,
    previousState: active.newState,
    newState: 'rolled-back',
    decidedAtMs: nowMs,
    automatedGateRefs: [...new Set([
      ...active.automatedGateRefs,
      `rollback-from-generation:${generation}`,
      ...(input.monitorEvidenceRef ? [identifier(input.monitorEvidenceRef, 'Monitor evidence reference')] : []),
    ])].sort(),
    activeGeneration: generation + 1,
    rollbackGeneration: generation,
    effectiveFromMs: nowMs,
    rationale: boundedNotes(input.notes),
    changesServing: true,
  };
  return validateImprovementDecision(decision);
}

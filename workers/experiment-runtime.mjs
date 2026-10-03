/*
 * Portfolio experiment OS: prospective contracts, deny-by-default candidate
 * broker, independent evaluator council, and append-only D1 persistence.
 *
 * This module does not deploy, activate, publish, command hardware, read
 * secrets, or grant authority. A production broker may wrap Cloudflare Sandbox,
 * but must preserve the exact capability and output checks below.
 */
import { canonicalJson, sha256 } from './retrieval-policy.mjs';

export const EXPERIMENT_SCHEMA = 'patterns.improvement-experiment.v1';
export const CANDIDATE_SCHEMA = 'patterns.improvement-candidate.v1';
export const EVALUATION_SCHEMA = 'patterns.improvement-evaluation.v1';
export const INCIDENT_SCHEMA = 'patterns.improvement-incident.v1';
export const SERVING_RECEIPT_SCHEMA = 'patterns.improvement-serving-receipt.v1';

export const ALLOWED_CANDIDATE_CAPABILITIES = Object.freeze([
  'READ_INPUT_ARTIFACTS', 'WRITE_CANDIDATE_ARTIFACT', 'EXECUTE_EPHEMERAL',
]);
export const FORBIDDEN_CANDIDATE_CAPABILITIES = Object.freeze([
  'AUTHORITY', 'COMMAND', 'DEPLOY', 'EVALUATOR_WRITE', 'HOLDOUT_READ',
  'NETWORK_UNDECLARED', 'PERSISTENT_STORAGE', 'PROMOTE', 'SECRETS', 'VEHICLE',
]);

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const APPROVER_ROLES = new Set(['ANALYST', 'MAINTAINER', 'RELEASE_APPROVER', 'SECURITY_REVIEWER']);
const ARTIFACT_KINDS = new Set(['CODE', 'POLICY', 'MODEL', 'DATA', 'CONFIGURATION', 'EVALUATOR']);
const PROMOTION_CLASSES = new Set(['SHADOW_ONLY', 'HUMAN_APPROVED_ACTIVATION']);
const INCIDENT_TYPES = new Set([
  'REWARD_HACKING', 'EVALUATOR_TAMPERING', 'PROVENANCE_FAILURE', 'SECRET_ACCESS',
  'CAPABILITY_VIOLATION', 'DATA_LEAKAGE', 'UNEXPLAINED_GAIN', 'MONITOR_EVASION',
  'UNSAFE_OUTPUT', 'DUPLICATE_SIDE_EFFECT', 'PRODUCTION_REGRESSION', 'ROLLBACK',
]);

const EXPERIMENT_FIELDS = [
  'schemaVersion', 'experimentId', 'lane', 'registeredAtMs', 'baselineDigest', 'candidateParentDigests',
  'mutationEnvelope', 'requestedCapabilities', 'trainingCutoffMs', 'replayCutoffMs', 'holdoutCutoffMs',
  'primaryMetric', 'protectedMetrics', 'sliceDefinitions', 'minimumSampleSize', 'minimumDurationMs',
  'uncertaintyRule', 'budget', 'safetyInvariants', 'automaticStopConditions', 'promotionClass',
  'requiredApproverRoles', 'rollbackTargetDigest', 'evaluatorDigests', 'toolchainDigest', 'datasetDigests',
  'changesAuthority', 'changesHardware', 'authorizesAction',
];
const CANDIDATE_FIELDS = [
  'schemaVersion', 'candidateId', 'experimentId', 'parentDigests', 'candidateDigest', 'artifactDigests',
  'declaredChange', 'expectedBenefit', 'requestedCapabilities', 'prohibitedCapabilities', 'builderIdentity',
  'buildProvenanceDigest', 'reproducibility', 'compatibleInputSchema', 'compatibleOutputSchema',
  'knownLimitations', 'fallbackDigest', 'changesServing', 'changesAuthority', 'changesHardware', 'authorizesAction',
];
const EVALUATION_FIELDS = [
  'schemaVersion', 'evaluationId', 'experimentId', 'candidateDigest', 'evaluatorId', 'evaluatorDigest',
  'datasetSnapshotDigest', 'holdoutHandle', 'windowStartMs', 'windowEndMs', 'observedAtMs', 'sampleSize',
  'baselinePrimaryValue', 'candidatePrimaryValue',
  'protectedMetricRegressions', 'sliceResults', 'resourceUse', 'suspiciousFindings', 'uncertainty',
  'replayable', 'passed', 'changesServing', 'changesAuthority', 'changesHardware', 'authorizesAction',
];

const exact = (value, fields, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== [...fields].sort().join('|')) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
};
const identifier = (value, label) => {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`${label} is invalid`);
  return value;
};
const digest = (value, label) => {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${label} is invalid`);
  return value;
};
const integer = (value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} is invalid`);
  return value;
};
const finite = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is invalid`);
  return value;
};
const text = (value, label, maximum = 4096) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`${label} is invalid`);
  return value.trim();
};
const list = (value, label, parser = text, minimum = 0, maximum = 1024) => {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(`${label} are invalid`);
  const parsed = value.map(item => parser(item, label));
  if (new Set(parsed).size !== parsed.length) throw new Error(`${label} must be unique`);
  return parsed;
};
const authorityBoundary = (value, label) => {
  if (value.changesAuthority !== false || value.changesHardware !== false || value.authorizesAction !== false) {
    throw new Error(`${label} violates the non-authorizing boundary`);
  }
};
const canonicalDigest = async value => `sha256:${await sha256(canonicalJson(value))}`;

export function validateExperiment(value) {
  exact(value, EXPERIMENT_FIELDS, 'improvement experiment');
  if (value.schemaVersion !== EXPERIMENT_SCHEMA) throw new Error('unsupported improvement experiment schema');
  authorityBoundary(value, 'improvement experiment');
  exact(value.mutationEnvelope, ['allowedArtifactKinds', 'maximumCandidates', 'maximumWallTimeMs'], 'mutation envelope');
  const allowedArtifactKinds = list(value.mutationEnvelope.allowedArtifactKinds, 'allowed artifact kinds', identifier, 1, 6);
  if (allowedArtifactKinds.some(kind => !ARTIFACT_KINDS.has(kind))) throw new Error('mutation artifact kind is unsupported');
  const requestedCapabilities = list(value.requestedCapabilities, 'requested capabilities', identifier, 1, 16);
  if (requestedCapabilities.some(capability => !ALLOWED_CANDIDATE_CAPABILITIES.includes(capability))) {
    throw new Error('experiment requested a forbidden candidate capability');
  }
  const registeredAtMs = integer(value.registeredAtMs, 'experiment registration time');
  const trainingCutoffMs = integer(value.trainingCutoffMs, 'training cutoff');
  const replayCutoffMs = integer(value.replayCutoffMs, 'replay cutoff');
  const holdoutCutoffMs = integer(value.holdoutCutoffMs, 'holdout cutoff');
  if (!(trainingCutoffMs <= replayCutoffMs && replayCutoffMs < holdoutCutoffMs)) {
    throw new Error('experiment cutoff order is invalid');
  }
  if (holdoutCutoffMs > registeredAtMs) throw new Error('experiment must be registered after its data cutoffs are frozen');
  exact(value.primaryMetric, ['name', 'direction', 'minimumImprovement'], 'primary metric');
  if (!['MAXIMIZE', 'MINIMIZE'].includes(value.primaryMetric.direction)) throw new Error('primary metric direction is unsupported');
  const protectedMetrics = value.protectedMetrics;
  if (!Array.isArray(protectedMetrics) || protectedMetrics.length < 1 || protectedMetrics.length > 64) {
    throw new Error('protected metrics are invalid');
  }
  const parsedProtected = protectedMetrics.map(metric => {
    exact(metric, ['name', 'maximumRegression'], 'protected metric');
    return {name:identifier(metric.name, 'protected metric name'), maximumRegression:finite(metric.maximumRegression, 'protected metric regression')};
  });
  if (new Set(parsedProtected.map(metric => metric.name)).size !== parsedProtected.length) throw new Error('protected metrics must be unique');
  exact(value.budget, ['maxCpuMs', 'maxMemoryMb', 'maxCostUnits', 'maxNetworkRequests'], 'experiment budget');
  if (integer(value.budget.maxNetworkRequests, 'network request budget') !== 0) throw new Error('candidate network access is disabled');
  const requiredApproverRoles = list(value.requiredApproverRoles, 'required approver roles', identifier, 1, 8);
  if (requiredApproverRoles.some(role => !APPROVER_ROLES.has(role))) throw new Error('required approver role is unsupported');
  if (value.promotionClass === 'HUMAN_APPROVED_ACTIVATION' && !requiredApproverRoles.includes('RELEASE_APPROVER')) {
    throw new Error('activation-class experiment requires a release approver');
  }
  if (!PROMOTION_CLASSES.has(value.promotionClass)) throw new Error('promotion class is unsupported');
  const parsed = {
    schemaVersion:EXPERIMENT_SCHEMA,
    experimentId:identifier(value.experimentId, 'experiment id'), lane:identifier(value.lane, 'experiment lane'),
    registeredAtMs,
    baselineDigest:digest(value.baselineDigest, 'baseline digest'),
    candidateParentDigests:list(value.candidateParentDigests, 'candidate parent digests', digest, 1, 64),
    mutationEnvelope:{allowedArtifactKinds, maximumCandidates:integer(value.mutationEnvelope.maximumCandidates, 'maximum candidates', 1, 1024),
      maximumWallTimeMs:integer(value.mutationEnvelope.maximumWallTimeMs, 'maximum wall time', 1, 86_400_000)},
    requestedCapabilities, trainingCutoffMs, replayCutoffMs, holdoutCutoffMs,
    primaryMetric:{name:identifier(value.primaryMetric.name, 'primary metric name'), direction:value.primaryMetric.direction,
      minimumImprovement:finite(value.primaryMetric.minimumImprovement, 'minimum primary improvement')},
    protectedMetrics:parsedProtected, sliceDefinitions:list(value.sliceDefinitions, 'slice definitions', identifier, 1, 128),
    minimumSampleSize:integer(value.minimumSampleSize, 'minimum sample size', 1),
    minimumDurationMs:integer(value.minimumDurationMs, 'minimum experiment duration', 1),
    uncertaintyRule:text(value.uncertaintyRule, 'uncertainty rule'),
    budget:{maxCpuMs:integer(value.budget.maxCpuMs, 'CPU budget', 1), maxMemoryMb:integer(value.budget.maxMemoryMb, 'memory budget', 1, 4096),
      maxCostUnits:integer(value.budget.maxCostUnits, 'cost budget', 0), maxNetworkRequests:0},
    safetyInvariants:list(value.safetyInvariants, 'safety invariants', text, 1, 128),
    automaticStopConditions:list(value.automaticStopConditions, 'automatic stop conditions', text, 1, 128),
    promotionClass:value.promotionClass, requiredApproverRoles,
    rollbackTargetDigest:digest(value.rollbackTargetDigest, 'rollback target digest'),
    evaluatorDigests:list(value.evaluatorDigests, 'evaluator digests', digest, 2, 32),
    toolchainDigest:digest(value.toolchainDigest, 'toolchain digest'),
    datasetDigests:list(value.datasetDigests, 'dataset digests', digest, 2, 128),
    changesAuthority:false, changesHardware:false, authorizesAction:false,
  };
  return structuredClone(parsed);
}

export function validateCandidate(value, experimentValue) {
  exact(value, CANDIDATE_FIELDS, 'improvement candidate');
  if (value.schemaVersion !== CANDIDATE_SCHEMA) throw new Error('unsupported improvement candidate schema');
  authorityBoundary(value, 'improvement candidate');
  if (value.changesServing !== false) throw new Error('candidate cannot change serving');
  const experiment = validateExperiment(experimentValue);
  if (value.experimentId !== experiment.experimentId) throw new Error('candidate is bound to another experiment');
  const parentDigests = list(value.parentDigests, 'candidate parent digests', digest, 1, 64);
  if (canonicalJson([...parentDigests].sort()) !== canonicalJson([...experiment.candidateParentDigests].sort())) {
    throw new Error('candidate parent lineage does not match the experiment');
  }
  const requestedCapabilities = list(value.requestedCapabilities, 'candidate capabilities', identifier, 1, 16);
  if (requestedCapabilities.some(capability => !experiment.requestedCapabilities.includes(capability))) {
    throw new Error('candidate requested an undeclared capability');
  }
  const prohibitedCapabilities = list(value.prohibitedCapabilities, 'prohibited capabilities', identifier, 1, 32).sort();
  if (canonicalJson(prohibitedCapabilities) !== canonicalJson([...FORBIDDEN_CANDIDATE_CAPABILITIES].sort())) {
    throw new Error('candidate prohibited-capability manifest is incomplete');
  }
  if (value.fallbackDigest !== experiment.rollbackTargetDigest) throw new Error('candidate fallback does not match the experiment rollback target');
  return structuredClone({schemaVersion:CANDIDATE_SCHEMA, candidateId:identifier(value.candidateId, 'candidate id'),
    experimentId:value.experimentId, parentDigests,
    candidateDigest:digest(value.candidateDigest, 'candidate digest'),
    artifactDigests:list(value.artifactDigests, 'candidate artifact digests', digest, 1, 256),
    declaredChange:text(value.declaredChange, 'declared candidate change'), expectedBenefit:text(value.expectedBenefit, 'expected candidate benefit'),
    requestedCapabilities, prohibitedCapabilities, builderIdentity:identifier(value.builderIdentity, 'candidate builder identity'),
    buildProvenanceDigest:digest(value.buildProvenanceDigest, 'build provenance digest'),
    reproducibility:value.reproducibility === 'MATCHED' || value.reproducibility === 'NOT_REQUIRED' ? value.reproducibility : (() => { throw new Error('candidate reproducibility is unsupported'); })(),
    compatibleInputSchema:identifier(value.compatibleInputSchema, 'candidate input schema'),
    compatibleOutputSchema:identifier(value.compatibleOutputSchema, 'candidate output schema'),
    knownLimitations:list(value.knownLimitations, 'candidate limitations', text, 1, 64),
    fallbackDigest:digest(value.fallbackDigest, 'candidate fallback digest'), changesServing:false,
    changesAuthority:false, changesHardware:false, authorizesAction:false});
}

export function validateEvaluation(value, experimentValue, candidateValue) {
  exact(value, EVALUATION_FIELDS, 'improvement evaluation');
  if (value.schemaVersion !== EVALUATION_SCHEMA) throw new Error('unsupported improvement evaluation schema');
  authorityBoundary(value, 'improvement evaluation');
  if (value.changesServing !== false) throw new Error('evaluation cannot change serving');
  const experiment = validateExperiment(experimentValue), candidate = validateCandidate(candidateValue, experiment);
  if (value.experimentId !== experiment.experimentId || value.candidateDigest !== candidate.candidateDigest) {
    throw new Error('evaluation is bound to another experiment or candidate');
  }
  if (value.evaluatorId === candidate.builderIdentity) throw new Error('candidate builder cannot evaluate its own candidate');
  const evaluatorDigest = digest(value.evaluatorDigest, 'evaluator digest');
  if (!experiment.evaluatorDigests.includes(evaluatorDigest)) throw new Error('evaluation used an unregistered evaluator');
  const windowStartMs = integer(value.windowStartMs, 'evaluation window start');
  const windowEndMs = integer(value.windowEndMs, 'evaluation window end');
  if (windowEndMs < windowStartMs || windowEndMs - windowStartMs < experiment.minimumDurationMs) {
    throw new Error('evaluation duration is below the experiment minimum');
  }
  const sampleSize = integer(value.sampleSize, 'evaluation sample size');
  if (sampleSize < experiment.minimumSampleSize) throw new Error('evaluation sample is below the experiment minimum');
  if (!Array.isArray(value.sliceResults) || value.sliceResults.length < experiment.sliceDefinitions.length) throw new Error('evaluation slice coverage is incomplete');
  const sliceResults = value.sliceResults.map(slice => {
    exact(slice, ['sliceId', 'sampleSize', 'primaryDelta', 'passed'], 'evaluation slice');
    if (typeof slice.passed !== 'boolean') throw new Error('evaluation slice pass flag is invalid');
    return {sliceId:identifier(slice.sliceId, 'evaluation slice id'), sampleSize:integer(slice.sampleSize, 'evaluation slice sample size'),
      primaryDelta:finite(slice.primaryDelta, 'evaluation slice primary delta'), passed:slice.passed === true};
  });
  if (new Set(sliceResults.map(slice => slice.sliceId)).size !== sliceResults.length
    || experiment.sliceDefinitions.some(slice => !sliceResults.some(result => result.sliceId === slice))) throw new Error('evaluation slice coverage is incomplete');
  exact(value.resourceUse, ['cpuMs', 'peakMemoryMb', 'costUnits', 'networkRequests'], 'evaluation resource use');
  if (integer(value.resourceUse.networkRequests, 'evaluation network use') !== 0) throw new Error('candidate used network access');
  const protectedMetricRegressions = value.protectedMetricRegressions;
  if (!Array.isArray(protectedMetricRegressions) || protectedMetricRegressions.length !== experiment.protectedMetrics.length) {
    throw new Error('protected metric evaluation is incomplete');
  }
  const parsedProtected = protectedMetricRegressions.map(metric => {
    exact(metric, ['name', 'regression', 'passed'], 'protected metric result');
    if (typeof metric.passed !== 'boolean') throw new Error('protected metric pass flag is invalid');
    const name = identifier(metric.name, 'protected metric result name');
    const regression = finite(metric.regression, 'protected metric regression');
    const contract = experiment.protectedMetrics.find(item => item.name === name);
    if (!contract) throw new Error('protected metric result is undeclared');
    if (metric.passed !== (regression <= contract.maximumRegression)) throw new Error('protected metric pass flag disagrees with its gate');
    return {name, regression, passed:metric.passed};
  });
  if (new Set(parsedProtected.map(metric => metric.name)).size !== parsedProtected.length
    || experiment.protectedMetrics.some(metric => !parsedProtected.some(result => result.name === metric.name))) {
    throw new Error('protected metric evaluation is incomplete');
  }
  const datasetSnapshotDigest = digest(value.datasetSnapshotDigest, 'evaluation dataset digest');
  if (!experiment.datasetDigests.includes(datasetSnapshotDigest)) throw new Error('evaluation used an unregistered dataset snapshot');
  const observedAtMs = integer(value.observedAtMs, 'evaluation time');
  if (observedAtMs < windowEndMs) throw new Error('evaluation time precedes its evidence window');
  if (typeof value.replayable !== 'boolean' || typeof value.passed !== 'boolean') throw new Error('evaluation gate flags are invalid');
  const parsed = structuredClone({...value,
    evaluationId:identifier(value.evaluationId, 'evaluation id'), evaluatorId:identifier(value.evaluatorId, 'evaluator id'), evaluatorDigest,
    datasetSnapshotDigest, holdoutHandle:identifier(value.holdoutHandle, 'evaluation holdout handle'),
    windowStartMs, windowEndMs, observedAtMs, sampleSize,
    baselinePrimaryValue:finite(value.baselinePrimaryValue, 'baseline primary value'), candidatePrimaryValue:finite(value.candidatePrimaryValue, 'candidate primary value'),
    protectedMetricRegressions:parsedProtected,
    sliceResults, resourceUse:{cpuMs:integer(value.resourceUse.cpuMs, 'evaluation CPU use'), peakMemoryMb:integer(value.resourceUse.peakMemoryMb, 'evaluation memory use'), costUnits:integer(value.resourceUse.costUnits, 'evaluation cost use'), networkRequests:0},
    suspiciousFindings:list(value.suspiciousFindings, 'suspicious findings', text, 0, 128), uncertainty:text(value.uncertainty, 'evaluation uncertainty'),
    replayable:value.replayable === true, passed:value.passed === true, changesServing:false, changesAuthority:false, changesHardware:false, authorizesAction:false});
  const withinBudget = parsed.resourceUse.cpuMs <= experiment.budget.maxCpuMs
    && parsed.resourceUse.peakMemoryMb <= experiment.budget.maxMemoryMb
    && parsed.resourceUse.costUnits <= experiment.budget.maxCostUnits;
  const expectedPassed = parsed.replayable && parsed.suspiciousFindings.length === 0 && withinBudget
    && parsed.protectedMetricRegressions.every(metric => metric.passed) && parsed.sliceResults.every(slice => slice.passed)
    && (experiment.primaryMetric.direction === 'MAXIMIZE'
      ? parsed.candidatePrimaryValue - parsed.baselinePrimaryValue >= experiment.primaryMetric.minimumImprovement
      : parsed.baselinePrimaryValue - parsed.candidatePrimaryValue >= experiment.primaryMetric.minimumImprovement);
  if (parsed.passed !== expectedPassed) throw new Error('evaluation pass flag disagrees with declared gates');
  return parsed;
}

export async function evaluateCouncil(experimentValue, candidateValue, evaluationValues) {
  const experiment = validateExperiment(experimentValue), candidate = validateCandidate(candidateValue, experiment);
  if (!Array.isArray(evaluationValues) || evaluationValues.length < 2) throw new Error('evaluator council requires at least two independent results');
  const evaluations = evaluationValues.map(value => validateEvaluation(value, experiment, candidate));
  if (new Set(evaluations.map(value => value.evaluatorId)).size !== evaluations.length
    || new Set(evaluations.map(value => value.evaluatorDigest)).size < 2) throw new Error('evaluator council is not independent');
  return {schemaVersion:'patterns.improvement-evaluator-council.v1', experimentId:experiment.experimentId,
    candidateDigest:candidate.candidateDigest, evaluationDigests:await Promise.all(evaluations.map(canonicalDigest)), passed:evaluations.every(value => value.passed),
    suspiciousFindings:[...new Set(evaluations.flatMap(value => value.suspiciousFindings))].sort(),
    changesServing:false, changesAuthority:false, changesHardware:false, authorizesAction:false};
}

export async function executeIsolatedCandidate({experiment:experimentValue, candidate:candidateValue, broker, inputDigest}) {
  const experiment = validateExperiment(experimentValue), candidate = validateCandidate(candidateValue, experiment);
  digest(inputDigest, 'candidate input digest');
  if (!broker || broker.ephemeral !== true || broker.secretsAvailable !== false || broker.persistentStorage !== false
    || broker.networkAccess !== false || typeof broker.execute !== 'function') throw new Error('candidate broker does not enforce isolation');
  const started = Date.now();
  const result = await broker.execute({candidateDigest:candidate.candidateDigest, inputDigest,
    capabilities:[...candidate.requestedCapabilities], budget:{...experiment.budget}});
  exact(result, ['outputDigest', 'cpuMs', 'peakMemoryMb', 'costUnits', 'networkRequests', 'undeclaredAccessAttempts', 'sideEffects'], 'candidate broker result');
  const violations = list(result.undeclaredAccessAttempts, 'undeclared access attempts', text, 0, 64);
  const sideEffects = list(result.sideEffects, 'candidate side effects', text, 0, 64);
  const withinBudget = integer(result.cpuMs, 'candidate CPU use') <= experiment.budget.maxCpuMs
    && integer(result.peakMemoryMb, 'candidate memory use') <= experiment.budget.maxMemoryMb
    && integer(result.costUnits, 'candidate cost use') <= experiment.budget.maxCostUnits
    && integer(result.networkRequests, 'candidate network use') === 0;
  return {schemaVersion:'patterns.improvement-candidate-job.v1', experimentId:experiment.experimentId,
    candidateDigest:candidate.candidateDigest, inputDigest, outputDigest:digest(result.outputDigest, 'candidate output digest'),
    elapsedMs:Math.max(0, Date.now() - started), withinBudget,
    state:withinBudget && violations.length === 0 && sideEffects.length === 0 ? 'COMPLETED' : 'QUARANTINED',
    violations, sideEffects, ephemeral:true, secretsAvailable:false, persistentStorage:false, networkAccess:false,
    changesServing:false, changesAuthority:false, changesHardware:false, authorizesAction:false};
}

async function appendRecord(env, table, idColumn, id, digestColumn, recordDigest, record) {
  const body = canonicalJson(record), created = new Date().toISOString();
  const existing = await env.AUTONOMY_DB.prepare(`SELECT ${digestColumn} digest FROM ${table} WHERE ${idColumn}=?1`).bind(id).first();
  if (existing) {
    if (existing.digest !== recordDigest) throw new Error(`${table} id conflicts with different content`);
    return {id, digest:recordDigest, idempotentReplay:true};
  }
  await env.AUTONOMY_DB.prepare(`INSERT INTO ${table}(${idColumn},${digestColumn},record_json,created) VALUES(?1,?2,?3,?4)`)
    .bind(id, recordDigest, body, created).run();
  return {id, digest:recordDigest, idempotentReplay:false};
}

export async function registerExperiment(env, value) {
  const record = validateExperiment(value), recordDigest = await canonicalDigest(record);
  return appendRecord(env, 'improvement_experiments', 'experiment_id', record.experimentId, 'experiment_digest', recordDigest, record);
}
export async function registerCandidate(env, value, experiment) {
  const record = validateCandidate(value, experiment), recordDigest = await canonicalDigest(record);
  return appendRecord(env, 'improvement_candidates', 'candidate_id', record.candidateId, 'candidate_record_digest', recordDigest, record);
}
export async function recordEvaluation(env, value, experiment, candidate) {
  const record = validateEvaluation(value, experiment, candidate), recordDigest = await canonicalDigest(record);
  return appendRecord(env, 'improvement_evaluations', 'evaluation_id', record.evaluationId, 'evaluation_digest', recordDigest, record);
}

export async function buildIncident({incidentId, experimentId, candidateDigest, incidentType, detectedAtMs, evidenceRefs, summary}) {
  if (!INCIDENT_TYPES.has(incidentType)) throw new Error('improvement incident type is unsupported');
  const base = {schemaVersion:INCIDENT_SCHEMA, incidentId:identifier(incidentId, 'incident id'),
    experimentId:identifier(experimentId, 'incident experiment id'), candidateDigest:digest(candidateDigest, 'incident candidate digest'),
    incidentType, detectedAtMs:integer(detectedAtMs, 'incident time'), evidenceRefs:list(evidenceRefs, 'incident evidence references', digest, 1, 128),
    summary:text(summary, 'incident summary'), quarantinesLineage:true, preservesEvidence:true,
    changesServing:false, changesAuthority:false, changesHardware:false, authorizesAction:false};
  return {...base, incidentDigest:await canonicalDigest(base)};
}

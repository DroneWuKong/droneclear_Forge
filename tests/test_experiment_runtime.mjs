import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORBIDDEN_CANDIDATE_CAPABILITIES, buildIncident, evaluateCouncil,
  executeIsolatedCandidate, validateCandidate, validateEvaluation, validateExperiment,
} from '../workers/experiment-runtime.mjs';

const D = character => `sha256:${character.repeat(64)}`;
function experiment(overrides = {}) {
  return {schemaVersion:'patterns.improvement-experiment.v1', experimentId:'experiment:ask-pie-001', lane:'ask-pie-ranking',
    registeredAtMs:4000, baselineDigest:D('a'), candidateParentDigests:[D('a')],
    mutationEnvelope:{allowedArtifactKinds:['POLICY'], maximumCandidates:16, maximumWallTimeMs:60_000},
    requestedCapabilities:['READ_INPUT_ARTIFACTS','WRITE_CANDIDATE_ARTIFACT','EXECUTE_EPHEMERAL'],
    trainingCutoffMs:1000, replayCutoffMs:2000, holdoutCutoffMs:3000,
    primaryMetric:{name:'ndcg', direction:'MAXIMIZE', minimumImprovement:0.02},
    protectedMetrics:[{name:'citationPrecision', maximumRegression:0}], sliceDefinitions:['overall','sparse-query'],
    minimumSampleSize:100, minimumDurationMs:1000, uncertaintyRule:'lower-bound above zero',
    budget:{maxCpuMs:10_000, maxMemoryMb:512, maxCostUnits:100, maxNetworkRequests:0},
    safetyInvariants:['no authority changes','no publication'], automaticStopConditions:['protected metric regression','capability violation'],
    promotionClass:'HUMAN_APPROVED_ACTIVATION', requiredApproverRoles:['RELEASE_APPROVER','SECURITY_REVIEWER'],
    rollbackTargetDigest:D('a'), evaluatorDigests:[D('e'),D('f')], toolchainDigest:D('c'), datasetDigests:[D('d'),D('9')],
    changesAuthority:false, changesHardware:false, authorizesAction:false, ...overrides};
}
function candidate(overrides = {}) {
  return {schemaVersion:'patterns.improvement-candidate.v1', candidateId:'candidate:ask-pie-001', experimentId:'experiment:ask-pie-001',
    parentDigests:[D('a')], candidateDigest:D('b'), artifactDigests:[D('7')], declaredChange:'Adjust bounded retrieval weights',
    expectedBenefit:'Improve held-out NDCG without citation regression',
    requestedCapabilities:['READ_INPUT_ARTIFACTS','WRITE_CANDIDATE_ARTIFACT','EXECUTE_EPHEMERAL'],
    prohibitedCapabilities:[...FORBIDDEN_CANDIDATE_CAPABILITIES], builderIdentity:'builder:forge-candidate',
    buildProvenanceDigest:D('6'), reproducibility:'MATCHED', compatibleInputSchema:'ask-pie-feedback-features-v1',
    compatibleOutputSchema:'retrieval-policy-candidate-v1', knownLimitations:['Public-intelligence retrieval only'], fallbackDigest:D('a'),
    changesServing:false, changesAuthority:false, changesHardware:false, authorizesAction:false, ...overrides};
}
function evaluation(id, evaluatorId, evaluatorDigest, overrides = {}) {
  return {schemaVersion:'patterns.improvement-evaluation.v1', evaluationId:id, experimentId:'experiment:ask-pie-001',
    candidateDigest:D('b'), evaluatorId, evaluatorDigest, datasetSnapshotDigest:D('d'), holdoutHandle:'holdout:rotating-001',
    windowStartMs:4000, windowEndMs:5000, observedAtMs:5000, sampleSize:100,
    baselinePrimaryValue:0.5, candidatePrimaryValue:0.53,
    protectedMetricRegressions:[{name:'citationPrecision', regression:0, passed:true}],
    sliceResults:[{sliceId:'overall', sampleSize:100, primaryDelta:0.03, passed:true},
      {sliceId:'sparse-query', sampleSize:30, primaryDelta:0.02, passed:true}],
    resourceUse:{cpuMs:1000, peakMemoryMb:128, costUnits:10, networkRequests:0}, suspiciousFindings:[],
    uncertainty:'95% lower bound 0.021', replayable:true, passed:true,
    changesServing:false, changesAuthority:false, changesHardware:false, authorizesAction:false, ...overrides};
}

test('prospective experiment and candidate contracts deny capability expansion', () => {
  assert.equal(validateExperiment(experiment()).promotionClass, 'HUMAN_APPROVED_ACTIVATION');
  assert.equal(validateCandidate(candidate(), experiment()).candidateDigest, D('b'));
  assert.throws(() => validateExperiment(experiment({requestedCapabilities:['SECRETS']})), /forbidden/);
  assert.throws(() => validateCandidate(candidate({requestedCapabilities:['DEPLOY']}), experiment()), /undeclared/);
  assert.throws(() => validateCandidate(candidate({prohibitedCapabilities:['SECRETS']}), experiment()), /incomplete/);
});

test('candidate job runs only through an ephemeral no-secret no-network broker', async () => {
  const broker = {ephemeral:true, secretsAvailable:false, persistentStorage:false, networkAccess:false,
    execute:async () => ({outputDigest:D('8'), cpuMs:100, peakMemoryMb:64, costUnits:1, networkRequests:0,
      undeclaredAccessAttempts:[], sideEffects:[]})};
  const result = await executeIsolatedCandidate({experiment:experiment(), candidate:candidate(), broker, inputDigest:D('4')});
  assert.equal(result.state, 'COMPLETED');
  assert.equal(result.authorizesAction, false);
  await assert.rejects(executeIsolatedCandidate({experiment:experiment(), candidate:candidate(),
    broker:{...broker, secretsAvailable:true}, inputDigest:D('4')}), /does not enforce isolation/);
  const violation = await executeIsolatedCandidate({experiment:experiment(), candidate:candidate(),
    broker:{...broker, execute:async () => ({outputDigest:D('8'), cpuMs:100, peakMemoryMb:64, costUnits:1,
      networkRequests:0, undeclaredAccessAttempts:['secret:OPENAI_API_KEY'], sideEffects:[]})}, inputDigest:D('4')});
  assert.equal(violation.state, 'QUARANTINED');
});

test('independent evaluator council rejects self-evaluation and suspicious gains', async () => {
  const first = evaluation('evaluation:one','evaluator:one',D('e'));
  const second = evaluation('evaluation:two','evaluator:two',D('f'));
  const council = await evaluateCouncil(experiment(), candidate(), [first,second]);
  assert.equal(council.passed, true);
  assert.equal(council.evaluationDigests.length, 2);
  assert.throws(() => validateEvaluation(evaluation('evaluation:self','builder:forge-candidate',D('e')), experiment(), candidate()), /cannot evaluate/);
  assert.throws(() => validateEvaluation(evaluation('evaluation:suspicious','evaluator:one',D('e'),
    {suspiciousFindings:['unexpected benchmark branch'], passed:true}), experiment(), candidate()), /disagrees/);
  await assert.rejects(evaluateCouncil(experiment(), candidate(), [first, evaluation('evaluation:two','evaluator:two',D('e'))]), /not independent/);
});

test('incidents quarantine lineage without authorizing effects', async () => {
  const incident = await buildIncident({incidentId:'incident:secret-access-001', experimentId:'experiment:ask-pie-001',
    candidateDigest:D('b'), incidentType:'SECRET_ACCESS', detectedAtMs:5000, evidenceRefs:[D('5')], summary:'Denied secret access attempt'});
  assert.equal(incident.quarantinesLineage, true);
  assert.equal(incident.preservesEvidence, true);
  assert.equal(incident.authorizesAction, false);
  assert.match(incident.incidentDigest, /^sha256:[0-9a-f]{64}$/);
});

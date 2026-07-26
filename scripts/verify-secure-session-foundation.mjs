import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = process.cwd();
const digest = (value) => createHash("sha256").update(value).digest("hex");
const approvedStagingProjectRef = "ejxfoxbfndplinraqrvw";
const productionProjectRef = "kyrgdkghgyazmphvpsub";
const parseStagingDatabaseUrl = (value, expectedRef = approvedStagingProjectRef) => {
  assert.equal(expectedRef, approvedStagingProjectRef, "staging database target is not the approved project");
  assert.ok(typeof value === "string" && value.length > 0, "PIBA_STAGING_DATABASE_URL is required");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("staging database URL is malformed");
  }
  assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol), "staging database URL must use PostgreSQL");
  assert.equal(parsed.hash, "", "staging database URL must not contain a fragment");
  assert.equal(parsed.pathname, "/postgres", "staging database URL must target the postgres database");
  assert.equal(parsed.searchParams.get("sslmode"), "require", "staging database URL must require SSL");
  assert.deepEqual([...parsed.searchParams.keys()], ["sslmode"], "staging database URL contains unapproved query parameters");
  assert.ok(parsed.password.length > 0, "staging database URL requires a password");
  const username = decodeURIComponent(parsed.username);
  const directHost = `db.${expectedRef}.supabase.co`;
  const direct = parsed.hostname === directHost && username === "postgres" && ["", "5432"].includes(parsed.port);
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(parsed.hostname)
    && username === `postgres.${expectedRef}` && ["5432", "6543"].includes(parsed.port);
  assert.ok(direct || pooler, "staging database URL host, user, or port is not bound to the approved project");
  assert.notEqual(parsed.hostname, `db.${productionProjectRef}.supabase.co`, "production database target is forbidden");
  return { kind: direct ? "direct" : "pooler", hostname: parsed.hostname, port: parsed.port || "5432" };
};
const productionEndpoints = ["login", "refresh", "logout", "current-user", "list-users", "create-user", "update-profile"];
const evaluateProductionSlo = (source) => {
  const value = JSON.parse(source);
  const rows = value.result ?? value;
  assert.ok(Array.isArray(rows), "malformed telemetry response");
  assert.equal(rows.length, productionEndpoints.length, "telemetry must contain exactly seven rows");
  for (const row of rows) assert.ok(productionEndpoints.includes(row.endpoint), `telemetry endpoint is outside the approved domain: ${row.endpoint}`);
  const byEndpoint = new Map(rows.map((row) => [row.endpoint, row]));
  assert.equal(byEndpoint.size, productionEndpoints.length, "telemetry must contain exactly seven unique endpoints");
  const endpointResults = productionEndpoints.map((endpoint) => {
    const row = byEndpoint.get(endpoint);
    assert.ok(row, `telemetry endpoint is missing: ${endpoint}`);
    for (const field of ["sample_count", "unexpected_error_rate", "non_success_rate", "auth_throttle_rate", "p95_ms"]) {
      assert.ok(row[field] !== null && row[field] !== undefined && row[field] !== "", `telemetry metric ${endpoint}.${field} must be present`);
    }
    const result = {
      endpoint,
      sampleCount: Number(row.sample_count),
      unexpectedErrorRate: Number(row.unexpected_error_rate),
      nonSuccessRate: Number(row.non_success_rate),
      authThrottleRate: Number(row.auth_throttle_rate),
      p95Ms: Number(row.p95_ms),
    };
    assert.ok([result.sampleCount, result.unexpectedErrorRate, result.nonSuccessRate, result.authThrottleRate, result.p95Ms].every(Number.isFinite), `telemetry metrics must be finite: ${endpoint}`);
    assert.ok(Number.isInteger(result.sampleCount) && result.sampleCount >= 30, `telemetry sample count must be an integer of at least 30: ${endpoint}`);
    for (const rate of [result.unexpectedErrorRate, result.nonSuccessRate, result.authThrottleRate]) assert.ok(rate >= 0 && rate <= 1, `telemetry rate must be within [0,1]: ${endpoint}`);
    assert.ok(result.p95Ms >= 0, `telemetry latency must be nonnegative: ${endpoint}`);
    result.decision = result.unexpectedErrorRate >= 0.05 ? "rollback"
      : result.unexpectedErrorRate >= 0.02 || result.nonSuccessRate >= 0.02 || result.authThrottleRate >= 0.05 || result.p95Ms >= 750 ? "emergency"
        : result.unexpectedErrorRate >= 0.01 ? "investigation" : "pass";
    return result;
  });
  const actionOrder = ["pass", "investigation", "emergency", "rollback"];
  const action = endpointResults.reduce((worst, result) => actionOrder.indexOf(result.decision) > actionOrder.indexOf(worst) ? result.decision : worst, "pass");
  const exitStatus = { pass: 0, investigation: 1, emergency: 2, rollback: 5 }[action];
  return { action, exitStatus, endpointResults, evidenceSha256: digest(source) };
};

const createEvidenceValidators = (baseDirectory) => {
  const evidenceRoot = resolve(baseDirectory, "ops/secure-sessions/evidence");
  const manifestSchema = JSON.parse(readFileSync(resolve(evidenceRoot, "release-manifest.schema.json"), "utf8"));
  const receiptSchema = JSON.parse(readFileSync(resolve(evidenceRoot, "phase-receipt.schema.json"), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addSchema(manifestSchema);
  ajv.addSchema(receiptSchema);
  return {
    ajv,
    validateManifestSchema: ajv.getSchema(manifestSchema.$id),
    validateReceiptSchema: ajv.getSchema(receiptSchema.$id),
    validateAuthorizationSchema: ajv.compile({ $ref: `${manifestSchema.$id}#/$defs/deploymentAuthorization` }),
    validateDetectionSchema: ajv.compile({ $ref: `${manifestSchema.$id}#/$defs/productionDetectionEvidence` }),
    validateCheckpointSchema: ajv.compile({ $ref: `${receiptSchema.$id}#/$defs/rollbackCheckpoint` }),
  };
};
const requireSchema = (validators, validate, value, label) => assert.ok(validate(value), `${label}: ${validators.ajv.errorsText(validate.errors)}`);
const defaultSleepSync = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
const assertReceiptChronology = (receipt, label) => {
  const startedAt = Date.parse(receipt.startedAt);
  const completedAt = Date.parse(receipt.completedAt);
  assert.ok(Number.isFinite(startedAt) && Number.isFinite(completedAt) && startedAt <= completedAt, `${label} timestamps are not chronological`);
  if (receipt.phase === "cutover") {
    const observationStartedAt = Date.parse(receipt.evidence.observationStartedAt);
    const observationEndedAt = Date.parse(receipt.evidence.observationEndedAt);
    assert.ok(startedAt <= observationStartedAt && observationStartedAt < observationEndedAt && observationEndedAt <= completedAt, `${label} observation timestamps are not chronological`);
    const observedMinutes = (observationEndedAt - observationStartedAt) / 60_000;
    assert.ok(Math.abs(observedMinutes - receipt.evidence.observationDurationMinutes) <= 1 / 60, `${label} observation duration does not equal its timestamps`);
    for (const approval of receipt.evidence.approvals) {
      const approvedAt = Date.parse(approval.approvedAt);
      assert.ok(observationEndedAt <= approvedAt && approvedAt <= completedAt, `${label} approval is outside the completed observation window`);
    }
  }
};
const executeRollback = ({ manifestPath, executionPath, environment, checkpointPath, rollbackAuthorizationPath, env = process.env, baseDirectory = root, commandRunner = spawnSync, sleepSync = defaultSleepSync, tempDirectory = tmpdir(), fs = {}, now = () => new Date() }) => {
  const io = { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, ...fs };
  assert.ok(manifestPath && executionPath && checkpointPath && rollbackAuthorizationPath, "rollback requires MANIFEST EXECUTION_RECEIPT ENVIRONMENT CHECKPOINT_RECEIPT ROLLBACK_AUTHORIZATION");
  assert.ok(["staging", "production"].includes(environment), "rollback environment must be staging or production");
  for (const name of ["RELEASE_ID", "PROJECT_REF", "DATABASE_URL", "PRIOR_VERCEL_DEPLOYMENT_ID", "VERCEL_PROJECT_ID", "VERCEL_ORG_ID", "GH_TOKEN", "GITHUB_REPOSITORY"]) assert.ok(env[name], `missing ${name}`);
  const validators = createEvidenceValidators(baseDirectory);
  const manifestSource = io.readFileSync(resolve(baseDirectory, manifestPath));
  const executionSource = io.readFileSync(resolve(baseDirectory, executionPath));
  const manifest = JSON.parse(manifestSource.toString("utf8"));
  const execution = JSON.parse(executionSource.toString("utf8"));
  requireSchema(validators, validators.validateManifestSchema, manifest, "rollback release manifest schema");
  assert.equal(manifest.stagingBootstrap.productionEligible, false, "staging bootstrap cannot authorize production rollback");
  assert.equal(manifest.stagingBootstrap.rollbackMutation, false, "rollback must never mutate staging bootstrap objects");
  requireSchema(validators, validators.validateReceiptSchema, execution, "rollback execution receipt schema");
  assertReceiptChronology(execution, "rollback execution receipt");
  assert.equal(execution.phase, "cutover-execution", "rollback requires actual cutover execution state");
  const authorizationPath = execution.evidence.authorizationReceiptPath;
  const authorizationSource = io.readFileSync(resolve(baseDirectory, authorizationPath));
  const authorization = JSON.parse(authorizationSource.toString("utf8"));
  requireSchema(validators, validators.validateReceiptSchema, authorization, "rollback authorization receipt schema");
  assertReceiptChronology(authorization, "rollback authorization receipt");
  assert.equal(authorization.phase, "cutover", "rollback authorization receipt phase mismatch");
  assert.equal(authorization.status, "approved", "rollback authorization receipt is not approved");
  assert.ok(Date.parse(authorization.completedAt) <= Date.parse(execution.startedAt), "cutover execution must start after authorization completes");
  assert.deepEqual(manifest.functionBundles.map(({ name }) => name).sort(), ["backfill", "session-login", "session-logout", "session-profile", "session-refresh", "session-users"], "rollback candidate function inventory mismatch");
  assert.deepEqual(manifest.priorFunctions.bundles.map(({ name }) => name).sort(), ["backfill", "session-login", "session-logout", "session-profile", "session-refresh", "session-users"], "rollback prior function inventory mismatch");
  const manifestSha256 = digest(manifestSource);
  const executionReceiptSha256 = digest(executionSource);
  const cutoverAuthorizationSha256 = digest(authorizationSource);
  assert.equal(execution.environment, environment, "cutover execution environment mismatch");
  assert.equal(authorization.environment, environment, "cutover authorization environment mismatch");
  assert.equal(execution.status, "succeeded", "cutover execution did not succeed");
  assert.equal(execution.evidence.resultingMigrationState, "hash_only", "cutover execution state is not hash_only");
  assert.equal(manifest.releaseId, execution.releaseId, "manifest and execution release mismatch");
  assert.equal(authorization.releaseId, execution.releaseId, "authorization and execution release mismatch");
  assert.equal(execution.manifestSha256, manifestSha256, "execution manifest checksum mismatch");
  assert.equal(authorization.manifestSha256, manifestSha256, "authorization manifest checksum mismatch");
  assert.equal(execution.evidence.authorizationReceiptSha256, cutoverAuthorizationSha256, "authorization receipt checksum mismatch");
  assert.equal(manifest.gitCommit, execution.evidence.gitCommit, "rollback candidate commit mismatch");
  assert.equal(authorization.evidence.functionVersionEvidence.version, manifest.functionVersion, "rollback authorization function version mismatch");
  assert.equal(authorization.evidence.clientVersionEvidence.version, manifest.clientVersion, "rollback authorization client version mismatch");
  assert.equal(authorization.evidence.clientVersionEvidence.providerDeploymentId, manifest.clientDeploymentId, "rollback authorization client deployment mismatch");
  assert.equal(authorization.evidence.clientVersionEvidence.assetManifestSha256, manifest.clientAssetManifestSha256, "rollback authorization client asset mismatch");
  assert.equal(env.PROJECT_REF, manifest.supabaseProjectRef, "PROJECT_REF must equal the manifest target");
  assert.equal(env.PRIOR_VERCEL_DEPLOYMENT_ID, manifest.priorVercelDeployment.deploymentId, "PRIOR_VERCEL_DEPLOYMENT_ID must equal the manifest target");
  assert.equal(env.VERCEL_PROJECT_ID, manifest.vercelProjectId, "VERCEL_PROJECT_ID must equal the manifest target");
  assert.equal(env.VERCEL_ORG_ID, manifest.vercelOrgId, "VERCEL_ORG_ID must equal the manifest target");
  const cutoverSqlSource = io.readFileSync(resolve(baseDirectory, execution.evidence.sqlPath));
  assert.equal(digest(cutoverSqlSource), execution.evidence.sqlSha256, "cutover SQL checksum mismatch");
  assert.equal(manifest.artifacts.find(({ path }) => path === execution.evidence.sqlPath)?.sha256, execution.evidence.sqlSha256, "cutover SQL is not manifest-bound");
  for (const bundle of [...manifest.functionBundles, ...manifest.priorFunctions.bundles]) assert.equal(digest(io.readFileSync(resolve(baseDirectory, bundle.location))), bundle.sourceSha256, `function bundle checksum mismatch: ${bundle.location}`);
  const run = (command, args, options = {}) => {
    let result;
    const delays = [0, 2_000, 4_000].slice(0, options.attempts ?? 3);
    for (const delay of delays) {
      if (delay) sleepSync(delay);
      result = commandRunner(command, args, {
        cwd: baseDirectory,
        encoding: "utf8",
        stdio: options.capture ? "pipe" : "inherit",
        env: options.env ?? process.env,
      });
      if (result.status === 0) return result;
    }
    throw new Error(`${command} failed after bounded retries: ${result?.stderr ?? ""}`);
  };
  const rollbackAuthorizationSource = io.readFileSync(resolve(baseDirectory, rollbackAuthorizationPath));
  const rollbackAuthorization = JSON.parse(rollbackAuthorizationSource.toString("utf8"));
  assert.deepEqual(Object.keys(rollbackAuthorization).sort(), ["actor", "authorizedAt", "binding", "commentBodySha256", "commentId", "issueNumber", "provider", "repository"], "rollback authorization fields mismatch");
  assert.equal(rollbackAuthorization.provider, "github", "rollback authorization provider must be GitHub");
  assert.equal(rollbackAuthorization.repository.toLowerCase(), env.GITHUB_REPOSITORY.toLowerCase(), "rollback authorization repository mismatch");
  assert.ok(Number.isInteger(rollbackAuthorization.issueNumber) && rollbackAuthorization.issueNumber > 0, "rollback authorization issue number is invalid");
  assert.ok(Number.isInteger(rollbackAuthorization.commentId) && rollbackAuthorization.commentId > 0, "rollback authorization comment ID is invalid");
  assert.match(rollbackAuthorization.actor, /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "rollback incident commander is invalid");
  assert.ok(Number.isFinite(Date.parse(rollbackAuthorization.authorizedAt)) && Date.parse(rollbackAuthorization.authorizedAt) <= now().getTime(), "rollback authorization timestamp is invalid or in the future");
  assert.ok(Date.parse(rollbackAuthorization.authorizedAt) >= Date.parse(execution.completedAt), "rollback authorization predates cutover execution completion");
  const rollbackBinding = {
    decision: "rollback",
    environment,
    rollbackReleaseId: env.RELEASE_ID,
    expectedReleaseId: execution.releaseId,
    gitCommit: manifest.gitCommit,
    manifestSha256,
    executionReceiptSha256,
    priorVercelDeploymentId: manifest.priorVercelDeployment.deploymentId,
    priorFunctionGitSha: manifest.priorFunctions.gitSha,
  };
  assert.deepEqual(rollbackAuthorization.binding, rollbackBinding, "rollback authorization is not content-bound to this recovery");
  const expectedCommentBody = `PIBA secure-session rollback authorization\n\n${JSON.stringify(rollbackBinding)}`;
  assert.equal(rollbackAuthorization.commentBodySha256, digest(expectedCommentBody), "rollback authorization comment checksum mismatch");
  const providerEnv = { ...process.env, GH_TOKEN: env.GH_TOKEN };
  const providerJson = (path) => {
    const result = run("gh", ["api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28", path], { capture: true, env: providerEnv });
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error(`GitHub provider returned malformed rollback authorization evidence: ${path}`);
    }
  };
  const providerRoot = `repos/${rollbackAuthorization.repository}`;
  const issue = providerJson(`${providerRoot}/issues/${rollbackAuthorization.issueNumber}`);
  assert.equal(issue.number, rollbackAuthorization.issueNumber, "rollback authorization issue mismatch");
  assert.equal(issue.state, "open", "rollback authorization issue is not open");
  assert.equal(issue.title, `[secure-session-rollback] ${execution.releaseId}`, "rollback authorization issue title mismatch");
  const comment = providerJson(`${providerRoot}/issues/comments/${rollbackAuthorization.commentId}`);
  assert.equal(comment.user?.login?.toLowerCase(), rollbackAuthorization.actor.toLowerCase(), "rollback authorization actor mismatch");
  assert.equal(Date.parse(comment.created_at), Date.parse(rollbackAuthorization.authorizedAt), "rollback authorization timestamp mismatch");
  assert.equal(comment.body, expectedCommentBody, "rollback authorization comment is not content-bound");
  assert.equal(digest(comment.body), rollbackAuthorization.commentBodySha256, "provider rollback authorization checksum mismatch");
  const governedActors = [
    authorization.actor,
    execution.actor,
    ...authorization.evidence.approvals.map(({ actor }) => actor),
    ...manifest.deploymentAuthorization.approvals.map(({ actor }) => actor),
  ].map((actor) => actor.toLowerCase());
  assert.ok(!governedActors.includes(rollbackAuthorization.actor.toLowerCase()), "incident commander must be distinct from cutover and deployment approval actors");
  const permission = providerJson(`${providerRoot}/collaborators/${encodeURIComponent(rollbackAuthorization.actor)}/permission`).permission;
  assert.ok(["maintain", "admin"].includes(permission), "incident commander lacks maintain or admin permission");
  const rollbackAuthorizationSha256 = digest(rollbackAuthorizationSource);
  const allowedSteps = ["vercel", ...manifest.priorFunctions.bundles.map(({ name }) => `function:${name}`), "sql"];
  const checkpointIdentity = { releaseId: env.RELEASE_ID, expectedReleaseId: execution.releaseId, environment, gitCommit: manifest.gitCommit, manifestSha256, executionReceiptSha256, authorizationReceiptSha256: rollbackAuthorizationSha256, allowedSteps };
  let completed = [];
  if (io.existsSync(checkpointPath)) {
    const saved = JSON.parse(io.readFileSync(checkpointPath, "utf8"));
    requireSchema(validators, validators.validateCheckpointSchema, saved, "rollback checkpoint schema");
    for (const [field, expected] of Object.entries(checkpointIdentity)) assert.deepEqual(saved[field], expected, `stale rollback checkpoint ${field}`);
    assert.deepEqual(saved.completedSteps, allowedSteps.slice(0, saved.completedSteps.length), "rollback checkpoint contains unknown, skipped, or reordered steps");
    completed = [...saved.completedSteps];
  }
  const persistCheckpoint = (step) => {
    assert.equal(step, allowedSteps[completed.length], "rollback step order mismatch");
    completed.push(step);
    const checkpoint = { ...checkpointIdentity, completedSteps: [...completed], updatedAt: new Date().toISOString() };
    requireSchema(validators, validators.validateCheckpointSchema, checkpoint, "rollback checkpoint schema");
    io.mkdirSync(resolve(checkpointPath, ".."), { recursive: true });
    const temporaryPath = `${checkpointPath}.${process.pid}.${Date.now()}.tmp`;
    io.writeFileSync(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { flag: "wx" });
    io.renameSync(temporaryPath, checkpointPath);
  };
  const restoreRoot = io.mkdtempSync(resolve(tempDirectory, `piba-rollback-${process.pid}-`));
  try {
    if (!completed.includes("vercel")) {
      run("npx", ["--yes", "vercel@46.0.2", "rollback", manifest.priorVercelDeployment.deploymentId, "--scope", manifest.vercelOrgId]);
      run("npx", ["--yes", "vercel@46.0.2", "rollback", "status", "--scope", manifest.vercelOrgId]);
      persistCheckpoint("vercel");
    }
    for (const bundle of manifest.priorFunctions.bundles) {
      const step = `function:${bundle.name}`;
      if (completed.includes(step)) continue;
      run("tar", ["-xzf", bundle.location, "-C", restoreRoot]);
      run("npx", ["--yes", "supabase@2.109.1", "functions", "deploy", bundle.name, "--project-ref", manifest.supabaseProjectRef, "--workdir", restoreRoot, "--use-api", "--no-verify-jwt"]);
      persistCheckpoint(step);
    }
    if (!completed.includes("sql")) {
      const rollbackSqlSource = io.readFileSync(resolve(baseDirectory, manifest.sqlRollback.path));
      assert.equal(digest(rollbackSqlSource), manifest.sqlRollback.sha256, "rollback SQL checksum mismatch");
      const mutationArgs = [env.DATABASE_URL, "-X", "-v", "ON_ERROR_STOP=1", "-v", `release_id=${env.RELEASE_ID}`, "-v", `expected_release_id=${execution.releaseId}`, "-f", manifest.sqlRollback.path];
      const reconciliationArgs = [env.DATABASE_URL, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", "select migration_state || '|' || fallback_enabled::text || '|' || updated_by_release from public.security_settings where id"];
      const reconcile = () => {
        const proof = run("psql", reconciliationArgs, { capture: true });
        const state = proof.stdout.trim();
        if (state === `compatibility|true|${env.RELEASE_ID}`) return { outcome: "applied", proof };
        if (state === `hash_only|false|${execution.releaseId}`) return { outcome: "pending", proof };
        throw new Error(`rollback SQL live state is ambiguous: ${state || "empty"}`);
      };
      let result;
      for (let attempt = 0; attempt < 3; attempt++) {
        result = commandRunner("psql", mutationArgs, { cwd: baseDirectory, encoding: "utf8", stdio: "pipe", env: process.env });
        const live = reconcile();
        if (live.outcome === "applied") {
          persistCheckpoint("sql");
          return { status: "rolled-back", expectedReleaseId: execution.releaseId, sqlOutputSha256: digest(`${result.stdout ?? ""}\n${live.proof.stdout}`), checkpointSha256: digest(io.readFileSync(checkpointPath)), reconciled: result.status !== 0 };
        }
        if (result.status === 0) throw new Error("rollback SQL reported success without committed live state");
        if (attempt === 2) throw new Error(`psql failed after bounded reconciled retries: ${result.stderr ?? ""}`);
        sleepSync([2_000, 4_000][attempt]);
      }
    }
    return { status: "rolled-back", expectedReleaseId: execution.releaseId, resumed: true, checkpointSha256: digest(io.readFileSync(checkpointPath)) };
  } finally {
    io.rmSync(restoreRoot, { recursive: true, force: true });
  }
};

if (process.argv[2] === "--evaluate-production-slo") {
  try {
    const result = evaluateProductionSlo(readFileSync(resolve(root, process.argv[3]), "utf8"));
    console.log(JSON.stringify(result));
    process.exit(result.exitStatus);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "production SLO evaluation failed");
    process.exit(3);
  }
}
if (process.argv[2] === "--execute-rollback") {
  try {
    const [manifestPath, executionPath, environment, checkpointPath, rollbackAuthorizationPath] = process.argv.slice(3);
    console.log(JSON.stringify(executeRollback({ manifestPath, executionPath, environment, checkpointPath, rollbackAuthorizationPath })));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "rollback failed");
    process.exit(1);
  }
}
const migrationsDirectory = resolve(root, "supabase/migrations");
const migrationPath = resolve(migrationsDirectory, "20260408020000_secure_session_foundation.sql");
const stagingBootstrapPath = resolve(root, "ops/secure-sessions/staging/bootstrap.sql");
const stagingBootstrapVerificationPath = resolve(root, "ops/secure-sessions/staging/verify-bootstrap.sql");
const stagingBootstrapRunnerPath = resolve(root, "scripts/bootstrap-secure-session-staging.sh");
const baselineMigrationPath = resolve(migrationsDirectory, "20260408014035_fix_rehearsal_song_chords_fk.sql");
const cutoverPath = resolve(root, "ops/secure-sessions/cutover.sql");
const rollbackPath = resolve(root, "ops/secure-sessions/rollback.sql");
const driftGatePath = resolve(root, "ops/secure-sessions/migration_drift_gate.sql");
const foundationRemovalPath = resolve(root, "ops/secure-sessions/foundation-removal.sql");
const testPath = resolve(root, "supabase/tests/secure_sessions.sql");
const baselinePath = resolve(root, "ops/secure-sessions/drift-baseline.json");
const evidenceDirectory = resolve(root, "ops/secure-sessions/evidence");
const profileHandler = readFileSync(resolve(root, "supabase/functions/session-profile/index.ts"), "utf8");
const usersHandler = readFileSync(resolve(root, "supabase/functions/session-users/index.ts"), "utf8");
const sessionApi = readFileSync(resolve(root, "src/infrastructure/api/SessionApi.ts"), "utf8");
const userRepository = readFileSync(resolve(root, "src/infrastructure/repositories/SupabaseUserRepository.ts"), "utf8");
const workflow = readFileSync(resolve(root, ".github/workflows/secure-sessions.yml"), "utf8");
const runbook = readFileSync(resolve(root, "ops/secure-sessions/runbook.md"), "utf8");
const backfillHandler = readFileSync(resolve(root, "supabase/functions/backfill/index.ts"), "utf8");
const refreshIntegration = readFileSync(resolve(root, "supabase/functions/refresh-db.integration.test.ts"), "utf8");
const sqlHarness = readFileSync(resolve(root, "scripts/run-secure-session-sql-harness.sh"), "utf8");
const migrationDriftGate = readFileSync(driftGatePath, "utf8");
const stagingBootstrapRunner = readFileSync(stagingBootstrapRunnerPath, "utf8");

for (const path of [migrationPath, stagingBootstrapPath, stagingBootstrapVerificationPath, stagingBootstrapRunnerPath, baselineMigrationPath, cutoverPath, rollbackPath, driftGatePath, foundationRemovalPath, testPath, baselinePath]) {
  assert.ok(existsSync(path), `missing security-slice artifact: ${path}`);
}

const migrationFiles = readdirSync(migrationsDirectory).filter((file) => file.endsWith(".sql")).sort();
assert.deepEqual(migrationFiles, [
  "20260408014035_fix_rehearsal_song_chords_fk.sql",
  "20260408020000_secure_session_foundation.sql",
  "20260721044311_recover_partial_backfill_credentials.sql",
  "20260721055246_session_pr3_atomic_operations.sql",
], "local migration inventory contains an unexpected, renamed, or duplicate migration");

const migration = readFileSync(migrationPath, "utf8");
const stagingBootstrap = readFileSync(stagingBootstrapPath, "utf8");
const stagingBootstrapVerification = readFileSync(stagingBootstrapVerificationPath, "utf8");
const baselineMigration = readFileSync(baselineMigrationPath, "utf8");
const cutover = readFileSync(cutoverPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");
const driftGate = readFileSync(driftGatePath, "utf8");
const foundationRemoval = readFileSync(foundationRemovalPath, "utf8");
const sqlTests = readFileSync(testPath, "utf8");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

assert.equal(baseline.approvedRemoteBaseline, "20260408014035");
assert.equal(baseline.approvedMigrationName, "fix_rehearsal_song_chords_fk");
for (const table of ["users", "songs", "rehearsals", "rehearsal_users", "rehearsal_songs", "rehearsal_song_chords", "background_assets"]) {
  assert.match(stagingBootstrap, new RegExp(`create table public\\.${table}\\b`, "i"));
  assert.match(stagingBootstrap, new RegExp(`alter table public\\.${table} force row level security`, "i"));
}
assert.match(stagingBootstrap, /foreign key \(rehearsal_id, song_id\)[\s\S]*references public\.rehearsal_songs/i);
assert.match(stagingBootstrap, /revoke all on table[\s\S]*from public, anon, authenticated, service_role/i);
assert.match(stagingBootstrap, /grant select, insert, update on table public\.users to service_role/i);
assert.doesNotMatch(stagingBootstrap, /create policy|insert into storage\.buckets/i);
assert.match(stagingBootstrap, /set search_path = pg_catalog, public/g);
assert.match(stagingBootstrap, /revoke all on function[\s\S]*create_rehearsal_with_details[\s\S]*update_rehearsal_with_details[\s\S]*from public, anon, authenticated, service_role/i);
assert.match(stagingBootstrapVerification, /STAGING_BOOTSTRAP_RLS_NOT_FORCED/);
assert.match(stagingBootstrapVerification, /STAGING_BOOTSTRAP_CLIENT_TABLE_GRANT_FOUND/);
assert.match(stagingBootstrapVerification, /STAGING_BOOTSTRAP_BACKGROUND_BUCKET_MUST_BE_ABSENT/);
assert.match(stagingBootstrapVerification, /STAGING_BOOTSTRAP_MIGRATION_STATE_CONTRADICTORY/);
assert.match(stagingBootstrapVerification, /STAGING_BOOTSTRAP_PRIVATE_STATE_CONTRADICTORY/);
assert.match(sqlHarness, /staging\/bootstrap\.sql/);
assert.match(sqlHarness, /staging\/verify-bootstrap\.sql/g);
assert.match(sqlHarness, /20260408014035_fix_rehearsal_song_chords_fk\.sql/);
assert.match(stagingBootstrapRunner, /PIBA_DEPLOY_ENV.*required/);
assert.match(stagingBootstrapRunner, /ejxfoxbfndplinraqrvw/);
assert.match(stagingBootstrapRunner, /--validate-staging-bootstrap-authorization/);
assert.match(stagingBootstrapRunner, /pg_stat_ssl/);
assert.match(stagingBootstrapRunner, /bootstrapped\|migrations-1\|migrations-2\|migrations-3/);
assert.match(stagingBootstrapRunner, /rerun to resume from verified migration history/);
assert.match(stagingBootstrapRunner, /supabase db push --db-url/);
assert.equal(stagingBootstrapRunner.match(/supabase db push/g)?.length, 1, "staging runner must not retry migration mutation blindly");
assert.doesNotMatch(stagingBootstrapRunner, /--include-all|--linked/);
assert.match(migrationDriftGate, /RETROACTIVE_STAGING_BOOTSTRAP_HISTORY_FORBIDDEN/);
assert.match(migrationDriftGate, /:'deployment_environment'/);
assert.equal(parseStagingDatabaseUrl(`postgresql://postgres:fixture@db.${approvedStagingProjectRef}.supabase.co:5432/postgres?sslmode=require`).kind, "direct");
assert.equal(parseStagingDatabaseUrl(`postgresql://postgres.${approvedStagingProjectRef}:fixture@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`).kind, "pooler");
for (const invalidUrl of [
  "not-a-url",
  `postgresql://postgres:fixture@db.${productionProjectRef}.supabase.co:5432/postgres?sslmode=require`,
  "postgresql://postgres:fixture@db.alternatestaging.supabase.co:5432/postgres?sslmode=require",
  `postgresql://postgres:fixture@db.wrongdatabase.supabase.co:5432/postgres?sslmode=require&project=${approvedStagingProjectRef}`,
  `postgresql://postgres:fixture@db.wrongdatabase.supabase.co:5432/${approvedStagingProjectRef}?sslmode=require`,
  `postgresql://postgres:${approvedStagingProjectRef}@db.wrongdatabase.supabase.co:5432/postgres?sslmode=require`,
  `postgresql://postgres:fixture@db.${approvedStagingProjectRef}.supabase.co:5432/postgres`,
  `postgresql://postgres.wrongref:fixture@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`,
]) assert.throws(() => parseStagingDatabaseUrl(invalidUrl), /staging database|production database|approved project/);
assert.match(baselineMigration, /foreign key \(rehearsal_id, song_id\)/i);
assert.equal(createHash("sha256").update(baselineMigration).digest("hex"), "de8e1b5cb29365f28802335c35e64f90d99c06f5bbe8a8253795d04ccd80cec2");
assert.match(migration, /secure-access-code-sessions-foundation-20260408020000/);
assert.doesNotMatch(migration, /current_setting\('app\.release_id'/);
assert.match(migration, /alter table public\.users enable row level security/i);
assert.match(migration, /revoke all on table public\.users from public,anon,authenticated/i);
assert.match(migration, /create table app_private\.user_credentials/i);
assert.doesNotMatch(migration, /add column if not exists access_code_hash/i);
assert.match(migration, /create function public\.list_safe_users\(p_id uuid default null,p_role text default null\)/i);
assert.match(migration, /security definer/i);
assert.match(migration, /set search_path = pg_catalog, public/i);
assert.match(migration, /revoke all on function public\.list_safe_users\(uuid,text\) from public,anon,authenticated/i);
assert.match(migration, /grant execute on function public\.list_safe_users\(uuid,text\) to service_role/i);
assert.doesNotMatch(migration, /grant execute on function public\.list_safe_users\(uuid,text\) to (?:anon|authenticated)/i);
assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?view\s+public\.users_safe/i);

const privateSignatures = new Map([
  ["app_private.consume_endpoint_limit", "text,bytea,integer,integer"],
  ["app_private.create_user_with_credential", "uuid,text,text,text,text,bytea,text"],
  ["app_private.cas_backfill", "uuid,bigint,bytea,text"],
  ["app_private.read_legacy_code", "uuid,bigint"],
  ["app_private.list_backfill_users", ""],
  ["app_private.revoke_session_family", "bytea,text"],
  ["app_private.rotate_session", "bytea,uuid,uuid,uuid,bytea,timestamptz"],
  ["app_private.validate_session", "bytea"],
  ["app_private.finalize_login", "uuid,bigint,bytea,text,text,uuid,uuid,bytea,timestamptz"],
  ["app_private.begin_login", "bytea,bytea,bytea"],
]);

const publicSignatures = new Map([
  ["public.session_begin_login", "bytea,bytea,bytea"],
  ["public.session_finalize_login", "uuid,bigint,bytea,text,text,uuid,uuid,bytea,timestamptz"],
  ["public.session_validate", "bytea"],
  ["public.session_rotate", "bytea,uuid,uuid,uuid,bytea,timestamptz"],
  ["public.session_revoke", "bytea,text"],
  ["public.consume_endpoint_limit", "text,bytea,integer,integer"],
  ["public.session_create_user", "uuid,text,text,text,text,bytea,text"],
  ["public.session_initialize_credential", "uuid"],
  ["public.session_set_credential", "uuid,bytea,text"],
  ["public.session_backfill_list", ""],
  ["public.session_backfill_read", "uuid,bigint"],
  ["public.session_backfill_cas", "uuid,bigint,bytea,text"],
  ["public.list_safe_users", "uuid,text"],
]);

for (const [name, expectedArguments] of privateSignatures) {
  const header = migration.match(new RegExp(`create function ${name.replace(".", "\\.")}\\(\\s*([\\s\\S]*?)\\)\\s*returns`, "i"));
  assert.ok(header, `missing create signature for ${name}`);
  const actualArguments = header[1]
    .split(",")
    .map((argument) => argument.trim().replace(/^p_[a-z_]+\s+/i, ""))
    .join(",");
  assert.equal(actualArguments, expectedArguments, `created signature drift for ${name}`);
  assert.match(foundationRemoval, new RegExp(`drop function ${name.replace(".", "\\.")}\\(${expectedArguments.replace(/[()]/g, "\\$&")}\\)`, "i"));
}
assert.equal((migration.match(/create function app_private\./gi) ?? []).length, privateSignatures.size);
for (const [name, expectedArguments] of publicSignatures) {
  assert.match(foundationRemoval, new RegExp(`drop function ${name.replace(".", "\\.")}\\(${expectedArguments.replace(/[()]/g, "\\$&")}\\)`, "i"));
}
const lastPublicDrop = Math.max(...[...publicSignatures].map(([name, argumentsList]) =>
  foundationRemoval.search(new RegExp(`drop function ${name.replace(".", "\\.")}\\(${argumentsList.replace(/[()]/g, "\\$&")}\\)`, "i"))));
const firstPrivateDrop = Math.min(...[...privateSignatures].map(([name, argumentsList]) =>
  foundationRemoval.search(new RegExp(`drop function ${name.replace(".", "\\.")}\\(${argumentsList.replace(/[()]/g, "\\$&")}\\)`, "i"))));
assert.ok(lastPublicDrop < firstPrivateDrop, "public facade dependents must be dropped before private routines");
assert.match(migration, /revoke all on all functions in schema app_private from public,anon,authenticated/i);
assert.match(migration, /grant execute on all functions in schema app_private to service_role/i);
assert.match(migration, /alter table app_private\.session_families enable row level security/i);
assert.match(migration, /alter table app_private\.app_sessions force row level security/i);

for (const sql of [cutover, rollback]) {
  assert.match(sql, /\\set ON_ERROR_STOP on/);
  assert.match(sql, /set_config\('app\.approved_release_id', :'release_id', true\)/);
  assert.match(sql, /INVALID_RELEASE_ID/);
  assert.match(sql, /begin;/i);
  assert.match(sql, /commit;/i);
  assert.match(sql, /set local lock_timeout = '5s'/i);
  assert.match(sql, /set local statement_timeout = '60s'/i);
}
assert.match(cutover, /BACKFILL_NOT_7_OF_7/);
assert.match(cutover, /get diagnostics affected = row_count/i);
assert.match(cutover, /CUTOVER_CAS_FAILED/);
assert.match(cutover, /lock table public\.users, app_private\.user_credentials, public\.security_settings/i);
assert.match(rollback, /update app_private\.session_families/i);
assert.match(rollback, /update app_private\.app_sessions/i);
assert.match(rollback, /current_setting\('app\.expected_release_id',true\)/i);
assert.match(rollback, /migration_state='hash_only'[\s\S]*not fallback_enabled[\s\S]*updated_by_release=expected_release/i);
assert.match(rollback, /get diagnostics affected = row_count/i);
assert.match(rollback, /ROLLBACK_CAS_FAILED/i);
assert.ok(rollback.indexOf("ROLLBACK_CAS_FAILED") < rollback.indexOf("update app_private.session_families"), "rollback CAS must precede session revocation");
assert.doesNotMatch(rollback, /grant\s+select.*public\.users/is);
assert.doesNotMatch(rollback, /legacy_code_cutoff_at='infinity'/i);
assert.match(rollback, /interval '72 hours'/i);

assert.match(driftGate, /begin read only/i);
assert.match(driftGate, /raise exception 'REMOTE_APPROVED_BASELINE_MISSING'/i);
assert.match(driftGate, /raise exception 'REMOTE_MIGRATION_INVENTORY_UNEXPECTED/i);
assert.match(driftGate, /version <> '20260408014035'/i);
assert.match(driftGate, /json_build_object/i);
assert.match(driftGate, /json_agg[\s\S]*order by version,name/i);

assert.match(sqlTests, /'app_private\.consume_endpoint_limit\(text,bytea,integer,integer\)'/i);
assert.match(sqlTests, /to_regprocedure\(expected\.signature\)/i);
assert.match(sqlTests, /pg_get_function_identity_arguments/i);
assert.match(sqlTests, /prosecdef/i);
assert.match(sqlTests, /proconfig/i);
assert.match(sqlTests, /service_safe_rows/i);
assert.match(sqlTests, /anon unexpectedly executed list_safe_users/i);
assert.match(sqlTests, /authenticated unexpectedly executed list_safe_users/i);
assert.doesNotMatch(profileHandler, /\.(?:update|insert)\([^;]+?\.select\(/s, "profile writes must not chain select");
assert.doesNotMatch(usersHandler, /\.(?:update|insert)\([^;]+?\.select\(/s, "user writes must not chain select");
assert.match(sessionApi, /protectedRequest\('users'/);
assert.match(userRepository, /this\.sessionApi\.users\(\)/);
assert.doesNotMatch(`${sessionApi}\n${userRepository}`, /list_safe_users|\.from\(['"]users['"]\)/, "browser listing must use the leader-authorized session-users Edge function");
assert.match(backfillHandler, /x-piba-backfill-secret/);
assert.match(backfillHandler, /crypto\.subtle\.digest\("SHA-256"/);
assert.doesNotMatch(backfillHandler, /EXPECTED_AUTHORIZATION|authorization\s*!==\s*expected/i, "backfill authorization must never compare two environment values");
assert.doesNotMatch(refreshIntegration, /["']-c["']\s*,\s*query/);
assert.match(refreshIntegration, /stdin:\s*"piped"/);
assert.match(refreshIntegration, /:'actor'::uuid/);

const collectTestSources = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = resolve(directory, entry.name);
  if (entry.isDirectory()) return collectTestSources(path);
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
});
const testSources = [resolve(root, "src"), resolve(root, "supabase/functions")].flatMap(collectTestSources);
for (const path of testSources) {
  assert.doesNotMatch(readFileSync(path, "utf8"), /\b(?:Deno\.)?(?:test|describe|it)\.only\s*\(/, `focused test is forbidden: ${relative(root, path)}`);
}
const forbidOnlyRun = spawnSync(resolve(root, "node_modules/.bin/vitest"), ["--run", "--no-allowOnly", "--silent=passed-only"], { cwd: root, encoding: "utf8" });
assert.equal(forbidOnlyRun.status, 0, `Vitest forbidOnly execution failed:\n${forbidOnlyRun.stdout}\n${forbidOnlyRun.stderr}`);
const focusedTestRoot = mkdtempSync(resolve(tmpdir(), `piba-focused-test-${process.pid}-`));
try {
  const vitestModule = pathToFileURL(resolve(root, "node_modules/vitest/dist/index.js")).href;
  writeFileSync(resolve(focusedTestRoot, "focused.test.mjs"), `import { test } from ${JSON.stringify(vitestModule)};\ntest.only('must fail', () => {});\n`);
  const rejectedFocusedRun = spawnSync(resolve(root, "node_modules/.bin/vitest"), ["--root", focusedTestRoot, "--run", "--no-allowOnly"], { cwd: root, encoding: "utf8" });
  assert.notEqual(rejectedFocusedRun.status, 0, "Vitest accepted a focused test under the persistent CI command");
  assert.match(`${rejectedFocusedRun.stdout}\n${rejectedFocusedRun.stderr}`, /only|focused/i, "focused-test rejection did not produce evidence");
} finally {
  rmSync(focusedTestRoot, { recursive: true, force: true });
}

const evidenceFiles = [
  "release-manifest.schema.json", "release-manifest.template.json", "phase-receipt.schema.json",
  "incident-receipt.schema.json", "incident.receipt.template.json",
  "foundation-deploy.receipt.template.json", "function-deploy.receipt.template.json",
  "client-deploy.receipt.template.json", "backfill.receipt.template.json",
  "cutover.receipt.template.json", "rollback.receipt.template.json",
];
const evidence = Object.fromEntries(evidenceFiles.map((file) => [file, JSON.parse(readFileSync(resolve(evidenceDirectory, file), "utf8"))]));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, allowUnionTypes: true });
addFormats(ajv);
const validateManifestSchema = ajv.compile(evidence["release-manifest.schema.json"]);
const validateReceiptSchema = ajv.compile(evidence["phase-receipt.schema.json"]);
const validateIncidentSchema = ajv.compile(evidence["incident-receipt.schema.json"]);
const validateAuthorizationSchema = ajv.compile({ $ref: "https://piba.local/schemas/secure-session-release-manifest.json#/$defs/deploymentAuthorization" });
const validateDetectionSchema = ajv.compile({ $ref: "https://piba.local/schemas/secure-session-release-manifest.json#/$defs/productionDetectionEvidence" });
const assertSchemaValid = (validate, value, label) => assert.ok(validate(value), `${label}: ${ajv.errorsText(validate.errors)}`);
const assertSchemaInvalid = (validate, value, label) => assert.equal(validate(value), false, `${label} unexpectedly passed schema validation`);
const manifestTemplate = evidence["release-manifest.template.json"];
const receipts = evidenceFiles.filter((file) => /^(?:foundation-deploy|function-deploy|client-deploy|backfill|cutover|rollback)\.receipt\.template\.json$/.test(file)).map((file) => evidence[file]);
assert.deepEqual(receipts.map(({ phase }) => phase).sort(), ["backfill", "client-deploy", "cutover", "foundation-deploy", "function-deploy", "rollback"]);
assert.equal(new Set(receipts.map(({ actorRole }) => actorRole)).size, receipts.length, "each rollout phase must name its distinct accountable role");
for (const receipt of receipts) {
  for (const field of ["manifestSha256", "inputSha256", "outputSha256"]) assert.match(receipt[field], /^[0-9a-f]{64}$/);
}

const sha256 = digest("secure-session-fixture");
const gitSha = digest("secure-session-git-fixture").slice(0, 40);
const isPlaceholder = (value) => typeof value === "string" && (
  /^(?:REPLACE(?:_|$)|TBD(?:_|$)|TODO(?:_|$)|CHANGEME(?:_|$)|YOUR[_-]|EXAMPLE(?:_|$)|<[^>]+>$)/i.test(value)
  || /^1970-01-01T/.test(value)
  || (/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(value) && new Set(value).size === 1)
);
const assertNoPlaceholders = (value, label) => {
  if (Array.isArray(value)) return value.forEach((item) => assertNoPlaceholders(item, label));
  if (value && typeof value === "object") return Object.values(value).forEach((item) => assertNoPlaceholders(item, label));
  assert.ok(!isPlaceholder(value), `${label} contains a placeholder or fake sentinel`);
};
const assertCompatibilityWindow = (rollbackAt, compatibilityEndsAt, label) => {
  const rollbackTime = Date.parse(rollbackAt);
  const compatibilityTime = Date.parse(compatibilityEndsAt);
  assert.ok(Number.isFinite(rollbackTime) && Number.isFinite(compatibilityTime), `${label} timestamps must parse`);
  assert.ok(compatibilityTime > rollbackTime, `${label} must end after rollback`);
  assert.ok(compatibilityTime <= rollbackTime + 72 * 60 * 60 * 1000, `${label} must end within 72 hours of rollback`);
};
const completedPhaseFixtures = ["foundation-deploy", "function-deploy", "client-deploy", "backfill"].map((phase, index) => {
  const receipt = structuredClone(evidence[`${phase}.receipt.template.json`]);
  Object.assign(receipt, {
    releaseId: "secure-sessions-20260713", startedAt: `2026-07-13T00:${String(index * 10).padStart(2, "0")}:00Z`, completedAt: `2026-07-13T00:${String((index + 1) * 10).padStart(2, "0")}:00Z`,
    actor: `${phase}-operator-a`, manifestSha256: digest(`${phase}-manifest`), inputSha256: digest(`${phase}-input`), outputSha256: digest(`${phase}-output`),
  });
  if (phase === "foundation-deploy") receipt.evidence.migrationListSha256 = digest("migration-list");
  if (phase === "function-deploy") {
    receipt.evidence.functionVersion = "functions-git-a1b2c3d";
    receipt.evidence.sourceBundles = receipt.evidence.sourceBundles.map((bundle) => ({ ...bundle, sourceSha256: digest(bundle.name) }));
  }
  if (phase === "client-deploy") Object.assign(receipt.evidence, { clientVersion: "dpl_current123", providerDeploymentId: "dpl_12345678", immutableUrl: "https://piba-immutable.vercel.app", assetManifestSha256: digest("client-assets") });
  if (phase === "backfill") Object.assign(receipt.evidence, { expectedProjectRef: "staging-project-ref", expectedSupabaseUrl: "https://staging-project-ref.supabase.co" });
  assertSchemaValid(validateReceiptSchema, receipt, `${phase} receipt schema`);
  const wrongRole = structuredClone(receipt);
  wrongRole.actorRole = "release-owner";
  assertSchemaInvalid(validateReceiptSchema, wrongRole, `${phase} wrong actor role`);
  const wrongStatus = structuredClone(receipt);
  wrongStatus.status = "failed";
  assertSchemaInvalid(validateReceiptSchema, wrongStatus, `${phase} wrong status`);
  if (phase === "client-deploy") {
    const missingProxyEnvironment = structuredClone(receipt);
    delete missingProxyEnvironment.evidence.proxyEnvironmentVerified;
    assertSchemaInvalid(validateReceiptSchema, missingProxyEnvironment, "client deploy without verified HttpOnly proxy environment");
  }
  return receipt;
});
const crossPhaseReceipt = structuredClone(completedPhaseFixtures.find(({ phase }) => phase === "function-deploy"));
crossPhaseReceipt.phase = "foundation-deploy";
crossPhaseReceipt.actorRole = "database-operator";
assertSchemaInvalid(validateReceiptSchema, crossPhaseReceipt, "cross-phase receipt evidence");
const criticalArtifacts = [
  ".github/workflows/secure-sessions.yml", "dist.tar.gz", "ops/secure-sessions/cutover.sql",
  "ops/secure-sessions/rollback.sql", "scripts/verify-secure-session-foundation.mjs",
  "supabase/functions/deno.lock", "supabase/migrations/20260408020000_secure_session_foundation.sql",
].sort();
const validateManifest = (manifest) => {
  assertSchemaValid(validateManifestSchema, manifest, "release manifest schema");
  assertNoPlaceholders(manifest, "release manifest");
  assert.deepEqual(manifest.artifacts.map(({ path }) => path).sort(), criticalArtifacts, "critical artifact inventory mismatch");
  assert.equal(new Set(manifest.artifacts.map(({ path }) => path)).size, criticalArtifacts.length, "critical artifacts must be unique");
  assert.deepEqual(manifest.stagingBootstrap, {
    classification: "non-production-session-staging-input",
    allowedEnvironment: "staging",
    approvedProjectRef: approvedStagingProjectRef,
    productionEligible: false,
    rollbackMutation: false,
    path: "ops/secure-sessions/staging/bootstrap.sql",
    sha256: manifest.stagingBootstrap.sha256,
    verificationPath: "ops/secure-sessions/staging/verify-bootstrap.sql",
    verificationSha256: manifest.stagingBootstrap.verificationSha256,
  }, "staging bootstrap classification drifted");
  assert.equal(manifest.productionDetection.evidence.projectRef, manifest.supabaseProjectRef, "telemetry evidence project ref does not match manifest");
  assert.equal(manifest.productionDetection.evidence.checkedOrigin, manifest.clientDeploymentUrl, "telemetry checked origin does not match the manifest deployment URL");
  assert.deepEqual(manifest.priorFunctions.bundles.map(({ name }) => name).sort(), ["backfill", "session-login", "session-logout", "session-profile", "session-refresh", "session-users"]);
  assert.deepEqual(manifest.functionBundles.map(({ name }) => name).sort(), ["backfill", "session-login", "session-logout", "session-profile", "session-refresh", "session-users"]);
  assert.deepEqual(manifest.productionDetection.evidence.endpointResults.map(({ endpoint }) => endpoint).sort(), [...productionEndpoints].sort(), "production detection endpoint inventory mismatch");
  assertCompatibilityWindow(manifest.rollbackAt, manifest.compatibilityEndsAt, "manifest compatibility window");
};
const fixtureRoot = mkdtempSync(resolve(tmpdir(), `piba-secure-session-${process.pid}-`));
process.on("exit", () => existsSync(fixtureRoot) && rmSync(fixtureRoot, { recursive: true, force: true }));
const runnerMockBin = resolve(fixtureRoot, "runner-bin");
const runnerStatePath = resolve(fixtureRoot, "runner-state");
const runnerLogPath = resolve(fixtureRoot, "runner-log");
mkdirSync(runnerMockBin, { recursive: true });
const writeExecutable = (name, source) => {
  const path = resolve(runnerMockBin, name);
  writeFileSync(path, source);
  chmodSync(path, 0o755);
};
writeExecutable("node", "#!/usr/bin/env bash\nexit 0\n");
writeExecutable("psql", `#!/usr/bin/env bash
set -euo pipefail
state="$(cat "$MOCK_RUNNER_STATE")"
if [[ "$*" == *"pg_stat_ssl"* ]]; then printf 't\\n'; exit 0; fi
if [[ "$*" == *"select count(*)::text"* ]]; then
  case "$state" in
    fresh) printf '0|f|f|0\\n' ;;
    contradictory) printf '3|f|f|0\\n' ;;
    bootstrapped|migrations-1) printf '7|f|f|0\\n' ;;
    *) printf '7|t|t|4\\n' ;;
  esac
  exit 0
fi
if [[ "$*" == *"verify-bootstrap.sql"* ]]; then printf '%s\\n' "$state"; printf 'verify\\n' >>"$MOCK_RUNNER_LOG"; exit 0; fi
if [[ "$*" == *"staging/bootstrap.sql"* ]]; then printf 'bootstrapped\\n' >"$MOCK_RUNNER_STATE"; printf 'bootstrap\\n' >>"$MOCK_RUNNER_LOG"; exit 0; fi
exit 1
`);
writeExecutable("supabase", `#!/usr/bin/env bash
set -euo pipefail
printf 'push\\n' >>"$MOCK_RUNNER_LOG"
if [[ "\${MOCK_PUSH_FAIL:-0}" == '1' ]]; then exit 1; fi
printf '%s\\n' "\${MOCK_PUSH_RESULT_STATE:-complete}" >"$MOCK_RUNNER_STATE"
`);
const runMockedStagingRunner = (state, { pushFail = false } = {}) => {
  writeFileSync(runnerStatePath, `${state}\n`);
  writeFileSync(runnerLogPath, "");
  const result = spawnSync("bash", [stagingBootstrapRunnerPath], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${runnerMockBin}:${process.env.PATH}`,
      PIBA_DEPLOY_ENV: "staging",
      PIBA_STAGING_PROJECT_REF: approvedStagingProjectRef,
      PIBA_STAGING_DATABASE_URL: `postgresql://postgres:fixture@db.${approvedStagingProjectRef}.supabase.co:5432/postgres?sslmode=require`,
      PIBA_RELEASE_MANIFEST: "fixture-manifest.json",
      PIBA_GIT_COMMIT: "0123456789abcdef0123456789abcdef01234567",
      GH_TOKEN: "fixture-github-token",
      GITHUB_REPOSITORY: "piba/repository",
      SUPABASE_ACCESS_TOKEN: "fixture-supabase-token",
      MOCK_RUNNER_STATE: runnerStatePath,
      MOCK_RUNNER_LOG: runnerLogPath,
      MOCK_PUSH_FAIL: pushFail ? "1" : "0",
      MOCK_PUSH_RESULT_STATE: "complete",
    },
  });
  return { result, state: readFileSync(runnerStatePath, "utf8").trim(), log: readFileSync(runnerLogPath, "utf8") };
};
for (const initial of ["fresh", "bootstrapped", "migrations-1", "migrations-2", "migrations-3", "complete"]) {
  const run = runMockedStagingRunner(initial);
  assert.equal(run.result.status, 0, `staging runner failed legal state ${initial}: ${run.result.stderr}`);
  assert.equal(run.state, "complete", `staging runner did not complete from ${initial}`);
  assert.equal((run.log.match(/^push$/gm) ?? []).length, initial === "complete" ? 0 : 1, `staging runner push count drifted for ${initial}`);
  assert.equal((run.log.match(/^bootstrap$/gm) ?? []).length, initial === "fresh" ? 1 : 0, `staging runner bootstrap count drifted for ${initial}`);
}
const failedResume = runMockedStagingRunner("migrations-1", { pushFail: true });
assert.equal(failedResume.result.status, 4, "staging runner did not stop after one failed push");
assert.equal(failedResume.state, "migrations-1", "failed staging push changed recognized state");
assert.equal((failedResume.log.match(/^push$/gm) ?? []).length, 1, "failed staging push retried blindly");
const resumed = runMockedStagingRunner(failedResume.state);
assert.equal(resumed.result.status, 0, `staging runner did not resume: ${resumed.result.stderr}`);
assert.equal(resumed.state, "complete");
const contradictoryRunner = runMockedStagingRunner("contradictory");
assert.equal(contradictoryRunner.result.status, 3, "staging runner accepted contradictory state");
assert.doesNotMatch(contradictoryRunner.log, /bootstrap|push/, "contradictory state reached a mutation");
const repositoryFile = (baseDirectory, path, label) => {
  const absolutePath = resolve(baseDirectory, path);
  const repositoryRelative = relative(baseDirectory, absolutePath);
  assert.ok(repositoryRelative && !repositoryRelative.startsWith("..") && !isAbsolute(repositoryRelative), `${label} must stay within the evidence root`);
  assert.ok(existsSync(absolutePath), `${label} does not exist: ${path}`);
  return absolutePath;
};
const assertFileHash = (baseDirectory, path, expected, label) => {
  assert.equal(digest(readFileSync(repositoryFile(baseDirectory, path, label))), expected, `${label} checksum mismatch: ${path}`);
};
const validateProviderAuthorization = (authorization, environment, gitCommit) => {
  assert.equal(authorization.environment, environment, "deployment authorization environment mismatch");
  assert.equal(authorization.commit, gitCommit, "deployment authorization commit mismatch");
  assert.deepEqual(authorization.approvals.map(({ role }) => role).sort(), ["release-owner", "security"]);
  assert.equal(new Set(authorization.approvals.map(({ actor }) => actor)).size, 2, "GitHub approval actors must be distinct");
  assert.equal(new Set(authorization.approvals.map(({ reviewId }) => reviewId)).size, 2, "GitHub approval reviews must be distinct");
};
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const githubApi = async (path, { token, fetchImpl = fetch, sleep = wait } = {}) => {
  let lastStatus = "network failure";
  for (const delay of [0, 250, 1_000]) {
    if (delay) await sleep(delay);
    try {
      const response = await fetchImpl(`https://api.github.com${path}`, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "piba-secure-session-verifier",
        },
      });
      lastStatus = `HTTP ${response.status}`;
      if (response.ok) return { value: await response.json(), link: response.headers.get("link") };
      if (response.status !== 429 && response.status < 500) break;
    } catch {
      lastStatus = "network failure";
    }
  }
  throw new Error(`GitHub provider request failed closed after bounded retries: ${path} (${lastStatus})`);
};
const githubPages = async (path, options) => {
  const values = [];
  let next = path;
  for (let page = 0; next && page < 10; page++) {
    const response = await githubApi(next, options);
    assert.ok(Array.isArray(response.value), `GitHub provider returned a non-list response: ${path}`);
    values.push(...response.value);
    const nextUrl = response.link?.split(",").map((entry) => entry.trim()).find((entry) => /rel="next"/.test(entry))?.match(/<https:\/\/api\.github\.com([^>]+)>/)?.[1];
    next = nextUrl ?? null;
  }
  assert.ok(!next, `GitHub provider pagination exceeded the safety limit: ${path}`);
  return values;
};
const githubRepositoryBytes = async (api, path, ref) => {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const content = (await api(`/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`)).value;
  assert.equal(content.type ?? "file", "file", `provider repository path is not a file: ${path}`);
  assert.ok(content.sha, `provider repository content is missing a blob SHA: ${path}`);
  if (content.encoding === "base64" && typeof content.content === "string" && content.content.replace(/\s/g, "")) return Buffer.from(content.content.replace(/\s/g, ""), "base64");
  const blob = (await api(`/git/blobs/${content.sha}`)).value;
  assert.equal(blob.encoding, "base64", `provider repository blob encoding mismatch: ${path}`);
  assert.ok(typeof blob.content === "string", `provider repository blob content is missing: ${path}`);
  return Buffer.from(blob.content.replace(/\s/g, ""), "base64");
};
const requestJson = async (url, { fetchImpl = fetch, sleep = wait, attempts = 3, ...options } = {}) => {
  let lastStatus = "network failure";
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await sleep([250, 1_000][attempt - 1]);
    try {
      const response = await fetchImpl(url, options);
      lastStatus = `HTTP ${response.status}`;
      if (response.ok) return response.json();
      if (response.status !== 429 && response.status < 500) break;
    } catch {
      lastStatus = "network failure";
    }
  }
  throw new Error(`request failed closed after bounded retries: ${url} (${lastStatus})`);
};
const runProxySynthetics = async ({ origin, fetchImpl = fetch, now = () => new Date(), clock = () => performance.now() }) => {
  const productionOrigin = new URL(origin);
  assert.equal(productionOrigin.protocol, "https:", "PRODUCTION_ORIGIN must use HTTPS");
  assert.ok(!productionOrigin.username && !productionOrigin.password && productionOrigin.pathname === "/" && !productionOrigin.search && !productionOrigin.hash, "PRODUCTION_ORIGIN must be an origin without credentials or a path");
  const probes = [
    { name: "invalid-login", method: "POST", path: "/api/session/login", body: "{}" },
    { name: "unauthenticated-current-user", method: "GET", path: "/api/session/current-user" },
  ];
  const results = [];
  const excludedRequestIds = [];
  for (const probe of probes) {
    const started = clock();
    const response = await fetchImpl(new URL(probe.path, productionOrigin), {
      method: probe.method,
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      headers: { accept: "application/json", origin: productionOrigin.origin, ...(probe.body ? { "content-type": "application/json" } : {}) },
      ...(probe.body ? { body: probe.body } : {}),
    });
    const durationMs = clock() - started;
    assert.ok([400, 401, 403, 429].includes(response.status), `proxy synthetic ${probe.name} did not produce a safe auth rejection: HTTP ${response.status}`);
    assert.ok(durationMs < 750, `proxy synthetic ${probe.name} exceeded 750ms: ${durationMs}`);
    const requestId = response.headers.get("x-request-id") ?? "";
    assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, `proxy synthetic ${probe.name} returned no valid request ID`);
    excludedRequestIds.push(requestId);
    results.push({ name: probe.name, method: probe.method, path: probe.path, status: response.status, durationMs, checkedAt: now().toISOString(), decision: "pass" });
  }
  assert.equal(new Set(excludedRequestIds).size, excludedRequestIds.length, "proxy synthetic request IDs must be unique");
  return { results, excludedRequestIds };
};
const productionTelemetryQuery = () => `select json_value(event_message, '$.endpoint') as endpoint, cast(json_value(event_message, '$.status') as int64) as status, cast(json_value(event_message, '$.duration_ms') as float64) as duration_ms, json_value(event_message, '$.request_id') as request_id from function_logs where json_value(event_message, '$.endpoint') in ('login','refresh','logout','current-user','list-users','create-user','update-profile') limit 1000`;
const summarizeProductionTelemetry = (rows, excludedRequestIds) => {
  assert.ok(Array.isArray(rows), "malformed telemetry response");
  assert.ok(rows.length < 1000, "telemetry result reached the provider row cap");
  assert.equal(excludedRequestIds.length, 2, "production telemetry requires both synthetic request IDs");
  const excluded = new Set(excludedRequestIds);
  assert.equal(excluded.size, excludedRequestIds.length, "production telemetry exclusion IDs must be unique");
  const grouped = new Map(productionEndpoints.map((endpoint) => [endpoint, []]));
  for (const row of rows) {
    assert.ok(row && typeof row === "object" && productionEndpoints.includes(row.endpoint), "malformed telemetry event endpoint");
    const status = Number(row.status);
    const durationMs = Number(row.duration_ms);
    const requestId = row.request_id;
    assert.ok(Number.isInteger(status) && status >= 100 && status <= 599, "malformed telemetry event status");
    assert.ok(Number.isFinite(durationMs) && durationMs >= 0, "malformed telemetry event duration");
    assert.ok(requestId === null || requestId === undefined || typeof requestId === "string", "malformed telemetry request ID");
    if (requestId && excluded.has(requestId)) continue;
    grouped.get(row.endpoint).push({ status, durationMs });
  }
  return productionEndpoints.map((endpoint) => {
    const events = grouped.get(endpoint);
    const sampleCount = events.length;
    const durations = events.map(({ durationMs }) => durationMs).sort((a, b) => a - b);
    const ratio = (predicate) => sampleCount === 0 ? 0 : events.filter(predicate).length / sampleCount;
    return {
      endpoint,
      sample_count: sampleCount,
      unexpected_error_rate: ratio(({ status }) => status >= 500),
      non_success_rate: ratio(({ status }) => status >= 400),
      auth_throttle_rate: ratio(({ status }) => status === 401 || status === 429),
      p95_ms: sampleCount === 0 ? 0 : durations[Math.ceil(sampleCount * 0.95) - 1],
    };
  });
};
const upsertProductionIncident = async ({ env, action, evidenceSha256, fetchImpl = fetch, sleep = wait }) => {
  const title = "[secure-session-slo] production detection failure";
  const runUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const body = `Stable key: secure-session-production-detection\n\nAction: ${action}\nEvidence SHA-256: ${evidenceSha256}\nWorkflow: ${runUrl}\nCommit: ${env.GITHUB_SHA}`;
  const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${env.GH_TOKEN}`, "content-type": "application/json", "x-github-api-version": "2022-11-28" };
  const apiRoot = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
  let issue;
  try {
    const query = encodeURIComponent(`repo:${env.GITHUB_REPOSITORY} is:issue is:open in:title \"${title}\"`);
    const search = await requestJson(`https://api.github.com/search/issues?q=${query}`, { fetchImpl, sleep, headers });
    issue = search.items?.find((candidate) => candidate.title === title);
  } catch {
    issue = undefined;
  }
  const payload = JSON.stringify({ title, body, assignees: [env.INCIDENT_OWNER], labels: env.INCIDENT_LABELS.split(",").map((label) => label.trim()).filter(Boolean) });
  if (issue) {
    try {
      await requestJson(`${apiRoot}/issues/${issue.number}`, { fetchImpl, sleep, method: "PATCH", headers, body: payload });
      return { operation: "updated", issueNumber: issue.number };
    } catch {
      await requestJson(`${apiRoot}/issues/${issue.number}/comments`, { fetchImpl, sleep, method: "POST", headers, body: JSON.stringify({ body }) });
      return { operation: "comment-fallback", issueNumber: issue.number };
    }
  }
  const created = await requestJson(`${apiRoot}/issues`, { fetchImpl, sleep, method: "POST", headers, body: payload });
  return { operation: "created", issueNumber: created.number };
};
const runProductionDetection = async ({ env = process.env, fetchImpl = fetch, sleep = wait, now = new Date(), writeFile = writeFileSync }) => {
  for (const name of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "GH_TOKEN", "GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA", "GITHUB_ACTOR", "GITHUB_SERVER_URL", "RUNNER_TEMP", "INCIDENT_OWNER", "INCIDENT_LABELS", "PRODUCTION_ORIGIN"]) assert.ok(env[name], `missing ${name}`);
  const end = new Date(now);
  end.setUTCSeconds(0, 0);
  const start = new Date(end.getTime() - 6 * 60_000);
  let source = "";
  let evaluation = { action: "pipeline-failure", evidenceSha256: "unavailable" };
  try {
    const synthetics = await runProxySynthetics({ origin: env.PRODUCTION_ORIGIN, fetchImpl, now: () => new Date(now) });
    const telemetryUrl = new URL(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/analytics/endpoints/logs.all`);
    telemetryUrl.searchParams.set("sql", productionTelemetryQuery());
    telemetryUrl.searchParams.set("iso_timestamp_start", start.toISOString());
    telemetryUrl.searchParams.set("iso_timestamp_end", end.toISOString());
    const telemetry = await requestJson(telemetryUrl, { fetchImpl, sleep, headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } });
    const rows = telemetry.result ?? telemetry;
    source = JSON.stringify(summarizeProductionTelemetry(rows, synthetics.excludedRequestIds));
    evaluation = evaluateProductionSlo(source);
    writeFile(resolve(env.RUNNER_TEMP, "secure-session-evaluation.json"), `${JSON.stringify(evaluation)}\n`);
    if (evaluation.exitStatus !== 0) throw new Error(`production SLO action: ${evaluation.action}`);
    const run = await githubApi(`/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`, { token: env.GH_TOKEN, fetchImpl, sleep });
    const workflowSha256 = digest(readFileSync(resolve(root, ".github/workflows/secure-sessions.yml")));
    const completedAt = new Date(now).toISOString();
    const receipt = { provider: "github", runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT), runUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`, createdAt: run.value.created_at, environment: "production", actor: env.GITHUB_ACTOR, commit: env.GITHUB_SHA, projectRef: env.SUPABASE_PROJECT_REF, checkedOrigin: new URL(env.PRODUCTION_ORIGIN).origin, workflowSha256, configuredSecretNames: ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"], healthObservedAt: end.toISOString(), completedAt, proxySyntheticResults: synthetics.results, endpointResults: evaluation.endpointResults, status: "success" };
    writeFile(resolve(env.RUNNER_TEMP, "production-detection.receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    return { evaluation, receipt };
  } catch (error) {
    await upsertProductionIncident({ env, action: evaluation.action, evidenceSha256: evaluation.evidenceSha256, fetchImpl, sleep });
    throw error;
  }
};

if (process.argv[2] === "--run-production-detection") {
  try {
    const result = await runProductionDetection({});
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "production detection failed");
    process.exit(1);
  }
}
const validateGithubProvider = async (manifest, { repository, token, now, fetchImpl, sleep, manifestPath, manifestSource, baseDirectory = root, securityTeamSlug = process.env.SECURITY_APPROVER_TEAM_SLUG, requireProductionDetection = true }) => {
  assert.ok(token, "provider verification requires GH_TOKEN");
  assert.match(repository ?? "", /^[^/]+\/[^/]+$/, "provider verification requires GITHUB_REPOSITORY or --repository owner/repo");
  const authorization = manifest.deploymentAuthorization;
  const detection = manifest.productionDetection.evidence;
  assert.equal(authorization.repository.toLowerCase(), repository.toLowerCase(), "manifest authorization repository mismatch");
  const api = (path) => githubApi(`/repos/${repository}${path}`, { token, fetchImpl, sleep });
  const providerManifestSource = await githubRepositoryBytes(api, manifestPath, manifest.gitCommit);
  assert.ok(providerManifestSource.equals(manifestSource), "local release manifest differs from the exact provider blob at the approved commit");
  const providerBindings = [
    ...manifest.artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
    ...manifest.functionBundles.map(({ location: path, sourceSha256: sha256 }) => ({ path, sha256 })),
    { path: manifest.stagingBootstrap.path, sha256: manifest.stagingBootstrap.sha256 },
    { path: manifest.stagingBootstrap.verificationPath, sha256: manifest.stagingBootstrap.verificationSha256 },
  ];
  for (const binding of providerBindings) {
    const providerSource = await githubRepositoryBytes(api, binding.path, manifest.gitCommit);
    assert.equal(digest(providerSource), binding.sha256, `provider repository checksum mismatch at approved commit: ${binding.path}`);
    assert.ok(providerSource.equals(readFileSync(repositoryFile(baseDirectory, binding.path, "provider-bound artifact"))), `local artifact substitution detected: ${binding.path}`);
  }
  const repositoryMetadata = (await api("")).value;
  const pull = (await api(`/pulls/${authorization.pullRequestNumber}`)).value;
  assert.equal(pull.number, authorization.pullRequestNumber, "provider pull request number mismatch");
  assert.equal(pull.head?.sha, manifest.gitCommit, "provider pull request head SHA mismatch");
  const author = pull.user?.login?.toLowerCase();
  assert.ok(author, "provider pull request author is missing");
  const reviews = await githubPages(`/repos/${repository}/pulls/${authorization.pullRequestNumber}/reviews?per_page=100`, { token, fetchImpl, sleep });
  for (const approval of authorization.approvals) {
    const actor = approval.actor.toLowerCase();
    assert.notEqual(actor, author, `self-authored approval is forbidden: ${approval.actor}`);
    const review = reviews.find(({ id }) => id === approval.reviewId);
    assert.ok(review, `provider review is missing: ${approval.reviewId}`);
    assert.equal(review.user?.login?.toLowerCase(), actor, `provider review actor mismatch: ${approval.reviewId}`);
    assert.equal(review.state, "APPROVED", `provider review is not approved: ${approval.reviewId}`);
    assert.equal(review.commit_id, manifest.gitCommit, `provider review is stale: ${approval.reviewId}`);
    assert.equal(Date.parse(review.submitted_at), Date.parse(approval.approvedAt), `provider review timestamp mismatch: ${approval.reviewId}`);
    const actorReviews = reviews.filter(({ user }) => user?.login?.toLowerCase() === actor && user?.login).sort((left, right) => Date.parse(right.submitted_at ?? 0) - Date.parse(left.submitted_at ?? 0) || right.id - left.id);
    assert.equal(actorReviews[0]?.id, review.id, `provider review was superseded or dismissed: ${approval.reviewId}`);
    const permission = (await api(`/collaborators/${encodeURIComponent(approval.actor)}/permission`)).value.permission;
    if (approval.role === "security") assert.equal(permission, "admin", `security approver must have admin permission: ${approval.actor}`);
    else assert.ok(["push", "maintain", "admin"].includes(permission), `release owner lacks push permission: ${approval.actor}`);
    if (approval.role === "security" && securityTeamSlug) {
      const owner = repository.split("/")[0];
      const membership = (await githubApi(`/orgs/${owner}/teams/${encodeURIComponent(securityTeamSlug)}/memberships/${encodeURIComponent(approval.actor)}`, { token, fetchImpl, sleep })).value;
      assert.equal(membership.state, "active", `security approver is not an active member of ${securityTeamSlug}`);
    }
  }
  assert.equal(new Set(authorization.approvals.map(({ actor }) => actor.toLowerCase())).size, 2, "provider approval actors must be distinct case-insensitively");

  const authorizationRun = (await api(`/actions/runs/${authorization.runId}`)).value;
  assert.equal(authorizationRun.id, authorization.runId, "authorization run ID mismatch");
  assert.equal(authorizationRun.html_url, authorization.runUrl, "authorization run URL mismatch");
  assert.equal(authorizationRun.head_sha, manifest.gitCommit, "authorization run SHA mismatch");
  assert.equal(authorizationRun.workflow_id, authorization.workflowId, "authorization workflow ID mismatch");
  assert.equal(authorizationRun.path, authorization.workflowPath, "authorization workflow path mismatch");
  assert.equal(authorizationRun.event, authorization.event, "authorization run event mismatch");
  assert.equal(`refs/heads/${authorizationRun.head_branch}`, authorization.ref, "authorization run ref mismatch");
  assert.equal(authorizationRun.head_branch, repositoryMetadata.default_branch, "authorization run did not use the default branch");
  assert.equal(authorizationRun.run_attempt, authorization.runAttempt, "authorization run attempt mismatch");
  assert.equal(Date.parse(authorizationRun.created_at), Date.parse(authorization.createdAt), "authorization run creation time mismatch");
  assert.equal(Date.parse(authorizationRun.updated_at), Date.parse(authorization.completedAt), "authorization run completion time mismatch");
  assert.ok(Date.parse(authorization.createdAt) <= Date.parse(authorization.completedAt), "authorization run timestamps are not chronological");
  assert.equal(authorizationRun.conclusion, "success", "authorization run did not succeed");
  assert.ok(now - Date.parse(authorizationRun.updated_at) >= 0 && now - Date.parse(authorizationRun.updated_at) <= 10 * 60_000, "authorization run is not fresh");
  assert.equal(authorization.validateProductionCutover, true, "authorization receipt must bind validate_production_cutover=true");
  assert.equal(authorization.jobAttempt, authorization.runAttempt, "authorization job attempt must equal the approved run attempt");
  const authorizationJobs = await githubPages(`/repos/${repository}/actions/runs/${authorization.runId}/attempts/${authorization.runAttempt}/jobs?per_page=100`, { token, fetchImpl, sleep });
  const cutoverJobs = authorizationJobs.filter(({ name }) => name === "validate-production-cutover");
  assert.equal(cutoverJobs.length, 1, "provider run must contain exactly one validate-production-cutover job");
  const cutoverJob = cutoverJobs[0];
  assert.equal(cutoverJob.id, authorization.jobId, "authorization job ID mismatch");
  assert.equal(cutoverJob.html_url, authorization.jobUrl, "authorization job URL mismatch");
  assert.equal(cutoverJob.run_attempt ?? authorization.runAttempt, authorization.jobAttempt, "authorization job attempt mismatch");
  assert.equal(cutoverJob.conclusion, "success", "validate-production-cutover job did not succeed");
  const authorizationWorkflow = (await api(`/actions/workflows/${authorization.workflowId}`)).value;
  assert.equal(authorizationWorkflow.id, authorization.workflowId, "authorization workflow metadata ID mismatch");
  assert.equal(authorizationWorkflow.path, authorization.workflowPath, "authorization workflow metadata path mismatch");
  const deployment = (await api(`/deployments/${authorization.deploymentId}`)).value;
  assert.equal(deployment.id, authorization.deploymentId, "provider deployment ID mismatch");
  assert.equal(deployment.sha, manifest.gitCommit, "provider deployment SHA mismatch");
  assert.equal(deployment.environment, authorization.environment, "provider deployment environment mismatch");
  assert.equal(deployment.payload?.web_url ?? deployment.environment_url, manifest.clientDeploymentUrl, "provider deployment URL does not match manifest client deployment");
  const deploymentStatuses = (await api(`/deployments/${authorization.deploymentId}/statuses?per_page=100`)).value;
  assert.ok(Array.isArray(deploymentStatuses) && deploymentStatuses[0]?.state === "success", "provider deployment has no latest successful status");
  assert.equal(deploymentStatuses[0].id, authorization.deploymentStatusId, "provider deployment status ID mismatch");
  assert.equal(deploymentStatuses[0].environment, authorization.environment, "provider deployment status environment mismatch");
  assert.equal(deploymentStatuses[0].log_url, authorization.runUrl, "provider deployment status is not bound to the authorization run");
  assert.equal(deploymentStatuses[0].environment_url, manifest.clientDeploymentUrl, "provider deployment status URL does not match manifest client deployment");

  if (!requireProductionDetection) return;
  const run = (await api(`/actions/runs/${detection.runId}`)).value;
  assert.equal(run.id, detection.runId, "production detection run ID mismatch");
  assert.equal(run.conclusion, "success", "production detection run did not succeed");
  assert.equal(run.head_sha, manifest.gitCommit, "production detection run SHA mismatch");
  assert.equal(run.html_url, detection.runUrl, "production detection run URL mismatch");
  assert.equal(run.run_attempt, detection.runAttempt, "production detection run attempt mismatch");
  assert.equal(Date.parse(run.created_at), Date.parse(detection.createdAt), "production detection creation time mismatch");
  assert.equal(run.actor?.login, detection.actor, "production detection actor mismatch");
  assert.ok(["schedule", "workflow_dispatch"].includes(run.event), "production detection event is not trusted");
  assert.equal(run.head_branch, repositoryMetadata.default_branch, "production detection did not run on the default branch");
  assert.equal(run.head_repository?.full_name?.toLowerCase(), repository.toLowerCase(), "production detection repository mismatch");
  assert.equal(run.path, ".github/workflows/secure-sessions.yml", "production detection workflow path mismatch");
  const workflowMetadata = (await api(`/actions/workflows/${run.workflow_id}`)).value;
  assert.equal(workflowMetadata.name, "Secure sessions", "production detection workflow name mismatch");
  assert.equal(workflowMetadata.path, ".github/workflows/secure-sessions.yml", "production detection workflow metadata path mismatch");
  const providerWorkflowSource = await githubRepositoryBytes(api, ".github/workflows/secure-sessions.yml", manifest.gitCommit);
  const providerWorkflowSha256 = digest(providerWorkflowSource);
  assert.equal(providerWorkflowSha256, manifest.productionDetection.configurationSha256, "provider production workflow checksum mismatch");
  assert.equal(providerWorkflowSha256, detection.workflowSha256, "provider detection receipt workflow checksum mismatch");
  assert.match(providerWorkflowSource.toString("utf8"), /production-detection:[\s\S]*?environment:\s*production/, "provider workflow does not bind production detection to the production environment");
  assert.match(providerWorkflowSource.toString("utf8"), /validate-production-cutover:[\s\S]*?github\.event_name\s*==\s*'workflow_dispatch'[\s\S]*?inputs\.validate_production_cutover[\s\S]*?environment:\s*production/, "provider workflow does not bind the cutover job to the true dispatch input and production environment");
  assert.ok(now - Date.parse(run.updated_at) >= 0 && now - Date.parse(run.updated_at) <= 10 * 60_000, "provider production detection run is not fresh");
};
const validateStagingBootstrapAuthorization = async (manifestPath, { gitCommit, repository, token, supabaseToken, databaseUrl, baseDirectory = root, now = Date.now(), fetchImpl = fetch, sleep = wait } = {}) => {
  parseStagingDatabaseUrl(databaseUrl);
  assert.match(gitCommit ?? "", /^[0-9a-f]{40}$/, "--git-commit must be the delivered candidate SHA");
  assert.ok(token, "staging provider verification requires GH_TOKEN");
  assert.ok(supabaseToken, "staging provider verification requires SUPABASE_ACCESS_TOKEN");
  const manifestSource = readFileSync(repositoryFile(baseDirectory, manifestPath, "release manifest"));
  const manifest = JSON.parse(manifestSource.toString("utf8"));
  validateManifest(manifest);
  assert.equal(manifest.gitCommit, gitCommit, "staging manifest gitCommit mismatch");
  assert.equal(manifest.supabaseProjectRef, approvedStagingProjectRef, "staging manifest target is not the approved project");
  assert.equal(manifest.stagingBootstrap.approvedProjectRef, approvedStagingProjectRef, "staging bootstrap approved project drifted");
  const authorization = manifest.deploymentAuthorization;
  assertSchemaValid(validateAuthorizationSchema, authorization, "staging GitHub deployment authorization schema");
  validateProviderAuthorization(authorization, "staging", gitCommit);
  const project = await requestJson(`https://api.supabase.com/v1/projects/${approvedStagingProjectRef}`, {
    fetchImpl,
    sleep,
    headers: { authorization: `Bearer ${supabaseToken}`, accept: "application/json" },
  });
  assert.equal(project.id ?? project.ref, approvedStagingProjectRef, "Supabase provider returned a different staging project");
  assert.equal(project.name, "PIBA_STAGING", "Supabase provider project name mismatch");
  assert.equal(project.status, "ACTIVE_HEALTHY", "Supabase staging project is not healthy");
  await validateGithubProvider(manifest, {
    repository,
    token,
    now,
    fetchImpl,
    sleep,
    manifestPath,
    manifestSource,
    baseDirectory,
    requireProductionDetection: false,
  });
  return { projectRef: approvedStagingProjectRef, environment: "staging", status: "authorized" };
};
const validatePreCutoverEvidence = async (manifestPath, { environment, gitCommit, repository, token, baseDirectory = root, receiptDirectory = resolve(baseDirectory, "ops/secure-sessions/evidence"), now = Date.now(), offlineFixture = false, fetchImpl, sleep } = {}) => {
  assert.ok(["staging", "production"].includes(environment), "--environment staging|production is required");
  assert.match(gitCommit ?? "", /^[0-9a-f]{40}$/, "--git-commit must be the delivered candidate SHA");
  assert.ok(!offlineFixture || environment !== "production", "--offline-fixture is explicitly non-production");
  const manifestSource = readFileSync(repositoryFile(baseDirectory, manifestPath, "release manifest"));
  const manifest = JSON.parse(manifestSource.toString("utf8"));
  validateManifest(manifest);
  assert.equal(manifest.gitCommit, gitCommit, "manifest gitCommit does not match delivered candidate");
  const manifestSha256 = digest(manifestSource);
  for (const artifact of manifest.artifacts) assertFileHash(baseDirectory, artifact.path, artifact.sha256, "release artifact");
  assertFileHash(baseDirectory, manifest.stagingBootstrap.path, manifest.stagingBootstrap.sha256, "staging bootstrap");
  assertFileHash(baseDirectory, manifest.stagingBootstrap.verificationPath, manifest.stagingBootstrap.verificationSha256, "staging bootstrap verification");
  for (const bundle of manifest.functionBundles) assertFileHash(baseDirectory, bundle.location, bundle.sourceSha256, `candidate ${bundle.name} bundle`);
  for (const bundle of manifest.priorFunctions.bundles) assertFileHash(baseDirectory, bundle.location, bundle.sourceSha256, `prior ${bundle.name} bundle`);
  assertFileHash(baseDirectory, manifest.sqlRollback.path, manifest.sqlRollback.sha256, "SQL rollback");
  const workflowSha256 = digest(readFileSync(repositoryFile(baseDirectory, manifest.productionDetection.workflow, "production workflow")));
  assert.equal(manifest.productionDetection.configurationSha256, workflowSha256, "production detection workflow checksum mismatch");
  const authorization = manifest.deploymentAuthorization;
  assertSchemaValid(validateAuthorizationSchema, authorization, "GitHub deployment authorization schema");
  validateProviderAuthorization(authorization, environment, gitCommit);
  if (environment === "production") {
    const detection = manifest.productionDetection.evidence;
    assertSchemaValid(validateDetectionSchema, detection, "production detection schema");
    assert.equal(detection.commit, gitCommit, "production detection commit mismatch");
    assert.equal(detection.workflowSha256, workflowSha256, "production detection workflow bytes mismatch");
    assert.ok(now - Date.parse(detection.completedAt) >= 0 && now - Date.parse(detection.completedAt) <= 10 * 60_000, "production detection is not fresh");
    assert.ok(Date.parse(detection.createdAt) <= Date.parse(detection.healthObservedAt) && Date.parse(detection.healthObservedAt) <= Date.parse(detection.completedAt), "production detection timestamps are not chronological");
  }
  if (!offlineFixture) await validateGithubProvider(manifest, { repository, token, now, fetchImpl, sleep, manifestPath, manifestSource, baseDirectory, requireProductionDetection: environment === "production" });
  const completedPhases = ["foundation-deploy", "function-deploy", "client-deploy", "backfill", "cutover"];
  const completed = new Map();
  for (const phase of completedPhases) {
    const source = readFileSync(resolve(receiptDirectory, `${phase}.receipt.json`));
    const receipt = JSON.parse(source.toString("utf8"));
    assertSchemaValid(validateReceiptSchema, receipt, `${phase} receipt schema`);
    assertReceiptChronology(receipt, `${phase} receipt`);
    assertNoPlaceholders(receipt, `${phase} receipt`);
    assert.equal(receipt.phase, phase, `${phase} receipt phase mismatch`);
    assert.equal(receipt.environment, environment, `${phase} receipt environment mismatch`);
    assert.equal(receipt.status, phase === "cutover" ? "approved" : "succeeded", `${phase} receipt status mismatch`);
    assert.equal(receipt.releaseId, manifest.releaseId, `${phase} receipt release mismatch`);
    assert.equal(receipt.manifestSha256, manifestSha256, `${phase} receipt manifest mismatch`);
    completed.set(phase, { receipt, sha256: digest(source) });
  }
  for (let index = 1; index < completedPhases.length; index++) {
    const previous = completed.get(completedPhases[index - 1]).receipt;
    const current = completed.get(completedPhases[index]).receipt;
    assert.ok(Date.parse(previous.completedAt) <= Date.parse(current.startedAt), `rollout phase ordering violation: ${previous.phase} must complete before ${current.phase}`);
  }
  const backfillReceipt = completed.get("backfill").receipt;
  assert.equal(backfillReceipt.evidence.processed + backfillReceipt.evidence.skipped, backfillReceipt.evidence.expected, "backfill processed+skipped must equal expected");
  assert.equal(backfillReceipt.evidence.verified, backfillReceipt.evidence.expected, "backfill verified must equal expected");
  const cutoverReceipt = completed.get("cutover").receipt;
  const functionReceipt = completed.get("function-deploy").receipt;
  const clientReceipt = completed.get("client-deploy").receipt;
  assert.equal(cutoverReceipt.evidence.verifiedCredentials, backfillReceipt.evidence.expected, "cutover verified credentials mismatch");
  assert.equal(cutoverReceipt.evidence.expectedCredentials, backfillReceipt.evidence.expected, "cutover expected credentials mismatch");
  assert.equal(cutoverReceipt.evidence.functionVersionEvidence.receiptSha256, completed.get("function-deploy").sha256, "function receipt checksum mismatch");
  assert.equal(cutoverReceipt.evidence.clientVersionEvidence.receiptSha256, completed.get("client-deploy").sha256, "client receipt checksum mismatch");
  assert.equal(functionReceipt.evidence.functionVersion, manifest.functionVersion, "function version does not match manifest");
  assert.deepEqual(functionReceipt.evidence.sourceBundles, manifest.functionBundles, "function bundle hashes do not match manifest");
  assert.equal(cutoverReceipt.evidence.functionVersionEvidence.version, manifest.functionVersion, "cutover function version does not match manifest");
  assert.equal(cutoverReceipt.evidence.functionVersionEvidence.deploymentOutputSha256, functionReceipt.outputSha256, "cutover function output does not match phase receipt");
  assert.equal(clientReceipt.evidence.clientVersion, manifest.clientVersion, "client version does not match manifest");
  assert.equal(clientReceipt.evidence.providerDeploymentId, manifest.clientDeploymentId, "client deployment does not match manifest");
  assert.equal(clientReceipt.evidence.assetManifestSha256, manifest.clientAssetManifestSha256, "client asset hash does not match manifest");
  assert.equal(cutoverReceipt.evidence.clientVersionEvidence.version, manifest.clientVersion, "cutover client version does not match manifest");
  assert.equal(cutoverReceipt.evidence.clientVersionEvidence.providerDeploymentId, manifest.clientDeploymentId, "cutover client deployment does not match manifest");
  assert.equal(cutoverReceipt.evidence.clientVersionEvidence.assetManifestSha256, manifest.clientAssetManifestSha256, "cutover client asset hash does not match manifest");
  assert.deepEqual(cutoverReceipt.evidence.sloResults.map(({ endpoint }) => endpoint).sort(), [...productionEndpoints].sort(), "cutover receipt must contain every endpoint SLO result exactly once");
  if (environment === "production") {
    const detection = manifest.productionDetection.evidence;
    assert.equal(cutoverReceipt.evidence.productionDetectionEvidenceSha256, digest(JSON.stringify(detection)), "cutover receipt production detector checksum mismatch");
    const detectorByEndpoint = new Map(detection.endpointResults.map((result) => [result.endpoint, result]));
    for (const result of cutoverReceipt.evidence.sloResults) {
      const detectorResult = detectorByEndpoint.get(result.endpoint);
      assert.ok(detectorResult, `production detector omitted cutover endpoint: ${result.endpoint}`);
      assert.equal(detectorResult.decision, "pass", `production detector did not pass endpoint: ${result.endpoint}`);
      assert.equal(result.decision, "pass", `cutover observation did not pass endpoint: ${result.endpoint}`);
    }
  }
  return { releaseId: manifest.releaseId, manifestSha256, environment, gitCommit, phases: completedPhases };
};
const writeFixture = (path, source) => {
  const absolutePath = resolve(fixtureRoot, path);
  mkdirSync(resolve(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, source);
  return { path, sha256: digest(source) };
};
const workflowFixtureSource = "jobs:\n  validate-production-cutover:\n    if: github.event_name == 'workflow_dispatch' && inputs.validate_production_cutover\n    environment: production\n  production-detection:\n    environment: production\n";
const artifactBindings = criticalArtifacts.map((path) => writeFixture(path, path === ".github/workflows/secure-sessions.yml" ? workflowFixtureSource : `fixture:${path}\n`));
const workflowBinding = artifactBindings.find(({ path }) => path === ".github/workflows/secure-sessions.yml");
const stagingBootstrapBinding = writeFixture(manifestTemplate.stagingBootstrap.path, "fixture:staging-bootstrap\n");
const stagingBootstrapVerificationBinding = writeFixture(manifestTemplate.stagingBootstrap.verificationPath, "fixture:staging-bootstrap-verification\n");
const priorBundles = manifestTemplate.priorFunctions.bundles.map(({ name, location }) => {
  const binding = writeFixture(location, `prior:${name}\n`);
  return { name, location, sourceSha256: binding.sha256 };
});
const candidateBundles = manifestTemplate.functionBundles.map(({ name, location }) => {
  const binding = writeFixture(location, `candidate:${name}\n`);
  return { name, location, sourceSha256: binding.sha256 };
});
const authorization = {
  provider: "github", repository: "piba/repository", pullRequestNumber: 77, runId: 101, runAttempt: 1, runUrl: "https://github.com/piba/repository/actions/runs/101",
  jobId: 102, jobAttempt: 1, jobUrl: "https://github.com/piba/repository/actions/runs/101/job/102", validateProductionCutover: true,
  workflowId: 998, workflowPath: ".github/workflows/secure-sessions.yml", event: "workflow_dispatch", ref: "refs/heads/main", createdAt: "2026-07-13T00:25:00Z", completedAt: "2026-07-13T00:26:00Z",
  deploymentId: 202, deploymentStatusId: 203, environment: "staging", commit: gitSha, status: "approved",
  approvals: [
    { role: "security", actor: "security-owner", approvedAt: "2026-07-13T00:00:00Z", reviewId: 301 },
    { role: "release-owner", actor: "release-owner", approvedAt: "2026-07-13T00:01:00Z", reviewId: 302 },
  ],
};
assertSchemaValid(validateAuthorizationSchema, authorization, "deployment authorization schema");
const detection = {
  provider: "github", runId: 103, runAttempt: 1, runUrl: "https://github.com/piba/repository/actions/runs/103", createdAt: "2026-07-13T00:20:00Z", environment: "production",
  actor: "github-actions[bot]", commit: gitSha, projectRef: approvedStagingProjectRef, checkedOrigin: "https://piba-current.vercel.app", workflowSha256: workflowBinding.sha256,
  configuredSecretNames: ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"], healthObservedAt: "2026-07-13T00:25:00Z", completedAt: "2026-07-13T00:26:00Z",
  proxySyntheticResults: [
    { name: "invalid-login", method: "POST", path: "/api/session/login", status: 401, durationMs: 1, checkedAt: "2026-07-13T00:25:00Z", decision: "pass" },
    { name: "unauthenticated-current-user", method: "GET", path: "/api/session/current-user", status: 401, durationMs: 1, checkedAt: "2026-07-13T00:25:00Z", decision: "pass" },
  ],
  endpointResults: productionEndpoints.map((endpoint) => ({ endpoint, sampleCount: 30, unexpectedErrorRate: 0, nonSuccessRate: 0, authThrottleRate: 0, p95Ms: 1, decision: "pass" })), status: "success",
};
assertSchemaValid(validateDetectionSchema, detection, "production detection schema");
const validManifest = {
  ...structuredClone(manifestTemplate), releaseId: "secure-sessions-20260713", createdAt: "2026-07-13T00:00:00Z", gitCommit: gitSha,
  supabaseProjectRef: approvedStagingProjectRef, vercelProjectId: "prj_12345678", vercelOrgId: "team_12345678",
  functionVersion: "functions-git-a1b2c3d", functionBundles: candidateBundles, clientVersion: "dpl_current123", clientDeploymentId: "dpl_12345678", clientDeploymentUrl: "https://piba-current.vercel.app", clientAssetManifestSha256: digest("client-assets"), artifacts: artifactBindings,
  stagingBootstrap: { ...manifestTemplate.stagingBootstrap, sha256: stagingBootstrapBinding.sha256, verificationSha256: stagingBootstrapVerificationBinding.sha256 },
  priorFunctions: { gitSha, bundles: priorBundles }, priorVercelDeployment: { deploymentId: "dpl_12345678", immutableUrl: "https://piba-immutable.vercel.app" },
  sqlRollback: artifactBindings.find(({ path }) => path === "ops/secure-sessions/rollback.sql"),
  productionDetection: { ...manifestTemplate.productionDetection, configurationSha256: workflowBinding.sha256, evidence: detection },
  deploymentAuthorization: authorization, rollbackAt: "2026-07-13T00:00:00Z", compatibilityEndsAt: "2026-07-16T00:00:00Z",
};
validateManifest(validManifest);
for (const mutation of [
  { productionEligible: true },
  { rollbackMutation: true },
  { allowedEnvironment: "production" },
  { approvedProjectRef: productionProjectRef },
]) {
  const invalid = structuredClone(validManifest);
  Object.assign(invalid.stagingBootstrap, mutation);
  assert.throws(() => validateManifest(invalid), /manifest|staging bootstrap/i);
}
for (const mutate of [
  (manifest) => { manifest.productionDetection.evidence.projectRef = "differentref"; },
  (manifest) => { manifest.productionDetection.evidence.checkedOrigin = "https://different.example"; },
]) {
  const invalid = structuredClone(validManifest);
  mutate(invalid);
  assert.throws(() => validateManifest(invalid), /telemetry evidence|checked origin/);
}
for (const artifacts of [validManifest.artifacts.slice(0, -1), [...validManifest.artifacts.slice(0, -1), validManifest.artifacts[0]]]) {
  assert.throws(() => validateManifest({ ...validManifest, artifacts }), /manifest|artifact/i);
}
const manifestPath = "ops/secure-sessions/evidence/release-manifest.json";
const manifestSource = `${JSON.stringify(validManifest)}\n`;
writeFixture(manifestPath, manifestSource);
const manifestSha256 = digest(manifestSource);
const phaseReceipts = Object.fromEntries(completedPhaseFixtures.map((receipt) => [receipt.phase, structuredClone(receipt)]));
for (const receipt of Object.values(phaseReceipts)) Object.assign(receipt, { environment: "staging", manifestSha256 });
phaseReceipts["function-deploy"].evidence.sourceBundles = candidateBundles;
phaseReceipts["function-deploy"].outputSha256 = digest("function-output");
Object.assign(phaseReceipts["client-deploy"].evidence, { clientVersion: validManifest.clientVersion, providerDeploymentId: validManifest.clientDeploymentId, assetManifestSha256: validManifest.clientAssetManifestSha256 });
phaseReceipts.backfill.evidence.verified = phaseReceipts.backfill.evidence.expected;
const phaseSources = {};
for (const phase of ["foundation-deploy", "function-deploy", "client-deploy", "backfill"]) {
  phaseSources[phase] = `${JSON.stringify(phaseReceipts[phase])}\n`;
  writeFixture(`ops/secure-sessions/evidence/${phase}.receipt.json`, phaseSources[phase]);
}
const cutoverReceipt = structuredClone(evidence["cutover.receipt.template.json"]);
Object.assign(cutoverReceipt, { releaseId: validManifest.releaseId, environment: "staging", startedAt: "2026-07-13T00:40:00Z", completedAt: "2026-07-13T01:10:00Z", actor: "release-owner", manifestSha256, inputSha256: digest("cutover-input"), outputSha256: digest("cutover-output") });
Object.assign(cutoverReceipt.evidence, { observationOwner: "release-owner", observationOperator: "function-operator", observationStartedAt: "2026-07-13T00:40:00Z", observationEndedAt: "2026-07-13T01:10:00Z", observationQueryIds: productionEndpoints.map((endpoint) => `slo-${endpoint}`), observationOutputSha256: digest("observation"), approvals: [{ role: "release-owner", actor: "release-owner", approvedAt: "2026-07-13T01:10:00Z" }, { role: "function-operator", actor: "function-operator", approvedAt: "2026-07-13T01:10:00Z" }] });
Object.assign(cutoverReceipt.evidence.functionVersionEvidence, { version: validManifest.functionVersion, receiptSha256: digest(phaseSources["function-deploy"]), deploymentOutputSha256: digest("function-output") });
Object.assign(cutoverReceipt.evidence.clientVersionEvidence, { version: validManifest.clientVersion, receiptSha256: digest(phaseSources["client-deploy"]), providerDeploymentId: phaseReceipts["client-deploy"].evidence.providerDeploymentId, assetManifestSha256: phaseReceipts["client-deploy"].evidence.assetManifestSha256 });
for (const result of cutoverReceipt.evidence.sloResults) Object.assign(result, { queryId: `slo-${result.endpoint}`, owner: "function-operator" });
assertSchemaValid(validateReceiptSchema, cutoverReceipt, "cutover authorization schema");
writeFixture("ops/secure-sessions/evidence/cutover.receipt.json", `${JSON.stringify(cutoverReceipt)}\n`);
const fixtureOptions = { environment: "staging", gitCommit: gitSha, baseDirectory: fixtureRoot, offlineFixture: true };
assert.equal((await validatePreCutoverEvidence(manifestPath, fixtureOptions)).environment, "staging");
const foundationReceiptPath = resolve(fixtureRoot, "ops/secure-sessions/evidence/foundation-deploy.receipt.json");
const foundationReceiptSource = readFileSync(foundationReceiptPath, "utf8");
const invalidFoundationChronology = JSON.parse(foundationReceiptSource);
invalidFoundationChronology.completedAt = "2026-07-12T23:59:00Z";
writeFileSync(foundationReceiptPath, `${JSON.stringify(invalidFoundationChronology)}\n`);
await assert.rejects(validatePreCutoverEvidence(manifestPath, fixtureOptions), /not chronological/);
writeFileSync(foundationReceiptPath, foundationReceiptSource);
const cutoverReceiptPath = resolve(fixtureRoot, "ops/secure-sessions/evidence/cutover.receipt.json");
const stagingCutoverSource = readFileSync(cutoverReceiptPath, "utf8");
const invalidObservationDuration = JSON.parse(stagingCutoverSource);
invalidObservationDuration.evidence.observationDurationMinutes = 31;
writeFileSync(cutoverReceiptPath, `${JSON.stringify(invalidObservationDuration)}\n`);
await assert.rejects(validatePreCutoverEvidence(manifestPath, fixtureOptions), /duration does not equal/);
writeFileSync(cutoverReceiptPath, stagingCutoverSource);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...fixtureOptions, environment: "production" }), /offline-fixture/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...fixtureOptions, gitCommit: digest("wrong").slice(0, 40) }), /gitCommit/);
phaseReceipts.backfill.evidence.verified--;
writeFixture("ops/secure-sessions/evidence/backfill.receipt.json", `${JSON.stringify(phaseReceipts.backfill)}\n`);
await assert.rejects(validatePreCutoverEvidence(manifestPath, fixtureOptions), /verified/);
phaseReceipts.backfill.evidence.verified = phaseReceipts.backfill.evidence.expected;
writeFixture("ops/secure-sessions/evidence/backfill.receipt.json", phaseSources.backfill);
const productionAuthorization = structuredClone(authorization);
productionAuthorization.environment = "production";
validManifest.deploymentAuthorization = productionAuthorization;
validManifest.supabaseProjectRef = productionProjectRef;
validManifest.productionDetection.evidence.projectRef = productionProjectRef;
const productionManifestSource = `${JSON.stringify(validManifest)}\n`;
writeFixture(manifestPath, productionManifestSource);
const productionManifestSha256 = digest(productionManifestSource);
for (const phase of ["foundation-deploy", "function-deploy", "client-deploy", "backfill", "cutover"]) {
  const receipt = phase === "cutover" ? structuredClone(cutoverReceipt) : structuredClone(phaseReceipts[phase]);
  Object.assign(receipt, { environment: "production", manifestSha256: productionManifestSha256 });
  if (phase === "cutover") {
    receipt.evidence.functionVersionEvidence.receiptSha256 = digest(`${JSON.stringify({ ...phaseReceipts["function-deploy"], environment: "production", manifestSha256: productionManifestSha256 })}\n`);
    receipt.evidence.clientVersionEvidence.receiptSha256 = digest(`${JSON.stringify({ ...phaseReceipts["client-deploy"], environment: "production", manifestSha256: productionManifestSha256 })}\n`);
    receipt.evidence.productionDetectionEvidenceSha256 = digest(JSON.stringify(detection));
  }
  writeFixture(`ops/secure-sessions/evidence/${phase}.receipt.json`, `${JSON.stringify(receipt)}\n`);
}
const providerResponses = {
  "/repos/piba/repository": { default_branch: "main" },
  "/repos/piba/repository/pulls/77": { number: 77, head: { sha: gitSha }, user: { login: "tracker-author" } },
  "/repos/piba/repository/pulls/77/reviews?per_page=100": [
    { id: 301, user: { login: "security-owner" }, state: "APPROVED", commit_id: gitSha, submitted_at: "2026-07-13T00:00:00Z" },
    { id: 302, user: { login: "release-owner" }, state: "APPROVED", commit_id: gitSha, submitted_at: "2026-07-13T00:01:00Z" },
  ],
  "/repos/piba/repository/collaborators/security-owner/permission": { permission: "admin" },
  "/repos/piba/repository/collaborators/release-owner/permission": { permission: "maintain" },
  "/repos/piba/repository/actions/runs/101": { id: 101, run_attempt: 1, html_url: authorization.runUrl, head_sha: gitSha, head_branch: "main", workflow_id: 998, path: authorization.workflowPath, event: "workflow_dispatch", created_at: authorization.createdAt, updated_at: authorization.completedAt, conclusion: "success" },
  "/repos/piba/repository/actions/runs/101/attempts/1/jobs?per_page=100": [{ id: 102, name: "validate-production-cutover", run_attempt: 1, html_url: authorization.jobUrl, conclusion: "success" }],
  "/repos/piba/repository/actions/workflows/998": { id: 998, path: authorization.workflowPath },
  "/repos/piba/repository/deployments/202": { id: 202, sha: gitSha, environment: "production", payload: { web_url: validManifest.clientDeploymentUrl } },
  "/repos/piba/repository/deployments/202/statuses?per_page=100": [{ id: 203, state: "success", environment: "production", log_url: authorization.runUrl, environment_url: validManifest.clientDeploymentUrl }],
  "/repos/piba/repository/actions/runs/103": { id: 103, name: "Secure sessions", path: ".github/workflows/secure-sessions.yml", workflow_id: 999, run_attempt: 1, html_url: detection.runUrl, head_sha: gitSha, head_branch: "main", head_repository: { full_name: "piba/repository" }, event: "schedule", actor: { login: "github-actions[bot]" }, conclusion: "success", created_at: detection.createdAt, updated_at: "2026-07-13T00:26:30Z" },
  "/repos/piba/repository/actions/workflows/999": { id: 999, name: "Secure sessions", path: ".github/workflows/secure-sessions.yml" },
};
const providerRepositoryPaths = [
  manifestPath,
  ...validManifest.artifacts.map(({ path }) => path),
  ...validManifest.functionBundles.map(({ location }) => location),
  validManifest.stagingBootstrap.path,
  validManifest.stagingBootstrap.verificationPath,
];
for (const path of providerRepositoryPaths) {
  const source = readFileSync(resolve(fixtureRoot, path));
  const blobSha = digest(`blob:${path}`);
  const route = `/repos/piba/repository/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${gitSha}`;
  if (path === "dist.tar.gz") {
    providerResponses[route] = { type: "file", sha: blobSha, encoding: "none" };
    providerResponses[`/repos/piba/repository/git/blobs/${blobSha}`] = { encoding: "base64", content: source.toString("base64") };
  } else providerResponses[route] = { type: "file", sha: blobSha, encoding: "base64", content: source.toString("base64") };
}
const mockedFetch = (overrides = {}, status = 200) => {
  const responses = { ...structuredClone(providerResponses), ...overrides };
  return async (url) => {
    const parsed = new URL(url);
    const key = `${parsed.pathname}${parsed.search}`;
    return new Response(JSON.stringify(responses[key] ?? { message: "fixture route missing" }), { status: key in responses ? status : 404, headers: { "content-type": "application/json" } });
  };
};
const productionOptions = { environment: "production", gitCommit: gitSha, repository: "piba/repository", token: "fixture-token", baseDirectory: fixtureRoot, now: Date.parse("2026-07-13T00:27:00Z"), sleep: async () => {} };
const stagingProviderManifest = structuredClone(validManifest);
stagingProviderManifest.supabaseProjectRef = approvedStagingProjectRef;
stagingProviderManifest.productionDetection.evidence.projectRef = approvedStagingProjectRef;
stagingProviderManifest.deploymentAuthorization.environment = "staging";
const stagingProviderManifestSource = Buffer.from(`${JSON.stringify(stagingProviderManifest)}\n`);
writeFixture(manifestPath, stagingProviderManifestSource);
const providerManifestRoute = `/repos/piba/repository/contents/${manifestPath.split("/").map(encodeURIComponent).join("/")}?ref=${gitSha}`;
const stagingProviderOverrides = {
  [providerManifestRoute]: { ...providerResponses[providerManifestRoute], content: stagingProviderManifestSource.toString("base64") },
  [`/v1/projects/${approvedStagingProjectRef}`]: { id: approvedStagingProjectRef, name: "PIBA_STAGING", status: "ACTIVE_HEALTHY" },
  "/repos/piba/repository/deployments/202": { ...providerResponses["/repos/piba/repository/deployments/202"], environment: "staging" },
  "/repos/piba/repository/deployments/202/statuses?per_page=100": [{ ...providerResponses["/repos/piba/repository/deployments/202/statuses?per_page=100"][0], environment: "staging" }],
};
const stagingProviderOptions = {
  gitCommit: gitSha,
  repository: "piba/repository",
  token: "github-token",
  supabaseToken: "supabase-token",
  databaseUrl: `postgresql://postgres:fixture@db.${approvedStagingProjectRef}.supabase.co:5432/postgres?sslmode=require`,
  baseDirectory: fixtureRoot,
  now: Date.parse("2026-07-13T00:27:00Z"),
  sleep: async () => {},
};
assert.equal((await validateStagingBootstrapAuthorization(manifestPath, { ...stagingProviderOptions, fetchImpl: mockedFetch(stagingProviderOverrides) })).status, "authorized");
await assert.rejects(validateStagingBootstrapAuthorization(manifestPath, {
  ...stagingProviderOptions,
  fetchImpl: mockedFetch({ ...stagingProviderOverrides, [`/v1/projects/${approvedStagingProjectRef}`]: { id: "wrongproject", name: "PIBA_STAGING", status: "ACTIVE_HEALTHY" } }),
}), /different staging project/);
writeFixture(manifestPath, productionManifestSource);
assert.equal((await validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch() })).environment, "production");
const productionCutoverSource = readFileSync(cutoverReceiptPath, "utf8");
const invalidDetectorBinding = JSON.parse(productionCutoverSource);
invalidDetectorBinding.evidence.productionDetectionEvidenceSha256 = digest("wrong detector output");
writeFileSync(cutoverReceiptPath, `${JSON.stringify(invalidDetectorBinding)}\n`);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch() }), /production detector checksum mismatch/);
writeFileSync(cutoverReceiptPath, productionCutoverSource);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, token: undefined, fetchImpl: mockedFetch() }), /GH_TOKEN/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, repository: undefined, fetchImpl: mockedFetch() }), /GITHUB_REPOSITORY/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, now: Date.parse("2026-07-13T00:37:00Z"), fetchImpl: mockedFetch() }), /not fresh/);
const reviewsPath = "/repos/piba/repository/pulls/77/reviews?per_page=100";
const runPath = "/repos/piba/repository/actions/runs/103";
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ [reviewsPath]: providerResponses[reviewsPath].map((review) => review.id === 301 ? { ...review, commit_id: digest("stale").slice(0, 40) } : review) }) }), /stale/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ [runPath]: { ...providerResponses[runPath], head_sha: digest("wrong-provider-sha").slice(0, 40) } }) }), /run SHA/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ [reviewsPath]: providerResponses[reviewsPath].map((review) => review.id === 301 ? { ...review, state: "CHANGES_REQUESTED" } : review) }) }), /not approved/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ [reviewsPath]: providerResponses[reviewsPath].map((review) => review.id === 301 ? { ...review, state: "DISMISSED" } : review) }) }), /not approved/);
const duplicateActorManifest = structuredClone(validManifest);
duplicateActorManifest.deploymentAuthorization.approvals[1].actor = "SECURITY-OWNER";
const duplicateActorSource = Buffer.from(`${JSON.stringify(duplicateActorManifest)}\n`);
const duplicateManifestRoute = `/repos/piba/repository/contents/${manifestPath.split("/").map(encodeURIComponent).join("/")}?ref=${gitSha}`;
await assert.rejects(validateGithubProvider(duplicateActorManifest, { repository: productionOptions.repository, token: productionOptions.token, now: productionOptions.now, fetchImpl: mockedFetch({ [duplicateManifestRoute]: { ...providerResponses[duplicateManifestRoute], content: duplicateActorSource.toString("base64") } }), sleep: productionOptions.sleep, manifestPath, manifestSource: duplicateActorSource, baseDirectory: fixtureRoot }), /distinct case-insensitively|actor mismatch/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ [runPath]: { ...providerResponses[runPath], conclusion: "failure" } }) }), /did not succeed/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ [runPath]: { ...providerResponses[runPath], path: ".github/workflows/untrusted.yml" } }) }), /workflow path/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ [runPath]: { ...providerResponses[runPath], head_branch: "feature" } }) }), /default branch/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ "/repos/piba/repository/collaborators/security-owner/permission": { permission: "maintain" } }) }), /admin permission/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ "/repos/piba/repository/collaborators/release-owner/permission": { permission: "read" } }) }), /lacks push permission/);
const authorizationRunPath = "/repos/piba/repository/actions/runs/101";
const authorizationJobsPath = "/repos/piba/repository/actions/runs/101/attempts/1/jobs?per_page=100";
for (const [field, value, message] of [
  ["workflow_id", 997, /workflow ID/], ["path", ".github/workflows/untrusted.yml", /workflow path/], ["event", "pull_request", /run event/],
  ["head_branch", "feature", /default branch|run ref/], ["run_attempt", 2, /run attempt/], ["conclusion", "failure", /did not succeed/],
]) await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ [authorizationRunPath]: { ...providerResponses[authorizationRunPath], [field]: value } }) }), message);
for (const jobs of [[], [{ ...providerResponses[authorizationJobsPath][0], conclusion: "failure" }], [{ ...providerResponses[authorizationJobsPath][0], id: 999 }]]) {
  await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ [authorizationJobsPath]: jobs }) }), /validate-production-cutover|job ID/);
}
const manifestContentPath = `/repos/piba/repository/contents/${manifestPath.split("/").map(encodeURIComponent).join("/")}?ref=${gitSha}`;
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ [manifestContentPath]: { ...providerResponses[manifestContentPath], content: Buffer.from("substituted manifest").toString("base64") } }) }), /local release manifest differs/);
const workflowContentPath = `/repos/piba/repository/contents/.github/workflows/secure-sessions.yml?ref=${gitSha}`;
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ [workflowContentPath]: { ...providerResponses[workflowContentPath], content: Buffer.from("substituted workflow").toString("base64") } }) }), /provider repository checksum mismatch/);
const distContentPath = `/repos/piba/repository/contents/dist.tar.gz?ref=${gitSha}`;
const distBlobPath = `/repos/piba/repository/git/blobs/${providerResponses[distContentPath].sha}`;
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ [distBlobPath]: { encoding: "base64", content: Buffer.from("substituted blob").toString("base64") } }) }), /provider repository checksum mismatch/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ "/repos/piba/repository/deployments/202/statuses?per_page=100": [{ ...providerResponses["/repos/piba/repository/deployments/202/statuses?per_page=100"][0], id: 999 }] }) }), /status ID/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: mockedFetch({ "/repos/piba/repository/deployments/202": { ...providerResponses["/repos/piba/repository/deployments/202"], payload: { web_url: "https://different.example" } } }) }), /deployment URL/);
const teamPath = "/orgs/piba/teams/security-team/memberships/security-owner";
const directProviderOptions = { repository: productionOptions.repository, token: productionOptions.token, now: productionOptions.now, sleep: productionOptions.sleep, manifestPath, manifestSource: Buffer.from(productionManifestSource), baseDirectory: fixtureRoot };
assert.equal((await validateGithubProvider(validManifest, { ...directProviderOptions, fetchImpl: mockedFetch({ [teamPath]: { state: "active" } }), securityTeamSlug: "security-team" })), undefined);
await assert.rejects(validateGithubProvider(validManifest, { ...directProviderOptions, fetchImpl: mockedFetch({ [teamPath]: { state: "pending" } }), securityTeamSlug: "security-team" }), /not an active member/);
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: async () => { throw new Error("outage"); } }), /bounded retries/);
let rateLimitAttempts = 0;
await assert.rejects(validatePreCutoverEvidence(manifestPath, { ...productionOptions, fetchImpl: async () => { rateLimitAttempts++; return new Response("{}", { status: 429 }); } }), /bounded retries/);
assert.equal(rateLimitAttempts, 3, "GitHub rate-limit retries must be bounded");
const execution = {
  releaseId: validManifest.releaseId, phase: "cutover-execution", environment: "production", actor: "release-owner", actorRole: "release-owner",
  manifestSha256: productionManifestSha256, inputSha256: digest("execution-input"), outputSha256: digest("execution-output"),
  startedAt: "2026-07-13T01:10:00Z", completedAt: "2026-07-13T01:11:00Z", status: "succeeded",
  evidence: { gitCommit: gitSha, authorizationReceiptPath: "ops/secure-sessions/evidence/cutover.receipt.json", authorizationReceiptSha256: digest(readFileSync(resolve(fixtureRoot, "ops/secure-sessions/evidence/cutover.receipt.json"))), sqlPath: "ops/secure-sessions/cutover.sql", sqlSha256: artifactBindings.find(({ path }) => path === "ops/secure-sessions/cutover.sql").sha256, sqlOutputSha256: digest("sql-output"), resultingMigrationState: "hash_only" },
};
assertSchemaValid(validateReceiptSchema, execution, "cutover execution schema");
assertSchemaInvalid(validateReceiptSchema, { ...execution, status: "failed" }, "failed cutover execution");
const rollbackReceipt = structuredClone(evidence["rollback.receipt.template.json"]);
Object.assign(rollbackReceipt, { releaseId: "secure-sessions-rollback", environment: "production", startedAt: "2026-07-13T01:00:00Z", completedAt: "2026-07-13T01:10:00Z", actor: "incident-commander", manifestSha256: sha256, inputSha256: digest("rollback-input"), outputSha256: digest("rollback-output") });
Object.assign(rollbackReceipt.evidence, { priorFunctionGitSha: gitSha, restoredFunctionBundles: priorBundles, priorVercelDeploymentId: "dpl_12345678", priorVercelImmutableUrl: "https://piba-immutable.vercel.app", vercelRollbackCommand: "npx vercel rollback dpl_12345678", sqlRollbackSha256: sha256, cutoverExecutionReceiptSha256: digest("execution"), authorizationReceiptSha256: digest("authorization"), expectedReleaseId: execution.releaseId, checkpointReceiptPath: "ops/secure-sessions/evidence/rollback-checkpoint-secure-sessions-rollback.json", checkpointReceiptSha256: digest("checkpoint"), compatibilityEndsAt: "2026-07-16T01:10:00Z" });
assertSchemaValid(validateReceiptSchema, rollbackReceipt, "rollback receipt schema");
assertSchemaInvalid(validateReceiptSchema, { ...rollbackReceipt, evidence: { ...rollbackReceipt.evidence, expectedReleaseId: "REPLACE_RELEASE" } }, "rollback without actual cutover release");
assert.match(workflow, /cron:\s*['"]\*\/5 \* \* \* \*['"]/);
assert.match(workflow, /npm run detect:secure-session-production/);
assert.doesNotMatch(workflow, /curl .*analytics|gh issue (?:create|edit)/s, "workflow must invoke the tested detector instead of inline provider logic");
assert.match(workflow, /concurrency:[\s\S]*group:\s*secure-session-production-detection/);
assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
assert.match(workflow, /denoland\/setup-deno@[0-9a-f]{40}/);
assert.match(workflow, /PIBA_SESSION_HARNESS_IMAGE:\s*public\.ecr\.aws\/supabase\/postgres:[^\s]+@sha256:[0-9a-f]{64}/);
assert.match(workflow, /npm run security:gate/);
assert.doesNotMatch(workflow, /\$unexpected\s*>?=|\$non_success\s*>?=|\$auth_throttle\s*>?=|\$p95_ms\s*>?=/, "workflow must not duplicate SLO policy");
assert.match(runbook, /PR1 through PR5 are nondeployable chain slices/);
assert.match(runbook, /Only the tracker aggregate containing every accepted slice is eligible for deployment/);
assert.match(runbook, /staging rehearsal remains pending separate authorization/);
assert.match(runbook, /from function_logs/);
assert.match(runbook, /json_value\(event_message, '\$\.endpoint'\)/);
assert.doesNotMatch(runbook, /from edge_logs/);
assert.match(runbook, /Do not deploy the public frontend against this backend/);
assert.match(runbook, /productionEligible=false/);
assert.match(runbook, /ejxfoxbfndplinraqrvw/);
assert.match(runbook, /provider-authenticated GitHub reviews\/deployment/);
assert.match(runbook, /four-state recovery machine/);
assert.match(runbook, /never retried blindly/);
assert.match(runbook, /Never use `supabase db push --include-all`/);
assert.doesNotMatch(runbook, /^supabase db push[^\n]*--include-all/m);
assert.match(runbook, /first restores the prior Vercel deployment/);
const evaluatorFixture = resolve(fixtureRoot, "secure-session-slo-fixture.json");
const telemetryRows = (override = {}, target = "login") => productionEndpoints.map((endpoint) => ({ endpoint, sample_count: 30, unexpected_error_rate: 0, non_success_rate: 0, auth_throttle_rate: 0, p95_ms: 1, ...(endpoint === target ? override : {}) }));
const telemetryEvents = (syntheticRequestIds = []) => [
  ...productionEndpoints.flatMap((endpoint) => Array.from({ length: 30 }, (_, index) => ({ endpoint, status: 200, duration_ms: index + 1, request_id: null }))),
  ...syntheticRequestIds.map((requestId) => ({ endpoint: "login", status: 401, duration_ms: 1, request_id: requestId })),
];
for (const [metrics, expected] of [
  [{ unexpected_error_rate: 0.0099, non_success_rate: 0.0199, auth_throttle_rate: 0.0499, p95_ms: 749 }, ["pass", 0]],
  [{ unexpected_error_rate: 0.01, non_success_rate: 0, auth_throttle_rate: 0, p95_ms: 1 }, ["investigation", 1]],
  [{ unexpected_error_rate: 0.02, non_success_rate: 0, auth_throttle_rate: 0, p95_ms: 1 }, ["emergency", 2]],
  [{ unexpected_error_rate: 0.05, non_success_rate: 0, auth_throttle_rate: 0, p95_ms: 1 }, ["rollback", 5]],
  [{ unexpected_error_rate: 0, non_success_rate: 0.02, auth_throttle_rate: 0, p95_ms: 1 }, ["emergency", 2]],
  [{ unexpected_error_rate: 0, non_success_rate: 0, auth_throttle_rate: 0.05, p95_ms: 1 }, ["emergency", 2]],
  [{ unexpected_error_rate: 0, non_success_rate: 0, auth_throttle_rate: 0, p95_ms: 750 }, ["emergency", 2]],
]) {
  writeFileSync(evaluatorFixture, JSON.stringify(telemetryRows(metrics)));
  const executed = spawnSync(process.execPath, ["scripts/verify-secure-session-foundation.mjs", "--evaluate-production-slo", evaluatorFixture], { cwd: root, encoding: "utf8" });
  assert.equal(executed.status, expected[1], `evaluator exit mismatch: ${executed.stderr}`);
  assert.equal(JSON.parse(executed.stdout).action, expected[0]);
}
writeFileSync(evaluatorFixture, JSON.stringify([]));
const malformedEvaluation = spawnSync(process.execPath, ["scripts/verify-secure-session-foundation.mjs", "--evaluate-production-slo", evaluatorFixture], { cwd: root, encoding: "utf8" });
assert.equal(malformedEvaluation.status, 3);
assert.match(malformedEvaluation.stderr, /malformed telemetry response|exactly seven rows|seven unique endpoints/);
for (const invalidMetric of [null, "", "NaN", "Infinity", -0.01, 1.01]) {
  writeFileSync(evaluatorFixture, JSON.stringify(telemetryRows({ unexpected_error_rate: invalidMetric })));
  const executed = spawnSync(process.execPath, ["scripts/verify-secure-session-foundation.mjs", "--evaluate-production-slo", evaluatorFixture], { cwd: root, encoding: "utf8" });
  assert.equal(executed.status, 3, `invalid telemetry metric passed: ${String(invalidMetric)}`);
}
writeFileSync(evaluatorFixture, JSON.stringify(telemetryRows().slice(1)));
assert.equal(spawnSync(process.execPath, ["scripts/verify-secure-session-foundation.mjs", "--evaluate-production-slo", evaluatorFixture], { cwd: root }).status, 3, "missing endpoint must fail closed");
for (const invalidRows of [
  telemetryRows({ sample_count: 0 }),
  [...telemetryRows().slice(0, -1), telemetryRows()[0]],
  [...telemetryRows().slice(0, -1), { ...telemetryRows().at(-1), endpoint: "outside-domain" }],
  telemetryRows({ p95_ms: -1 }),
  telemetryRows({ sample_count: -1 }),
]) {
  writeFileSync(evaluatorFixture, JSON.stringify(invalidRows));
  assert.equal(spawnSync(process.execPath, ["scripts/verify-secure-session-foundation.mjs", "--evaluate-production-slo", evaluatorFixture], { cwd: root }).status, 3, "invalid telemetry domain must fail closed");
}

writeFixture("ops/secure-sessions/evidence/release-manifest.schema.json", readFileSync(resolve(evidenceDirectory, "release-manifest.schema.json")));
writeFixture("ops/secure-sessions/evidence/phase-receipt.schema.json", readFileSync(resolve(evidenceDirectory, "phase-receipt.schema.json")));
const executionPath = "ops/secure-sessions/evidence/cutover-execution.receipt.json";
writeFixture(executionPath, `${JSON.stringify(execution)}\n`);
const rollbackEnvironment = { RELEASE_ID: "secure-sessions-rollback", PROJECT_REF: validManifest.supabaseProjectRef, DATABASE_URL: "postgres://fixture", PRIOR_VERCEL_DEPLOYMENT_ID: validManifest.priorVercelDeployment.deploymentId, VERCEL_PROJECT_ID: validManifest.vercelProjectId, VERCEL_ORG_ID: validManifest.vercelOrgId, GH_TOKEN: "github-token", GITHUB_REPOSITORY: authorization.repository };
const checkpointPath = resolve(fixtureRoot, "ops/secure-sessions/evidence/rollback-checkpoint-secure-sessions-rollback.json");
const rollbackAuthorizationPath = "ops/secure-sessions/evidence/rollback-authorization.json";
const rollbackBinding = {
  decision: "rollback", environment: "production", rollbackReleaseId: rollbackEnvironment.RELEASE_ID, expectedReleaseId: execution.releaseId,
  gitCommit: validManifest.gitCommit, manifestSha256: productionManifestSha256, executionReceiptSha256: digest(`${JSON.stringify(execution)}\n`),
  priorVercelDeploymentId: validManifest.priorVercelDeployment.deploymentId, priorFunctionGitSha: validManifest.priorFunctions.gitSha,
};
const rollbackCommentBody = `PIBA secure-session rollback authorization\n\n${JSON.stringify(rollbackBinding)}`;
const rollbackAuthorization = {
  provider: "github", repository: authorization.repository, issueNumber: 91, commentId: 92, actor: "incident-commander", authorizedAt: "2026-07-13T01:11:00Z",
  binding: rollbackBinding, commentBodySha256: digest(rollbackCommentBody),
};
const rollbackAuthorizationSource = `${JSON.stringify(rollbackAuthorization)}\n`;
writeFixture(rollbackAuthorizationPath, rollbackAuthorizationSource);
const providerFixtureResult = (command, args) => {
  if (command !== "gh") return null;
  const path = args.at(-1);
  if (path.endsWith("/issues/91")) return { status: 0, stdout: JSON.stringify({ number: 91, state: "open", title: `[secure-session-rollback] ${execution.releaseId}` }), stderr: "" };
  if (path.endsWith("/issues/comments/92")) return { status: 0, stdout: JSON.stringify({ user: { login: rollbackAuthorization.actor }, created_at: rollbackAuthorization.authorizedAt, body: rollbackCommentBody }), stderr: "" };
  if (path.endsWith(`/collaborators/${rollbackAuthorization.actor}/permission`)) return { status: 0, stdout: JSON.stringify({ permission: "maintain" }), stderr: "" };
  return { status: 1, stdout: "", stderr: `unexpected provider path: ${path}` };
};
const rollbackCommands = [];
const successfulRunner = (command, args) => {
  rollbackCommands.push([command, ...args]);
  const provider = providerFixtureResult(command, args);
  if (provider) return provider;
  if (command === "psql" && args.includes("-c")) return { status: 0, stdout: `compatibility|true|${rollbackEnvironment.RELEASE_ID}\n`, stderr: "" };
  return { status: 0, stdout: "fixture output", stderr: "" };
};
const rollbackOptions = { manifestPath, executionPath, environment: "production", checkpointPath, rollbackAuthorizationPath, env: rollbackEnvironment, baseDirectory: fixtureRoot, commandRunner: successfulRunner, sleepSync: () => {}, tempDirectory: fixtureRoot, now: () => new Date("2026-07-13T01:12:00Z") };
const rollbackResult = executeRollback(rollbackOptions);
assert.equal(rollbackResult.status, "rolled-back");
const rollbackRestoreRoot = rollbackCommands.find(([command]) => command === "tar")[4];
const ghArgs = (path) => ["gh", "api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28", path];
const providerRoot = `repos/${authorization.repository}`;
const expectedRollbackCommands = [
  ghArgs(`${providerRoot}/issues/${rollbackAuthorization.issueNumber}`),
  ghArgs(`${providerRoot}/issues/comments/${rollbackAuthorization.commentId}`),
  ghArgs(`${providerRoot}/collaborators/${rollbackAuthorization.actor}/permission`),
  ["npx", "--yes", "vercel@46.0.2", "rollback", validManifest.priorVercelDeployment.deploymentId, "--scope", validManifest.vercelOrgId],
  ["npx", "--yes", "vercel@46.0.2", "rollback", "status", "--scope", validManifest.vercelOrgId],
  ...validManifest.priorFunctions.bundles.flatMap((bundle) => [
    ["tar", "-xzf", bundle.location, "-C", rollbackRestoreRoot],
    ["npx", "--yes", "supabase@2.109.1", "functions", "deploy", bundle.name, "--project-ref", validManifest.supabaseProjectRef, "--workdir", rollbackRestoreRoot, "--use-api", "--no-verify-jwt"],
  ]),
  ["psql", rollbackEnvironment.DATABASE_URL, "-X", "-v", "ON_ERROR_STOP=1", "-v", `release_id=${rollbackEnvironment.RELEASE_ID}`, "-v", `expected_release_id=${execution.releaseId}`, "-f", validManifest.sqlRollback.path],
  ["psql", rollbackEnvironment.DATABASE_URL, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", "select migration_state || '|' || fallback_enabled::text || '|' || updated_by_release from public.security_settings where id"],
];
assert.deepEqual(rollbackCommands, expectedRollbackCommands, "rollback command plan must preserve exact executable, version, arguments, targets, and order");
for (const mutate of [
  (commands) => { commands.find(([command]) => command === "tar")[0] = "wrong-tar"; },
  (commands) => { commands.find((command) => command.includes("supabase@2.109.1"))[2] = "supabase@latest"; },
  (commands) => { commands.find((command) => command.includes("supabase@2.109.1"))[7] = "wrong-project"; },
  (commands) => { commands.find((command) => command.includes("vercel@46.0.2"))[4] = "wrong-deployment"; },
  (commands) => { commands.at(-1).splice(-2, 2, "-c", "select 1"); },
]) {
  const wrongCommands = structuredClone(expectedRollbackCommands);
  mutate(wrongCommands);
  assert.throws(() => assert.deepEqual(wrongCommands, expectedRollbackCommands), /Expected values to be strictly deep-equal/);
}
assert.equal(JSON.parse(readFileSync(checkpointPath, "utf8")).completedSteps.length, 8, "rollback must checkpoint every ordered step");
const resumedCommands = [];
assert.equal(executeRollback({ ...rollbackOptions, commandRunner: (command, args) => { resumedCommands.push([command, ...args]); return providerFixtureResult(command, args) ?? { status: 1, stdout: "", stderr: "unexpected mutation" }; } }).resumed, true);
assert.equal(resumedCommands.length, 3, "resumed rollback must only revalidate provider authorization");
assert.ok(resumedCommands.every(([command]) => command === "gh"), "resumed rollback repeated a mutation");
const validCheckpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
assert.equal(validCheckpoint.allowedSteps[0], "vercel", "rollback compatibility must be restored before prior functions");
assert.equal(validCheckpoint.authorizationReceiptSha256, digest(rollbackAuthorizationSource), "rollback checkpoint must bind rollback-specific authorization");
const rollbackAuthorizationFile = resolve(fixtureRoot, rollbackAuthorizationPath);
const invalidRollbackAuthorization = structuredClone(rollbackAuthorization);
invalidRollbackAuthorization.binding.expectedReleaseId = "different-release";
writeFileSync(rollbackAuthorizationFile, `${JSON.stringify(invalidRollbackAuthorization)}\n`);
const unauthorizedCommands = [];
assert.throws(() => executeRollback({ ...rollbackOptions, commandRunner: (...args) => { unauthorizedCommands.push(args); return { status: 0, stdout: "{}", stderr: "" }; } }), /content-bound/);
assert.equal(unauthorizedCommands.length, 0, "invalid local rollback authorization reached provider or mutation commands");
writeFileSync(rollbackAuthorizationFile, rollbackAuthorizationSource);
const mismatchedProviderCommands = [];
assert.throws(() => executeRollback({ ...rollbackOptions, commandRunner: (command, args) => {
  mismatchedProviderCommands.push([command, ...args]);
  const provider = providerFixtureResult(command, args);
  if (command === "gh" && args.at(-1).endsWith("/issues/comments/92")) {
    return { status: 0, stdout: JSON.stringify({ user: { login: "release-owner" }, created_at: rollbackAuthorization.authorizedAt, body: rollbackCommentBody }), stderr: "" };
  }
  return provider ?? { status: 1, stdout: "", stderr: "mutation forbidden" };
} }), /actor mismatch/);
assert.ok(mismatchedProviderCommands.every(([command]) => command === "gh"), "provider authorization failure reached a mutation command");
for (const mutation of [
  (value) => { value.manifestSha256 = digest("stale"); },
  (value) => { value.completedSteps[1] = "function:unknown"; },
  (value) => { value.completedSteps = [value.allowedSteps[1]]; },
]) {
  const invalid = structuredClone(validCheckpoint); mutation(invalid); writeFileSync(checkpointPath, `${JSON.stringify(invalid)}\n`);
  assert.throws(() => executeRollback(rollbackOptions), /checkpoint|stale|unknown|skipped|reordered/);
}
rmSync(checkpointPath, { force: true });
let failedAttempts = 0;
assert.throws(() => executeRollback({ ...rollbackOptions, commandRunner: () => { failedAttempts++; return { status: 1, stderr: "fixture failure" }; } }), /bounded retries/);
assert.equal(failedAttempts, 3, "rollback command retries must be bounded");
assert.equal(existsSync(checkpointPath), false, "failed rollback command must not skip or checkpoint its step");
let retryAttempts = 0;
executeRollback({ ...rollbackOptions, commandRunner: (command, args) => {
  const provider = providerFixtureResult(command, args);
  if (provider) return { ...provider, status: ++retryAttempts === 1 ? 1 : provider.status };
  if (command === "psql" && args.includes("-c")) return { status: 0, stdout: `compatibility|true|${rollbackEnvironment.RELEASE_ID}\n`, stderr: "" };
  return { status: 0, stdout: "fixture", stderr: "" };
} });
assert.ok(retryAttempts > 1, "rollback must retry transient command failures");
const preSqlCheckpoint = { ...validCheckpoint, completedSteps: validCheckpoint.allowedSteps.slice(0, -1), updatedAt: "2026-07-13T01:12:00Z" };
writeFileSync(checkpointPath, `${JSON.stringify(preSqlCheckpoint)}\n`);
let ambiguousMutationAttempts = 0;
const reconciledResult = executeRollback({ ...rollbackOptions, commandRunner: (command, args) => {
  const provider = providerFixtureResult(command, args);
  if (provider) return provider;
  if (command === "psql" && args.includes("-f")) {
    ambiguousMutationAttempts++;
    return { status: 1, stdout: "connection lost after commit", stderr: "connection lost" };
  }
  if (command === "psql" && args.includes("-c")) return { status: 0, stdout: `compatibility|true|${rollbackEnvironment.RELEASE_ID}\n`, stderr: "" };
  return { status: 1, stdout: "", stderr: "unexpected command" };
} });
assert.equal(reconciledResult.reconciled, true, "ambiguous committed rollback must be reported as reconciled");
assert.equal(ambiguousMutationAttempts, 1, "ambiguous committed rollback must not blindly retry mutation");
writeFileSync(checkpointPath, `${JSON.stringify(preSqlCheckpoint)}\n`);
let safeRetryMutationAttempts = 0;
let liveState = `hash_only|false|${execution.releaseId}`;
const safelyRetried = executeRollback({ ...rollbackOptions, commandRunner: (command, args) => {
  const provider = providerFixtureResult(command, args);
  if (provider) return provider;
  if (command === "psql" && args.includes("-f")) {
    safeRetryMutationAttempts++;
    if (safeRetryMutationAttempts === 1) return { status: 1, stdout: "", stderr: "pre-commit disconnect" };
    liveState = `compatibility|true|${rollbackEnvironment.RELEASE_ID}`;
    return { status: 0, stdout: "committed", stderr: "" };
  }
  if (command === "psql" && args.includes("-c")) return { status: 0, stdout: `${liveState}\n`, stderr: "" };
  return { status: 1, stdout: "", stderr: "unexpected command" };
} });
assert.equal(safelyRetried.reconciled, false, "successful retry should not be classified as ambiguous reconciliation");
assert.equal(safeRetryMutationAttempts, 2, "rollback mutation may retry only after proving exact pre-state");
writeFileSync(checkpointPath, `${JSON.stringify(preSqlCheckpoint)}\n`);
let unsafeMutationAttempts = 0;
assert.throws(() => executeRollback({ ...rollbackOptions, commandRunner: (command, args) => {
  const provider = providerFixtureResult(command, args);
  if (provider) return provider;
  if (command === "psql" && args.includes("-f")) {
    unsafeMutationAttempts++;
    return { status: 1, stdout: "", stderr: "ambiguous disconnect" };
  }
  if (command === "psql" && args.includes("-c")) return { status: 0, stdout: "compatibility|true|different-release\n", stderr: "" };
  return { status: 1, stdout: "", stderr: "unexpected command" };
} }), /live state is ambiguous/);
assert.equal(unsafeMutationAttempts, 1, "unknown live state must stop blind SQL retries");
assert.deepEqual(JSON.parse(readFileSync(checkpointPath, "utf8")).completedSteps, preSqlCheckpoint.completedSteps, "ambiguous SQL state must not checkpoint success");
for (const [path, mutate, message] of [
  [manifestPath, (value) => { delete value.releaseId; }, /manifest schema/],
  [executionPath, (value) => { value.status = "failed"; }, /execution receipt schema/],
  [execution.evidence.authorizationReceiptPath, (value) => { value.status = "succeeded"; }, /authorization receipt schema/],
]) {
  const original = readFileSync(resolve(fixtureRoot, path), "utf8"); const invalid = JSON.parse(original); mutate(invalid); writeFileSync(resolve(fixtureRoot, path), `${JSON.stringify(invalid)}\n`);
  assert.throws(() => executeRollback({ ...rollbackOptions, checkpointPath: resolve(fixtureRoot, "invalid-checkpoint.json") }), message);
  writeFileSync(resolve(fixtureRoot, path), original);
}

const detectorEnv = { SUPABASE_ACCESS_TOKEN: "token", SUPABASE_PROJECT_REF: "abcdefgh", GH_TOKEN: "github", GITHUB_REPOSITORY: "piba/repository", GITHUB_RUN_ID: "501", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: gitSha, GITHUB_ACTOR: "github-actions[bot]", GITHUB_SERVER_URL: "https://github.com", RUNNER_TEMP: fixtureRoot, INCIDENT_OWNER: "incident-owner", INCIDENT_LABELS: "security,production", PRODUCTION_ORIGIN: "https://piba.example" };
let telemetryAttempts = 0;
let telemetryQuery = "";
const probeRequestIds = ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102"];
let probeIndex = 0;
const detectorFetch = async (url, options = {}) => {
  const parsed = new URL(url);
  if (parsed.hostname === "piba.example") return new Response("{}", { status: 401, headers: { "x-request-id": probeRequestIds[probeIndex++] } });
  if (parsed.hostname === "api.supabase.com") {
    telemetryQuery = parsed.searchParams.get("sql") ?? "";
    telemetryAttempts++;
    if (telemetryAttempts === 1) return new Response("{}", { status: 500 });
    return Response.json({ result: telemetryEvents(probeRequestIds) });
  }
  if (parsed.pathname.endsWith("/actions/runs/501")) return Response.json({ created_at: "2026-07-13T00:20:00Z" });
  throw new Error(`unexpected detector route: ${options.method ?? "GET"} ${parsed.pathname}`);
};
const detectorResult = await runProductionDetection({ env: detectorEnv, fetchImpl: detectorFetch, sleep: async () => {}, now: new Date("2026-07-13T00:26:00Z") });
assert.equal(detectorResult.receipt.endpointResults.length, 7, "production receipt must store every endpoint result");
assert.equal(detectorResult.receipt.proxySyntheticResults.length, 2, "production receipt must store both same-origin proxy probes");
assert.equal(detectorResult.receipt.projectRef, detectorEnv.SUPABASE_PROJECT_REF, "production receipt did not bind telemetry project");
assert.equal(detectorResult.receipt.checkedOrigin, detectorEnv.PRODUCTION_ORIGIN, "production receipt did not bind checked origin");
assert.equal(telemetryAttempts, 2, "production telemetry must retry transient failures");
assert.match(telemetryQuery, /from function_logs/, "production telemetry must read function console logs");
assert.match(telemetryQuery, /json_value\(event_message, '\$\.endpoint'\)/, "production telemetry must parse completion fields from event_message");
assert.doesNotMatch(telemetryQuery, /from edge_logs/, "production telemetry must not read network logs for completion events");
for (const requestId of probeRequestIds) assert.ok(!telemetryQuery.includes(requestId), `production telemetry interpolated probe ID: ${requestId}`);
assert.doesNotMatch(telemetryQuery, /not in|\$\{|excludedRequestIds/i, "production telemetry SQL must never concatenate exclusion values");
const summarizedProbeEvents = summarizeProductionTelemetry([
  ...telemetryEvents(probeRequestIds),
  { endpoint: "login", status: 401, duration_ms: 2, request_id: "unrelated-request" },
], probeRequestIds);
assert.equal(summarizedProbeEvents.find(({ endpoint }) => endpoint === "login").sample_count, 31, "only exact synthetic IDs may be excluded");
assert.ok(summarizedProbeEvents.find(({ endpoint }) => endpoint === "login").auth_throttle_rate > 0, "unrelated auth failures must remain in telemetry");
assert.throws(() => summarizeProductionTelemetry(Array.from({ length: 1000 }, () => ({ endpoint: "login", status: 200, duration_ms: 1, request_id: null })), probeRequestIds), /row cap/);
await assert.rejects(runProxySynthetics({ origin: detectorEnv.PRODUCTION_ORIGIN, fetchImpl: async () => new Response("{}", { status: 503 }) }), /safe auth rejection/);
await assert.rejects(runProxySynthetics({ origin: detectorEnv.PRODUCTION_ORIGIN, fetchImpl: async () => { throw new Error("timeout"); } }), /timeout/);
await assert.rejects(runProxySynthetics({ origin: detectorEnv.PRODUCTION_ORIGIN, fetchImpl: async () => new Response("{}", { status: 401 }) }), /request ID/);
const slowClock = [0, 750];
await assert.rejects(runProxySynthetics({ origin: detectorEnv.PRODUCTION_ORIGIN, fetchImpl: async () => new Response("{}", { status: 401, headers: { "x-request-id": probeRequestIds[0] } }), clock: () => slowClock.shift() }), /exceeded 750ms/);
let malformedIncidentCreated = false;
let malformedProbeIndex = 0;
await assert.rejects(runProductionDetection({ env: detectorEnv, sleep: async () => {}, now: new Date("2026-07-13T00:26:00Z"), fetchImpl: async (url, options = {}) => {
  const parsed = new URL(url);
  if (parsed.hostname === "piba.example") return new Response("{}", { status: 401, headers: { "x-request-id": probeRequestIds[malformedProbeIndex++] } });
  if (parsed.hostname === "api.supabase.com") return Response.json({ result: null });
  if (parsed.pathname === "/search/issues") return Response.json({ items: [] });
  if (parsed.pathname.endsWith("/issues") && options.method === "POST") { malformedIncidentCreated = true; return Response.json({ number: 11 }); }
  return new Response("{}", { status: 404 });
} }), /malformed telemetry response/);
assert.equal(malformedIncidentCreated, true, "malformed or null telemetry must create/update the deterministic incident");
for (const mode of ["create", "update", "fallback"]) {
  const calls = [];
  const issueFetch = async (url, options = {}) => {
    const parsed = new URL(url); calls.push(`${options.method ?? "GET"} ${parsed.pathname}`);
    if (parsed.pathname === "/search/issues") return Response.json({ items: mode === "create" ? [] : [{ number: 9, title: "[secure-session-slo] production detection failure" }] });
    if (parsed.pathname.endsWith("/issues/9") && mode === "fallback") return new Response("{}", { status: 422 });
    if (parsed.pathname.endsWith("/comments")) return Response.json({ id: 10 });
    if (parsed.pathname.endsWith("/issues/9")) return Response.json({ number: 9 });
    if (parsed.pathname.endsWith("/issues")) return Response.json({ number: 8 });
    return new Response("{}", { status: 404 });
  };
  const issueResult = await upsertProductionIncident({ env: detectorEnv, action: "pipeline-failure", evidenceSha256: "unavailable", fetchImpl: issueFetch, sleep: async () => {} });
  assert.equal(issueResult.operation, mode === "fallback" ? "comment-fallback" : `${mode}d`);
}

if (process.argv[2] === "--validate-staging-bootstrap-authorization") {
  try {
    const gitCommitIndex = process.argv.indexOf("--git-commit");
    const repositoryIndex = process.argv.indexOf("--repository");
    const result = await validateStagingBootstrapAuthorization(process.argv[3], {
      gitCommit: gitCommitIndex === -1 ? process.env.GITHUB_SHA : process.argv[gitCommitIndex + 1],
      repository: repositoryIndex === -1 ? process.env.GITHUB_REPOSITORY : process.argv[repositoryIndex + 1],
      token: process.env.GH_TOKEN,
      supabaseToken: process.env.SUPABASE_ACCESS_TOKEN,
      databaseUrl: process.env.PIBA_STAGING_DATABASE_URL,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "staging bootstrap authorization failed");
    process.exitCode = 1;
  }
} else if (process.argv[2] === "--validate-cutover") {
  try {
    const environmentIndex = process.argv.indexOf("--environment");
    const gitCommitIndex = process.argv.indexOf("--git-commit");
    const repositoryIndex = process.argv.indexOf("--repository");
    const result = await validatePreCutoverEvidence(process.argv[3], {
      environment: environmentIndex === -1 ? undefined : process.argv[environmentIndex + 1],
      gitCommit: gitCommitIndex === -1 ? process.env.GITHUB_SHA : process.argv[gitCommitIndex + 1],
      repository: repositoryIndex === -1 ? process.env.GITHUB_REPOSITORY : process.argv[repositoryIndex + 1],
      token: process.env.GH_TOKEN,
      offlineFixture: process.argv.includes("--offline-fixture"),
    });
    console.log(JSON.stringify({ status: "validated", ...result }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "pre-cutover validation failed");
    process.exitCode = 1;
  }
} else {
  console.log("secure session foundation static contract: PASS");
}

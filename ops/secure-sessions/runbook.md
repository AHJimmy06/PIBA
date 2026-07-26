# Secure session rollout and rollback

This runbook separates local evidence, the limited session-infrastructure staging bootstrap, and any later production rollout. The staging bootstrap is non-production input: it cannot authorize production, cannot support the public frontend, and is never part of production rollback. Do not run a command containing `<PROJECT_REF>`, `<DATABASE_URL>`, or a deployment command during SDD apply.

Delivery status: PR1 through PR5 are nondeployable chain slices. Only the tracker aggregate containing every accepted slice is eligible for deployment. The staging rehearsal remains pending separate authorization; templates and local gate output are not deployment receipts.

## Preconditions

1. Use Node 22, Deno 2.1.4, Supabase CLI 2.109.1, and a running Docker daemon. CI pins the setup actions by commit and the Postgres 17.6.1.143 harness image by multi-platform digest; update those pins only in a reviewed dependency change.
2. Create a release manifest from `ops/secure-sessions/evidence/release-manifest.template.json`; replace every placeholder and record the exact seven production artifact checksums plus the separately classified `stagingBootstrap` SQL and verification checksums. The staging inputs are provider-bound evidence but have `productionEligible=false` and `rollbackMutation=false`; they never become production mutation or rollback steps. Extra, missing, duplicate, renamed, or mismatched artifacts fail the gate.
3. Bind the tracker/final pull request number and GitHub deployment/run records in the manifest's `deploymentAuthorization` evidence and validate the manifest against `release-manifest.schema.json`. Production authorization comes from two provider-authenticated `APPROVED` pull-request reviews on the manifest commit: distinct `security` and `release-owner` actors and review IDs, neither authored by the pull-request author. The receipt also binds the exact successful `validate-production-cutover` job ID, URL, and attempt. Its presence in the trusted `workflow_dispatch` run proves `validate_production_cutover=true`; the run must use `refs/heads/main` and the job must use the protected `production` environment. Dismissed, superseded, stale-commit, duplicate-actor, self-authored reviews, missing jobs, or failed jobs fail closed. The verifier queries documented pull request, review, deployment, deployment-status, workflow-run, run-jobs, workflow, repository, contents, and Git blob endpoints; it does not claim GitHub exposes protected-environment reviewer identities through an unsupported API.
4. Confirm `compatibilityEndsAt` is no more than 72 hours after a possible rollback and that the prior function Git SHA/bundles, prior immutable Vercel deployment, and SQL rollback artifact remain available until that time.
5. Configure repository secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`, repository variable `SECURE_SESSION_PRODUCTION_ORIGIN`, protect the GitHub `production` environment, and enable the `production-detection` scheduled check. Production detection runs only for `main`, uses bounded API retries, and fails closed for missing secrets, API errors, malformed/empty/null/non-finite samples, fewer than 30 samples for any endpoint, evaluator errors, threshold breaches, proxy synthetic 5xx/timeout/latency, or failure to create/update the stable-key incident issue. The proxy probes execute an invalid login and unauthenticated current-user request through the actual same-origin production HTTP boundary without creating or modifying users. Bind the workflow's actual byte checksum and successful detection receipt in the manifest.
6. Never place production URLs, database passwords, access tokens, service-role keys, peppers, signing keys, codes, hashes, tokens, or PII in CI output or receipts.

## Local evidence

Run in this exact order from the repository root:

```bash
npm ci
deno --version
supabase --version
docker version
npm run security:gate
npx eslint scripts/verify-secure-session-foundation.mjs src/core/domain/ports/UserRepository.ts src/infrastructure/api/SessionApi.ts src/infrastructure/mappers/UserMapper.ts src/infrastructure/repositories/SupabaseUserRepository.ts src/main.tsx src/presentation/context/AuthContext.ts src/presentation/context/AuthProvider.tsx src/presentation/context/auth-context.ts src/presentation/context/useAuth.ts src/presentation/views/LoginView.tsx src/test/auth-context.test.tsx src/test/login-view.test.tsx src/test/session-api.test.ts src/test/setup.ts supabase/functions/_shared/crypto.ts supabase/functions/_shared/db.ts supabase/functions/_shared/http.test.ts supabase/functions/_shared/http.ts supabase/functions/_shared/session.ts supabase/functions/backfill/index.test.ts supabase/functions/backfill/index.ts supabase/functions/endpoint-matrix.test.ts supabase/functions/refresh-db.integration.test.ts supabase/functions/session-login/index.ts supabase/functions/session-logout/index.ts supabase/functions/session-profile/index.ts supabase/functions/session-refresh/index.ts supabase/functions/session-users/index.ts vite.config.ts
git diff --check
docker ps --filter 'name=piba-session-harness-' --format '{{.Names}}'
```

Expected evidence: `security:gate` exits zero; Deno check/tests, disposable SQL harness, focused/full client tests, and build pass; focused lint and diff check exit zero; the final Docker command prints no harness container. Preserve command output hashes outside the repository and record only those SHA-256 values in receipts.

The disposable SQL harness starts with an empty application schema, applies `ops/secure-sessions/staging/bootstrap.sql` through bound psql variables, verifies the complete deny-by-default contract, applies every migration from `20260408014035` onward, and verifies the contract again before inserting synthetic fixtures.

Verifier fixtures use a unique per-process directory under the operating-system temporary directory. `npm run verify:secure-sessions` selects their explicit `--offline-fixture` mode. That mode is test-only and prohibited with `--environment production`; it never reads, rewrites, or deletes operational evidence. Production cannot select fixtures or skip provider verification.

Repository-wide lint is known baseline debt, not a passing secure-session gate. `npm run lint -- --quiet` is expected to exit nonzero with 18 errors; `npm run lint` reports the same 18 errors plus 1 warning in legacy files outside this change. Record that result honestly until the baseline debt is corrected separately; do not disable rules or hide failures.

## Limited session staging bootstrap

Set only in an approved operator shell. Do not commit these values:

```bash
export RELEASE_ID='<APPROVED_RELEASE_ID>'
export PIBA_DEPLOY_ENV='staging'
export PIBA_STAGING_PROJECT_REF='ejxfoxbfndplinraqrvw'
export PIBA_STAGING_DATABASE_URL='<MODE_0600_OR_PROTECTED_SHELL_DATABASE_URL>'
export PIBA_RELEASE_MANIFEST='ops/secure-sessions/evidence/release-manifest.json'
export PIBA_GIT_COMMIT='<APPROVED_40_CHAR_GIT_SHA>'
export GH_TOKEN='<GITHUB_TOKEN_WITH_PROVIDER_READ_ACCESS>'
export GITHUB_REPOSITORY='<OWNER/REPOSITORY>'
export SUPABASE_ACCESS_TOKEN='<SUPABASE_PROVIDER_ACCESS_TOKEN>'
export FUNCTION_VERSION='<FUNCTION_VERSION>'
export CLIENT_VERSION='<CLIENT_VERSION>'
sha256sum ops/secure-sessions/evidence/release-manifest.json
```

The only approved target is `PIBA_STAGING` (`ejxfoxbfndplinraqrvw`). Before connecting, the runner validates the manifest and provider-authenticated GitHub reviews/deployment at the exact commit, then fetches that exact project from the Supabase Management API and requires `ACTIVE_HEALTHY`. It parses the database URL structurally: direct connections require host `db.ejxfoxbfndplinraqrvw.supabase.co`, user `postgres`, and port 5432; supported pooler connections require a `*.pooler.supabase.com` host, user `postgres.ejxfoxbfndplinraqrvw`, and port 5432 or 6543. Both require database `/postgres`, a password, and the sole query parameter `sslmode=require`. The runner then proves the live PostgreSQL connection uses SSL. Refs in passwords, paths, fragments, or query parameters never establish identity. URLs and credentials must never be printed.

```bash
scripts/bootstrap-secure-session-staging.sh
supabase migration list --db-url "$PIBA_STAGING_DATABASE_URL"
```

Stop after session-infrastructure verification. Do not deploy the public frontend against this backend: direct songs, rehearsals, memberships, chords, and backgrounds calls are expected to fail because client table grants and permissive policies do not exist. The limited-staging client deliberately disables Supabase Realtime, creates no Broadcast channels, and provides no cross-client rehearsal synchronization; restoring Realtime requires a separately authorized server-enforced channel policy. Never use `supabase db push --include-all`; the bootstrap is not a migration and production history must remain unchanged.

The runner is a four-state recovery machine: `fresh` applies the atomic bootstrap; `bootstrapped` and exact `migrations-1` through `migrations-3` prefixes run one `db push`; `complete` skips mutation and reruns final verification. A failed push is never retried blindly in the same invocation. Rerun the same command after correcting the external failure: it revalidates both providers, URL/SSL identity, the complete bootstrap contract, and exact migration prefix before resuming. Unknown objects, partial bootstrap structure, unexpected/reordered history, or failed final verification stop without cleanup or another mutation. Never manually delete migration rows or bootstrap objects to force progress.

## Future full rollout (not authorized by limited staging)

The remaining phases require a separate architecture and authorization that provides full application-data access control. Before any future production foundation push, run the read-only gate with real psql variables; it rejects the staging bootstrap history and accepts only the established production baseline:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v deployment_environment=production \
  -v target_project_ref="$PROJECT_REF" \
  -v production_project_ref="$PROJECT_REF" \
  -f ops/secure-sessions/migration_drift_gate.sql
supabase db push --db-url "$DATABASE_URL"
```

2. Function deploy, actor role `function-operator`. Configure the remote Edge runtime before deployment. The five backfill settings are server environment values, not CLI-shell exports; keep their values out of the repository and use a mode-0600 temporary env file so the release secret does not appear in command arguments or history:

```bash
BACKFILL_ENV_FILE="$(mktemp)"
chmod 600 "$BACKFILL_ENV_FILE"
read -rs -p 'Release-specific backfill secret: ' PIBA_BACKFILL_CALLER_SECRET
printf 'PIBA_DEPLOY_ENV=staging\nPIBA_BACKFILL_PROJECT_REF=%s\nPIBA_BACKFILL_RELEASE_ID=%s\nPIBA_BACKFILL_SECRET=%s\nPIBA_BACKFILL_EXPECTED_COUNT=7\n' \
  "$PROJECT_REF" "$RELEASE_ID" "$PIBA_BACKFILL_CALLER_SECRET" >"$BACKFILL_ENV_FILE"
supabase secrets set --project-ref "$PROJECT_REF" --env-file "$BACKFILL_ENV_FILE"
rm -f "$BACKFILL_ENV_FILE"
mkdir -p ops/secure-sessions/artifacts/functions/current
for function in session-login session-refresh session-logout session-users session-profile backfill; do
  tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -czf "ops/secure-sessions/artifacts/functions/current/${function}.tar.gz" \
    "supabase/functions/${function}" supabase/functions/_shared supabase/functions/deno.json supabase/functions/deno.lock
  sha256sum "ops/secure-sessions/artifacts/functions/current/${function}.tar.gz"
done
supabase functions deploy session-login session-refresh session-logout session-users session-profile backfill --project-ref "$PROJECT_REF" --no-verify-jwt
supabase functions list --project-ref "$PROJECT_REF"
```

Record `FUNCTION_VERSION`, the exact six-function inventory, each immutable source-bundle location/hash in both the manifest and function receipt, and the deployment output checksum. Required server-only values are `SUPABASE_SERVICE_ROLE_KEY`, `PIBA_SESSION_PEPPER`, ES256 signing/JWK material, `PIBA_ALLOWED_ORIGINS`, and `PIBA_PROXY_SECRET`. Confirm that the hosted Edge runtime also exposes `SUPABASE_PUBLISHABLE_KEYS`, the platform-managed JSON dictionary of modern publishable keys; `SUPABASE_ANON_KEY` remains accepted during the legacy transition. The proxy secret must be a high-entropy value shared only with the Vercel server environment; never expose it through a `VITE_` variable.

3. Client and HttpOnly proxy deploy, actor role `client-operator`. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `PIBA_PROXY_SECRET` in the Vercel server environment for the exact staging or production target before building. `SUPABASE_PUBLISHABLE_KEY` must be a modern `sb_publishable_...` key present in the Edge runtime's `SUPABASE_PUBLISHABLE_KEYS` dictionary. During the legacy transition only, omit `SUPABASE_PUBLISHABLE_KEY` and configure the matching `SUPABASE_ANON_KEY` instead. The proxy prefers the modern key whenever it is present and fails closed if it is malformed; it never falls back from a malformed modern value. `SUPABASE_URL` must use HTTPS, the selected key must belong to that project, and `PIBA_PROXY_SECRET` must exactly match the Edge secret configured in phase 2. None of these values belongs in the browser bundle; in particular, do not use a `VITE_` prefix for proxy secrets.

```bash
npm ci
npm run build
sha256sum dist/assets/* | sort | sha256sum
```

Deploy `dist/` and `api/session/index.ts` together using the approved Vercel procedure. Against the immutable deployment URL, verify that `GET /api/session/current-user` returns `401` without a cookie, includes `Cache-Control: no-store`, and never returns a session token in its body. Then verify login/refresh/logout through the same-origin `/api/session/*` routes without inspecting or recording the HttpOnly cookie value. Record `CLIENT_VERSION`, provider deployment ID, asset-manifest checksum, the three server environment variable names (never their values), and `proxyEnvironmentVerified=true`. The browser must not persist a session token in local or session storage.

4. Backfill, actor role `backfill-operator`:

```bash
PIBA_BACKFILL_EXPECTED_COUNT=7 supabase functions invoke backfill --project-ref "$PROJECT_REF" --method POST \
  --header "x-piba-backfill-secret: $PIBA_BACKFILL_CALLER_SECRET" \
  --header "x-piba-environment: staging" \
  --header "x-piba-project-ref: $PROJECT_REF" \
  --header "x-piba-release-id: $RELEASE_ID"
```

The successful response must include `serverEnvironmentVerified=true`, `expected=7`, `processed+skipped=7`, `verified=7`, and `remaining=0`. The backfill and cutover authorization receipts must carry the same expected and verified totals. This is runtime proof that the deployed function read and matched the remote settings; shell values alone are not evidence. Stop before cutover on any mismatch.
Every invocation, including localhost, requires matching caller environment, project, release, and high-entropy secret headers. The handler compares the caller secret to the server-only `PIBA_BACKFILL_SECRET` in constant time and never compares two environment values as authorization. Remote execution additionally requires the exact `staging` designation and canonical project URL. Rotate/delete the secret immediately after recording the receipt. `production` is always denied by this runner.

5. Observe staging for exactly one continuous 30-minute window. The `release-owner` owns the decision; the `function-operator` runs the queries and records the secret-free output SHA-256, UTC start/end, unique query IDs, per-SLO results/sample counts/thresholds/decisions/owners, and both actors in the cutover receipt. Bind the immutable function and client versions through their manifest-referenced deployment receipt paths and SHA-256 values; also record the function deployment output checksum, client provider deployment ID, and client asset-manifest checksum.

Use the Dashboard Logs Explorer for `function_logs` with this filter and export only aggregate results. Completion telemetry is emitted as JSON in `event_message`; endpoint, status, failure class, and duration are not top-level log columns. CORS responses, including rejected origins and successful `OPTIONS` preflights, are explicitly excluded from completion telemetry:

```sql
select json_value(event_message, '$.endpoint') as endpoint,
       cast(json_value(event_message, '$.status') as int64) as status,
       coalesce(json_value(event_message, '$.failure_class'), 'none') as failure_class,
       count(*) as requests,
       approx_quantiles(cast(json_value(event_message, '$.duration_ms') as float64), 100)[offset(95)] as p95_ms
from function_logs
where timestamp >= timestamp('<OBSERVATION_START_UTC>')
  and timestamp < timestamp('<OBSERVATION_END_UTC>')
  and json_value(event_message, '$.endpoint') in ('login','refresh','logout','current-user','list-users','create-user','update-profile')
group by endpoint,status,failure_class order by endpoint,status,failure_class;
```

Also run the approved synthetic sequence every minute: login, profile, refresh, replay of the prior token (must be 401), logout, and reuse of the copied token (must be 401). Do not print tokens or user data. Evaluate each of the seven endpoints independently: successful endpoint p95 `<750 ms`; unexpected 5xx `<1%`; all non-success responses `<2%`; auth rejection plus 429 `<5%`; synthetic rejection `100%`. Aggregate results may supplement but never replace endpoint decisions. A single endpoint at `>=1%` unexpected 5xx, `>=2%` non-success, `>=5%` auth/429, p95 `>=750 ms`, with missing fields, with fewer than 30 samples, or missing entirely is a stop condition. Static endpoint lists are not synthetic evidence and cannot bypass the minimum sample requirement. The cutover receipt stores seven endpoint-specific rows and binds the production detector evidence hash; the validator requires both sources to contain the same endpoint inventory with passing decisions.

Automatic rollback trigger: any copied-token reuse succeeds, family revocation fails, or unexpected 5xx reaches `5%` in any rolling five-minute interval. The incident commander immediately executes the finite rollback. Manual rollback trigger: any other stop condition persists for two consecutive five-minute intervals; the release-owner records the decision and incident commander receipt reference. A triggered automatic rollback requires `status=failed|rolled-back`, `automaticRollbackTriggered=true`, `manualRollbackDecision=not-required`, `decision=rollback`, and non-placeholder `incidentReceiptId`, `incidentReceiptPath`, and `incidentReceiptSha256`. A manual rollback requires `status=failed|rolled-back`, `automaticRollbackTriggered=false`, `manualRollbackDecision=rollback-required`, `decision=rollback`, at least one truthful failed SLO result, and the same incident binding. Create the incident receipt from `incident.receipt.template.json`, validate it against `incident-receipt.schema.json`, and store it as `ops/secure-sessions/evidence/incident-<id>.receipt.json`; its ID/release/checksum must match the cutover receipt. All three incident fields must be explicit nulls only when neither rollback path is required, every SLO passes, `status=succeeded`, and the decision is `proceed`. No cutover is allowed unless every SLO passes for the complete 30 minutes and the cutover receipt contains all schema-required observation, immutable version, SLO, rollback-decision, incident, and distinct approval evidence.

6. Cutover, actor role `release-owner`. After observation succeeds, complete the pre-cutover authorization receipt with `status=approved` and `targetMigrationState=hash_only`; it MUST NOT claim SQL execution. Every phase receipt must have the exact target environment. Immediately before SQL, validate the manifest and foundation, function, client, backfill, and cutover authorization receipts. Production additionally requires exact `GITHUB_SHA` binding, provider-authenticated pull-request approvals, a successful bound deployment record, and a successful production-detection receipt completed within ten minutes with workflow hash, configured secret names, health timestamp, run ID, run attempt, creation time, run URL, and all endpoint results:

```bash
npm run validate:secure-session-cutover -- ops/secure-sessions/evidence/release-manifest.json --environment staging --git-commit "$GITHUB_SHA"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v release_id="$RELEASE_ID" -f ops/secure-sessions/cutover.sql | tee "$RUNNER_TEMP/cutover.sql.output"
completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

For production, use a `GITHUB_TOKEN` from the workflow with `actions:read`, `contents:read`, `deployments:read`, and `pull-requests:read`, or a fine-grained PAT with repository Actions, Contents, Deployments, and Pull requests read access. A classic PAT for a private repository requires `repo`. Never print the token. The validator requires `GH_TOKEN` plus `GITHUB_REPOSITORY`, unless `--repository owner/repo` is explicit:

```bash
GH_TOKEN="$GH_TOKEN" GITHUB_REPOSITORY="$GITHUB_REPOSITORY" \
  npm run validate:secure-session-cutover -- ops/secure-sessions/evidence/release-manifest.json \
  --environment production --git-commit "$GITHUB_SHA" --repository "$GITHUB_REPOSITORY"
```

Staging receipts cannot pass that command. Immediately after SQL succeeds, create `cutover-execution.receipt.json` with `phase=cutover-execution` and validate it against `phase-receipt.schema.json`. Bind the unchanged authorization receipt hash, SQL file/output hashes, actor, actual commit, UTC start/completion, `status=succeeded`, and observed `resultingMigrationState=hash_only`. Never rewrite the approved authorization receipt. Rollback uses this execution receipt's `releaseId` as `expected_release_id`; it never infers live state from the rollback request ID.

Production uses the same order only under a separate production authorization. Staging receipts are evidence, not production approval. Production verification must target the immutable Vercel deployment and confirm the same three server-only proxy environment names before traffic is moved.
The release gate requires the manifest-bound `production-detection` check and documented secret-name evidence before production cutover. Each expected rejection probe must return a unique valid `x-request-id`. Request IDs never enter SQL: the detector fetches the bounded raw telemetry fields and excludes exactly those two validated IDs in memory before aggregation. It does not exclude by status or endpoint, so every unrelated 4xx, 401, and 429 remains in the SLO sample. The receipt binds `projectRef` to `manifest.supabaseProjectRef` and `checkedOrigin` to `manifest.clientDeploymentUrl`; GitHub deployment and latest deployment-status evidence must report that same immutable URL. Copy the successful run's JSON receipt from its GitHub step summary into `productionDetection.evidence`; the validator fetches exact authorization and detection runs, the exact successful cutover job, workflow IDs/paths, trusted default-branch refs/events, attempts, timestamps, tracker/final PR reviews at the exact commit, deployment, and bound deployment status. It also fetches the release manifest, mandatory production artifacts, non-production staging bootstrap evidence, candidate function bundles, and workflow as repository contents or Git blobs at `gitCommit`, then compares their exact bytes and SHA-256 values; local files can never substitute for provider content. The security approver must have GitHub `admin`; the release owner must have `push`, `maintain`, or `admin`; actors must be distinct. If `SECURITY_APPROVER_TEAM_SLUG` is configured, the security approver must additionally have active organization-team membership. API errors and rate limits fail closed. Preserve API responses outside the repository. Prose, arbitrary actor strings, or a manually viewed dashboard are not evidence.

## Finite rollback

Rollback requires an incident commander and the manifest-bound prior function Git SHA and six source-bundle locations/hashes, prior Vercel immutable deployment ID/URL, and SQL rollback path/hash. It never applies, removes, or reconciles the non-production staging bootstrap. The prior Vercel deployment must be the deployment paired with those prior functions and configured to forward their accepted legacy `SUPABASE_ANON_KEY`. Capture these immutable artifacts before function deployment. The Supabase CLI writes downloaded source beneath the supplied project workdir; package each function with its shared dependencies and record the resulting tarball path/hash:

```bash
PRIOR_ROOT="$(mktemp -d)"
mkdir -p ops/secure-sessions/artifacts/functions
for function in session-login session-refresh session-logout session-users session-profile backfill; do
  supabase functions download "$function" --project-ref "$PROJECT_REF" --use-api --workdir "$PRIOR_ROOT"
  tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -czf "ops/secure-sessions/artifacts/functions/${function}.tar.gz" \
    -C "$PRIOR_ROOT" "supabase/functions/${function}" supabase/functions/_shared supabase/functions/deno.json supabase/functions/deno.lock
  sha256sum "ops/secure-sessions/artifacts/functions/${function}.tar.gz" >"ops/secure-sessions/artifacts/functions/${function}.tar.gz.sha256"
done
rm -rf "$PRIOR_ROOT"
```

Do not proceed until all six immutable locations and reproduced hashes are in the manifest.

Use the executable, fail-fast rollback with pinned Supabase `2.109.1` and Vercel `46.0.2` CLIs. Before any mutation, create an open GitHub issue titled `[secure-session-rollback] <CUTOVER_RELEASE_ID>`. A repository incident commander with `maintain` or `admin` permission, distinct from the cutover actor and all cutover/deployment approvers, must post exactly `PIBA secure-session rollback authorization`, two newlines, and the compact JSON binding below. Store the matching local authorization receipt outside source control; its `commentBodySha256` is the SHA-256 of that exact comment body. The executor reads the local receipt, fetches the issue, comment, actor, and permission from GitHub with `GH_TOKEN`, and rejects local substitution, closed issues, mismatched content, future timestamps, or reused governance actors before running Vercel, Supabase, or SQL commands.

```json
{
  "provider": "github",
  "repository": "OWNER/REPOSITORY",
  "issueNumber": 1,
  "commentId": 1,
  "actor": "INCIDENT_COMMANDER_GITHUB_LOGIN",
  "authorizedAt": "2026-01-01T00:00:00Z",
  "binding": {
    "decision": "rollback",
    "environment": "production",
    "rollbackReleaseId": "APPROVED_ROLLBACK_RELEASE_ID",
    "expectedReleaseId": "ACTUAL_CUTOVER_RELEASE_ID",
    "gitCommit": "MANIFEST_GIT_COMMIT",
    "manifestSha256": "RELEASE_MANIFEST_SHA256",
    "executionReceiptSha256": "CUTOVER_EXECUTION_RECEIPT_SHA256",
    "priorVercelDeploymentId": "MANIFEST_BOUND_DEPLOYMENT_ID",
    "priorFunctionGitSha": "MANIFEST_BOUND_PRIOR_FUNCTION_GIT_SHA"
  },
  "commentBodySha256": "EXACT_GITHUB_COMMENT_BODY_SHA256"
}
```

After provider authorization succeeds, the executor first restores the prior Vercel deployment and waits for provider-confirmed rollback status, so callers forward the legacy anon key that both current and prior functions accept. Only then does it verify and restore each prior function bundle, followed by SQL. It retries each remote operation with bounded backoff, checkpoints every completed Vercel/function/SQL step, and resumes without repeating completed mutation steps. Any failed step stops the rollback. This order prevents a modern-key proxy from calling legacy-only functions; no current function is deleted before its prior version is live.

```bash
export RELEASE_ID='<APPROVED_ROLLBACK_RELEASE_ID>'
export PROJECT_REF='<AUTHORIZED_PROJECT_REF>'
export DATABASE_URL='<AUTHORIZED_DIRECT_DATABASE_URL>'
export PRIOR_VERCEL_DEPLOYMENT_ID='<MANIFEST_BOUND_DEPLOYMENT_ID>'
export VERCEL_PROJECT_ID='<MANIFEST_BOUND_PROJECT_ID>'
export VERCEL_ORG_ID='<MANIFEST_BOUND_ORG_ID>'
export GH_TOKEN='<GITHUB_TOKEN_WITH_ISSUES_AND_METADATA_READ>'
export GITHUB_REPOSITORY='<OWNER/REPOSITORY>'
export ROLLBACK_AUTHORIZATION_PATH='<MODE_0600_ROLLBACK_AUTHORIZATION_JSON>'
npm run rollback:secure-sessions -- \
  ops/secure-sessions/evidence/release-manifest.json \
  ops/secure-sessions/evidence/cutover-execution.receipt.json \
  production \
  ops/secure-sessions/evidence/rollback-checkpoint-$RELEASE_ID.json \
  "$ROLLBACK_AUTHORIZATION_PATH"
```

The executor validates manifest, cutover authorization, execution, rollback authorization, and checkpoint evidence before mutation; hashes their actual bytes; binds release, environment, candidate commit, manifest, authorization, cutover/rollback SQL, current/prior function bundles, and Vercel/Supabase targets. Environment target IDs must equal the manifest and never override it. The checkpoint's `authorizationReceiptSha256` is the rollback-specific authorization receipt hash; the execution receipt transitively preserves the earlier cutover authorization hash. Checkpoints are atomically replaced, identity-bound, ordered prefixes of the eight allowed steps, and rejected when stale, unknown, skipped, or reordered. Complete `rollback.receipt.template.json` with the rollback authorization/execution/checkpoint hashes, its release as `expectedReleaseId`, checkpoint receipt path, exact prior artifacts, output hashes, and compatibility deadline. The script supplies both `release_id=$RELEASE_ID` and `expected_release_id=<actual cutover release>` to SQL. After every SQL attempt, including an apparent success, it reads live `security_settings` state. A failed command is retried only when live state still exactly matches the pre-rollback cutover release; an already-applied state is checkpointed as reconciled, while unknown or contradictory state stops without retry or checkpoint. Retain credentials and audit evidence, never rewrite migration history, never restore browser access to credentials, and remove compatibility through a separately reviewed release before the recorded deadline.

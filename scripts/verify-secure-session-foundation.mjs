import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migrationsDirectory = resolve(root, "supabase/migrations");
const migrationPath = resolve(migrationsDirectory, "20260408020000_secure_session_foundation.sql");
const baselineMigrationPath = resolve(migrationsDirectory, "20260408014035_fix_rehearsal_song_chords_fk.sql");
const cutoverPath = resolve(root, "ops/secure-sessions/cutover.sql");
const rollbackPath = resolve(root, "ops/secure-sessions/rollback.sql");
const driftGatePath = resolve(root, "ops/secure-sessions/migration_drift_gate.sql");
const foundationRemovalPath = resolve(root, "ops/secure-sessions/foundation-removal.sql");
const testPath = resolve(root, "supabase/tests/secure_sessions.sql");
const baselinePath = resolve(root, "ops/secure-sessions/drift-baseline.json");

for (const path of [migrationPath, baselineMigrationPath, cutoverPath, rollbackPath, driftGatePath, foundationRemovalPath, testPath, baselinePath]) {
  assert.ok(existsSync(path), `missing security-slice artifact: ${path}`);
}

const migrationFiles = readdirSync(migrationsDirectory).filter((file) => file.endsWith(".sql")).sort();
assert.deepEqual(migrationFiles, [
  "20260408014035_fix_rehearsal_song_chords_fk.sql",
  "20260408020000_secure_session_foundation.sql",
], "local migration inventory contains an unexpected, renamed, or duplicate migration");

const migration = readFileSync(migrationPath, "utf8");
const baselineMigration = readFileSync(baselineMigrationPath, "utf8");
const cutover = readFileSync(cutoverPath, "utf8");
const rollback = readFileSync(rollbackPath, "utf8");
const driftGate = readFileSync(driftGatePath, "utf8");
const foundationRemoval = readFileSync(foundationRemovalPath, "utf8");
const sqlTests = readFileSync(testPath, "utf8");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

assert.equal(baseline.approvedRemoteBaseline, "20260408014035");
assert.equal(baseline.approvedMigrationName, "fix_rehearsal_song_chords_fk");
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
const firstPrivateDrop = foundationRemoval.search(/drop function app_private\./i);
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

console.log("secure session foundation static contract: PASS");

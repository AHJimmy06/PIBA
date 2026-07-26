#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
name="piba-session-harness-$RANDOM-$RANDOM"
image="${PIBA_SESSION_HARNESS_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.143}"
if command -v deno >/dev/null 2>&1; then deno_cmd=(deno); else deno_cmd=(npx --yes deno); fi
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=piba_session_harness "$image" >/dev/null
for _ in $(seq 1 120); do
  if docker exec "$name" psql -U supabase_admin -d piba_session_harness -XAtqc "select pg_postmaster_start_time() < clock_timestamp() - interval '2 seconds'" 2>/dev/null | grep -qx t; then break; fi
  sleep 1
done
docker exec "$name" psql -U supabase_admin -d piba_session_harness -XAtqc 'select 1' >/dev/null

sql() { docker exec -e PGOPTIONS='-c statement_timeout=15s' -i "$name" psql -U supabase_admin -d piba_session_harness -X -v ON_ERROR_STOP=1 "$@"; }
fail() { if sql "$@"; then printf 'expected SQL failure: %s\n' "$*" >&2; exit 1; fi; }
fail_with() {
  expected="$1"
  shift
  if output="$(sql "$@" 2>&1)"; then
    printf 'expected SQL failure containing %s: %s\n' "$expected" "$*" >&2
    exit 1
  fi
  if [[ "$output" != *"$expected"* ]]; then
    printf 'SQL failure did not contain %s:\n%s\n' "$expected" "$output" >&2
    exit 1
  fi
}
hold_foundation_locks() {
  docker exec -e PGOPTIONS='-c statement_timeout=15s' "$name" psql -U supabase_admin -d piba_session_harness -X -v ON_ERROR_STOP=1 -c \
    "begin; lock table public.users, app_private.user_credentials, public.security_settings in access exclusive mode; select pg_sleep(7); rollback" >/dev/null &
  lock_pid=$!
  sleep 1
}

sql <<'SQL'
drop schema if exists app_private cascade; drop schema if exists extensions cascade; drop schema if exists supabase_migrations cascade;
drop table if exists public.security_settings cascade; drop table if exists public.rehearsal_song_chords cascade;
drop table if exists public.rehearsal_songs cascade; drop table if exists public.rehearsal_users cascade;
drop table if exists public.rehearsals cascade; drop table if exists public.background_assets cascade;
drop table if exists public.songs cascade; drop table if exists public.users cascade;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema extensions; create extension pgcrypto with schema extensions;
create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text not null);
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key, name text not null, public boolean not null default false);
SQL
bootstrap_args=(-v bootstrap_environment=staging -v target_project_ref=ejxfoxbfndplinraqrvw)
fail_with 'STAGING_BOOTSTRAP_TARGET_REJECTED' -v bootstrap_environment=staging -v target_project_ref=alternatestaging < "$root/ops/secure-sessions/staging/bootstrap.sql"
fail_with 'STAGING_BOOTSTRAP_TARGET_REJECTED' -v bootstrap_environment=staging -v target_project_ref=kyrgdkghgyazmphvpsub < "$root/ops/secure-sessions/staging/bootstrap.sql"
sql -c "create table public.users(id uuid primary key)"
fail_with 'STAGING_BOOTSTRAP_REQUIRES_EMPTY_APPLICATION_SCHEMA' "${bootstrap_args[@]}" < "$root/ops/secure-sessions/staging/bootstrap.sql"
sql -c "drop table public.users"
sql -c "insert into supabase_migrations.schema_migrations values('20260101000000','unexpected_existing')"
fail_with 'STAGING_BOOTSTRAP_REQUIRES_EMPTY_MIGRATION_HISTORY' "${bootstrap_args[@]}" < "$root/ops/secure-sessions/staging/bootstrap.sql"
sql -c "delete from supabase_migrations.schema_migrations"
sql "${bootstrap_args[@]}" < "$root/ops/secure-sessions/staging/bootstrap.sql"
[[ "$(sql -Atq < "$root/ops/secure-sessions/staging/verify-bootstrap.sql")" == 'bootstrapped' ]]
sql -c "create schema app_private"
fail_with 'STAGING_BOOTSTRAP_PRIVATE_STATE_CONTRADICTORY' < "$root/ops/secure-sessions/staging/verify-bootstrap.sql"
sql -c "drop schema app_private"
fail -c "set role anon; select public.create_rehearsal_with_details(clock_timestamp(),'PENDING',null,array[]::uuid[],array[]::uuid[])"
fail -c "set role authenticated; select public.update_rehearsal_with_details('00000000-0000-4000-8000-000000000001',clock_timestamp(),array[]::uuid[],array[]::uuid[])"
sql < "$root/supabase/migrations/20260408014035_fix_rehearsal_song_chords_fk.sql"
sql -c "insert into supabase_migrations.schema_migrations values('20260408014035','fix_rehearsal_song_chords_fk')"
[[ "$(sql -Atq < "$root/ops/secure-sessions/staging/verify-bootstrap.sql")" == 'migrations-1' ]]
drift_args=(-v deployment_environment=production -v target_project_ref=fixtureprod01 -v production_project_ref=fixtureprod01)
sql "${drift_args[@]}" < "$root/ops/secure-sessions/migration_drift_gate.sql"
fail_with 'PRODUCTION_DRIFT_GATE_TARGET_REJECTED' -v deployment_environment=staging -v target_project_ref=localstaging01 -v production_project_ref=fixtureprod01 < "$root/ops/secure-sessions/migration_drift_gate.sql"
sql -c "begin; delete from supabase_migrations.schema_migrations; commit"
fail_with 'REMOTE_APPROVED_BASELINE_MISSING' "${drift_args[@]}" < "$root/ops/secure-sessions/migration_drift_gate.sql"
sql -c "begin; insert into supabase_migrations.schema_migrations values('20260408014035','fix_rehearsal_song_chords_fk'); commit"
sql -c "begin; insert into supabase_migrations.schema_migrations values('20260408010000','baseline_application_schema'); commit"
fail_with 'RETROACTIVE_STAGING_BOOTSTRAP_HISTORY_FORBIDDEN' "${drift_args[@]}" < "$root/ops/secure-sessions/migration_drift_gate.sql"
sql -c "begin; delete from supabase_migrations.schema_migrations where version='20260408010000'; commit"
sql -c "begin; insert into supabase_migrations.schema_migrations values('20260408015000','unexpected_migration'); commit"
fail_with 'REMOTE_MIGRATION_INVENTORY_UNEXPECTED: count=2' "${drift_args[@]}" < "$root/ops/secure-sessions/migration_drift_gate.sql"
fail_with 'STAGING_BOOTSTRAP_MIGRATION_STATE_CONTRADICTORY' < "$root/ops/secure-sessions/staging/verify-bootstrap.sql"
sql -c "begin; delete from supabase_migrations.schema_migrations where version='20260408015000'; commit"
[[ "$(sql -Atqc "select string_agg(version || ':' || name, ',' order by version,name) from supabase_migrations.schema_migrations")" == '20260408014035:fix_rehearsal_song_chords_fk' ]]
sql < "$root/supabase/migrations/20260408020000_secure_session_foundation.sql"
sql -c "insert into supabase_migrations.schema_migrations values('20260408020000','secure_session_foundation')"
[[ "$(sql -Atq < "$root/ops/secure-sessions/staging/verify-bootstrap.sql")" == 'migrations-2' ]]
sql < "$root/supabase/migrations/20260721044311_recover_partial_backfill_credentials.sql"
sql -c "insert into supabase_migrations.schema_migrations values('20260721044311','recover_partial_backfill_credentials')"
[[ "$(sql -Atq < "$root/ops/secure-sessions/staging/verify-bootstrap.sql")" == 'migrations-3' ]]
sql < "$root/supabase/migrations/20260721055246_session_pr3_atomic_operations.sql"
sql -c "insert into supabase_migrations.schema_migrations values('20260721055246','session_pr3_atomic_operations')"
[[ "$(sql -Atq < "$root/ops/secure-sessions/staging/verify-bootstrap.sql")" == 'complete' ]]
sql <<'SQL'
insert into public.users(first_name,last_name,role,access_code) select 'Test','User-'||n,case when n=1 then 'LIDER_REPASO' else 'GENERAL' end,'code-'||n from generate_series(1,7)n;
insert into app_private.user_credentials(actor_id) select id from public.users on conflict do nothing;
update app_private.user_credentials c set access_code_lookup_hash=extensions.digest(c.actor_id::text,'sha256'),access_code_hash='$argon2id$v=19$m=65536,t=3,p=1$fixture$fixture-hash-value-32-bytes',code_rotation_required=false;
do $t$ declare a uuid; j1 bytea:=extensions.digest('jti-1','sha256'); j2 bytea:=extensions.digest('jti-2','sha256'); j3 bytea:=extensions.digest('jti-3','sha256'); f uuid; begin
 select id into a from public.users where role='LIDER_REPASO' limit 1;
 if (select status from app_private.begin_login((select access_code_lookup_hash from app_private.user_credentials where actor_id=a),extensions.digest('ip','sha256'),extensions.digest('code','sha256')) limit 1) <> 'candidate' then raise exception 'LOGIN_CANDIDATE_FAILED'; end if;
 if (select status from app_private.finalize_login(a,1,(select access_code_lookup_hash from app_private.user_credentials where actor_id=a),'$argon2id$v=19$m=65536,t=3,p=1$fixture$fixture-hash-value-32-bytes',null,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',j1,clock_timestamp()+interval '1 hour') limit 1) <> 'issued' then raise exception 'ISSUE_FAILED'; end if;
 if not exists(select 1 from app_private.validate_session(j1)) then raise exception 'VALIDATE_FAILED'; end if;
 if (select status from app_private.rotate_session(j1,'00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000013',j2,clock_timestamp()+interval '1 hour') limit 1) <> 'rotated' then raise exception 'ROTATE_FAILED'; end if;
 if (select status from app_private.rotate_session(j1,'00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000098',j3,clock_timestamp()+interval '1 hour') limit 1) <> 'repeated' then raise exception 'IDEMPOTENT_RETRY_FAILED'; end if;
 if (select status from app_private.rotate_session(j1,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000014',j3,clock_timestamp()+interval '1 hour') limit 1) <> 'replay_revoked' then raise exception 'REPLAY_FAILED'; end if;
 if not exists(select 1 from app_private.session_families where revoked_at is not null) then raise exception 'REPLAY_NOT_REVOKED'; end if;
 end $t$;
SQL

# A committed demotion wins the row lock before create authorization resumes.
# The denied operation must leave no user, credential, or idempotency row.
docker exec -e PGOPTIONS='-c statement_timeout=15s' "$name" psql -U supabase_admin -d piba_session_harness -X -v ON_ERROR_STOP=1 -c \
  "begin; select id from public.users where role='LIDER_REPASO' for update; update public.users set role='GENERAL' where role='LIDER_REPASO'; select pg_sleep(2); commit" >/dev/null & demotion_pid=$!
sleep 1
demotion_status="$(sql -Atqc "select status from public.session_create_user_authorized((select actor_id from app_private.app_sessions where id='00000000-0000-4000-8000-000000000001'),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000130','00000000-0000-4000-8000-000000000131','Race','Denied','GENERAL',null,extensions.digest('race-create','sha256'),'\$argon2id\$v=19\$m=65536,t=3,p=1\$fixture\$fixture-hash-value-32-bytes')")"
wait "$demotion_pid"
[[ "$demotion_status" == 'forbidden' ]]
[[ "$(sql -Atqc "select count(*) from public.users where id='00000000-0000-4000-8000-000000000131'")" == '0' ]]
[[ "$(sql -Atqc "select count(*) from app_private.user_credentials where actor_id='00000000-0000-4000-8000-000000000131'")" == '0' ]]
[[ "$(sql -Atqc "select count(*) from app_private.user_creation_operations where operation_id='00000000-0000-4000-8000-000000000130'")" == '0' ]]
sql -c "update public.users set role='LIDER_REPASO' where id=(select actor_id from app_private.app_sessions where id='00000000-0000-4000-8000-000000000001')"

# Two independent connections race the same refresh token. One rotation may win,
# but replay detection must revoke the family so no successor remains valid.
sql <<'SQL'
do $t$ declare a uuid; old_jti bytea:=extensions.digest('race-old','sha256'); begin
 select id into a from public.users order by id limit 1;
 if (select status from app_private.finalize_login(a,1,(select access_code_lookup_hash from app_private.user_credentials where actor_id=a),'$argon2id$v=19$m=65536,t=3,p=1$fixture$fixture-hash-value-32-bytes',null,'00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006',old_jti,clock_timestamp()+interval '1 hour') limit 1) <> 'issued' then raise exception 'RACE_ISSUE_FAILED'; end if;
end $t$;
SQL
race_one="$(mktemp)"; race_two="$(mktemp)"
docker exec -e PGOPTIONS='-c statement_timeout=15s' "$name" psql -U supabase_admin -d piba_session_harness -XAtqc "select status from app_private.rotate_session(extensions.digest('race-old','sha256'),'00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000017',extensions.digest('race-new-1','sha256'),clock_timestamp()+interval '1 hour')" >"$race_one" & first_pid=$!
docker exec -e PGOPTIONS='-c statement_timeout=15s' "$name" psql -U supabase_admin -d piba_session_harness -XAtqc "select status from app_private.rotate_session(extensions.digest('race-old','sha256'),'00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000018',extensions.digest('race-new-2','sha256'),clock_timestamp()+interval '1 hour')" >"$race_two" & second_pid=$!
wait "$first_pid"; wait "$second_pid"
race_statuses="$(sort "$race_one" "$race_two" | tr '\n' ':')"
rm -f "$race_one" "$race_two"
[[ "$race_statuses" == 'replay_revoked:rotated:' ]]
[[ "$(sql -Atqc "select count(*) from app_private.validate_session(extensions.digest('race-new-1','sha256'))")" == '0' ]]
[[ "$(sql -Atqc "select count(*) from app_private.validate_session(extensions.digest('race-new-2','sha256'))")" == '0' ]]
sql < "$root/supabase/tests/secure_sessions.sql"
PIBA_SESSION_DB_CONTAINER="$name" "${deno_cmd[@]}" test \
  --config "$root/supabase/functions/deno.json" \
  --lock "$root/supabase/functions/deno.lock" \
  -A "$root/supabase/functions/refresh-db.integration.test.ts"
fail -c "select * from app_private.begin_login(null,null,null)"
fail -c "select * from app_private.finalize_login(null,null,null,null,null,null,null,null,null)"
fail -c "select * from app_private.rotate_session(null,null,null,null,null,null)"
fail -c "select app_private.revoke_session_family(null,null)"
if sql -v release_id='bad/release' < "$root/ops/secure-sessions/cutover.sql"; then exit 1; fi
hold_foundation_locks
fail -v release_id='blocked-cutover' < "$root/ops/secure-sessions/cutover.sql"
wait "$lock_pid"
[[ "$(sql -Atqc "select migration_state || ':' || fallback_enabled from public.security_settings")" == 'compatibility:true' ]]
sql -v release_id='harness-cutover' < "$root/ops/secure-sessions/cutover.sql"
[[ "$(sql -Atqc "select migration_state || ':' || fallback_enabled from public.security_settings")" == 'hash_only:false' ]]
[[ "$(sql -Atqc "select count(*) from app_private.user_credentials where access_code_lookup_hash is not null and access_code_hash is not null")" == '7' ]]
sql <<'SQL'
insert into app_private.session_families(id,actor_id)
select '00000000-0000-4000-8000-000000000030',id from public.users order by id limit 1;
insert into app_private.app_sessions(id,family_id,actor_id,jti_hash,expires_at)
select '00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000030',id,extensions.digest('rollback-live','sha256'),clock_timestamp()+interval '1 hour'
from public.users order by id limit 1;
SQL
fail -v release_id='harness-rollback' -v expected_release_id='wrong-cutover' < "$root/ops/secure-sessions/rollback.sql"
[[ "$(sql -Atqc "select migration_state || ':' || fallback_enabled from public.security_settings")" == 'hash_only:false' ]]
[[ "$(sql -Atqc "select count(*) from app_private.session_families where id='00000000-0000-4000-8000-000000000030' and revoked_at is null")" == '1' ]]
sql -c "begin; delete from public.security_settings; commit"
fail -v release_id='harness-rollback' -v expected_release_id='harness-cutover' < "$root/ops/secure-sessions/rollback.sql"
[[ "$(sql -Atqc "select count(*) from app_private.session_families where id='00000000-0000-4000-8000-000000000030' and revoked_at is null")" == '1' ]]
sql -c "begin; insert into public.security_settings(id,legacy_code_cutoff_at,migration_state,fallback_enabled,updated_by_release) values(true,'infinity','hash_only',false,'harness-cutover'); commit"
hold_foundation_locks
fail -v release_id='harness-rollback' -v expected_release_id='harness-cutover' < "$root/ops/secure-sessions/rollback.sql"
wait "$lock_pid"
[[ "$(sql -Atqc "select migration_state || ':' || fallback_enabled from public.security_settings")" == 'hash_only:false' ]]
[[ "$(sql -Atqc "select count(*) from app_private.session_families where id='00000000-0000-4000-8000-000000000030' and revoked_at is null")" == '1' ]]
sql -v release_id='harness-rollback' -v expected_release_id='harness-cutover' < "$root/ops/secure-sessions/rollback.sql"
[[ "$(sql -Atqc "select migration_state || ':' || fallback_enabled || ':' || (legacy_code_cutoff_at < 'infinity'::timestamptz) || ':' || (legacy_code_cutoff_at <= clock_timestamp() + interval '72 hours') from public.security_settings")" == 'compatibility:true:true:true' ]]
[[ "$(sql -Atqc "select count(*) from app_private.session_families where revoked_at is null")" == '0' ]]
rollback_snapshot="$(sql -Atqc "select legacy_code_cutoff_at::text || ':' || updated_at::text || ':' || updated_by_release from public.security_settings")"
fail -v release_id='harness-rollback-retry' -v expected_release_id='harness-rollback' < "$root/ops/secure-sessions/rollback.sql"
[[ "$(sql -Atqc "select legacy_code_cutoff_at::text || ':' || updated_at::text || ':' || updated_by_release from public.security_settings")" == "$rollback_snapshot" ]]
sql < "$root/ops/secure-sessions/foundation-removal.sql"
[[ "$(sql -Atqc "select to_regnamespace('app_private') is null")" == 't' ]]
[[ "$(sql -Atqc "select to_regclass('public.security_settings') is null")" == 't' ]]
[[ "$(sql -Atqc "select not relrowsecurity from pg_class where oid='public.users'::regclass")" == 't' ]]
[[ "$(sql -Atqc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('list_safe_users','session_begin_login','session_finalize_login','session_validate','session_rotate','session_revoke','consume_endpoint_limit','session_create_user','session_create_user_authorized','session_refresh_status','session_initialize_credential','session_set_credential','session_backfill_list','session_backfill_read','session_backfill_cas')")" == '0' ]]
printf 'secure session disposable SQL harness: PASS\n'

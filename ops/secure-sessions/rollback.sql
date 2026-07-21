\set ON_ERROR_STOP on
begin;
-- Bound lock acquisition to 5 seconds and the full recovery to 60 seconds.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select set_config('app.approved_release_id', :'release_id', true);
select set_config('app.expected_release_id', :'expected_release_id', true);

do $rollback$
declare
  affected integer;
  approved_release text := current_setting('app.approved_release_id',true);
  expected_release text := current_setting('app.expected_release_id',true);
begin
  lock table public.users, app_private.user_credentials, public.security_settings in share row exclusive mode;
  if approved_release is null
     or approved_release !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'INVALID_RELEASE_ID';
  end if;
  if expected_release is null
     or expected_release !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'INVALID_EXPECTED_RELEASE_ID';
  end if;
  update public.security_settings
     set migration_state='compatibility',fallback_enabled=true,
         legacy_code_cutoff_at=clock_timestamp() + interval '72 hours',updated_at=clock_timestamp(),
         updated_by_release=approved_release
   where id
     and migration_state='hash_only'
     and not fallback_enabled
     and updated_by_release=expected_release;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'ROLLBACK_CAS_FAILED: affected=%',affected; end if;
  update app_private.session_families
     set revoked_at=coalesce(revoked_at,clock_timestamp()),
         revocation_reason=coalesce(revocation_reason,'rollback');
  update app_private.app_sessions
     set revoked_at=coalesce(revoked_at,clock_timestamp()),
         revocation_reason=coalesce(revocation_reason,'rollback');
end
$rollback$;
commit;

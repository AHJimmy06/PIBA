\set ON_ERROR_STOP on
begin;
-- Bound lock acquisition to 5 seconds and the full operation to 60 seconds.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select set_config('app.approved_release_id', :'release_id', true);

do $cutover$
declare
  affected integer;
  approved_release text := current_setting('app.approved_release_id',true);
begin
  lock table public.users, app_private.user_credentials, public.security_settings in share row exclusive mode;
  if approved_release is null
     or approved_release !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' then
    raise exception 'INVALID_RELEASE_ID';
  end if;
  if (select count(*) from public.users) <> 7
     or (select count(*) from public.users u
         join app_private.user_credentials c on c.actor_id = u.id
         where c.access_code_lookup_hash is not null
           and c.access_code_hash like '$argon2id$%') <> 7 then
    raise exception 'BACKFILL_NOT_7_OF_7';
  end if;
  update public.security_settings
     set migration_state='hash_only',fallback_enabled=false,
         legacy_code_cutoff_at=clock_timestamp(),updated_at=clock_timestamp(),
         updated_by_release=approved_release
   where id and migration_state='compatibility' and fallback_enabled;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'CUTOVER_CAS_FAILED: affected=%',affected; end if;
end
$cutover$;
commit;

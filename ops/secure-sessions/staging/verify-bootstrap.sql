-- Persistent deny-by-default contract for the limited staging bootstrap.
create temporary table piba_staging_bootstrap_state(state text not null);

do $verify$
declare
  table_name text;
  row_count bigint;
  recovered_tables constant text[] := array[
    'users', 'songs', 'rehearsals', 'rehearsal_users',
    'rehearsal_songs', 'rehearsal_song_chords', 'background_assets'
  ];
  expected_indexes constant text[] := array[
    'background_assets_pkey', 'background_assets_storage_path_key',
    'idx_rehearsal_songs_song', 'idx_rehearsal_status',
    'idx_rehearsal_users_user', 'rehearsal_song_chords_pkey',
    'rehearsal_song_chords_rehearsal_id_song_id_instrument_key',
    'rehearsal_songs_pkey', 'rehearsal_users_pkey', 'rehearsals_pkey',
    'songs_pkey', 'users_access_code_key', 'users_pkey'
  ];
  expected_migrations constant text[] := array[
    '20260408014035:fix_rehearsal_song_chords_fk',
    '20260408020000:secure_session_foundation',
    '20260721044311:recover_partial_backfill_credentials',
    '20260721055246:session_pr3_atomic_operations'
  ];
  actual_migrations text[] := array[]::text[];
  migration_state text;
begin
  foreach table_name in array recovered_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'STAGING_BOOTSTRAP_TABLE_MISSING: %', table_name;
    end if;
    execute format('select count(*) from public.%I', table_name) into row_count;
    if row_count <> 0 then
      raise exception 'STAGING_BOOTSTRAP_SYNTHETIC_ONLY_VIOLATION: %', table_name;
    end if;
  end loop;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any(recovered_tables)
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then
    raise exception 'STAGING_BOOTSTRAP_RLS_NOT_FORCED';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = any(recovered_tables)
  ) then
    raise exception 'STAGING_BOOTSTRAP_PERMISSIVE_POLICY_FOUND';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where n.nspname = 'public' and c.relname = any(recovered_tables)
      and acl.grantee in (
        0,
        (select oid from pg_roles where rolname = 'anon'),
        (select oid from pg_roles where rolname = 'authenticated')
      )
  ) then
    raise exception 'STAGING_BOOTSTRAP_CLIENT_TABLE_GRANT_FOUND';
  end if;
  if not has_table_privilege('service_role', 'public.users', 'select,insert,update')
     or has_table_privilege('service_role', 'public.users', 'delete')
     or exists (
       select 1 from unnest(recovered_tables[2:7]) as denied(name)
       where has_table_privilege('service_role', format('public.%I', denied.name), 'select,insert,update,delete')
     ) then
    raise exception 'STAGING_BOOTSTRAP_SERVICE_ROLE_GRANTS_DRIFTED';
  end if;

  if (select count(*) from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any(recovered_tables)) <> 20 then
    raise exception 'STAGING_BOOTSTRAP_CONSTRAINT_INVENTORY_DRIFTED';
  end if;
  if (select array_agg(indexname::text order by indexname::text) from pg_indexes
      where schemaname = 'public' and tablename = any(recovered_tables))
      is distinct from (select array_agg(name::text order by name::text) from unnest(expected_indexes) name) then
    raise exception 'STAGING_BOOTSTRAP_INDEX_INVENTORY_DRIFTED';
  end if;
  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.oid = 'public.users'::regclass and not t.tgisinternal
        and t.tgname = 'trigger_generate_user_access_code') <> 1 then
    raise exception 'STAGING_BOOTSTRAP_TRIGGER_DRIFTED';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('generate_user_access_code', 'create_rehearsal_with_details', 'update_rehearsal_with_details')
      and (
        p.prosecdef
        or not ('search_path=pg_catalog, public' = any(p.proconfig))
        or exists (
          select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        )
        or has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
  ) or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
          'generate_user_access_code', 'create_rehearsal_with_details', 'update_rehearsal_with_details'
        )) <> 3 then
    raise exception 'STAGING_BOOTSTRAP_ROUTINE_SECURITY_DRIFTED';
  end if;
  if to_regclass('storage.buckets') is not null
     and exists (select 1 from storage.buckets where id = 'backgrounds') then
    raise exception 'STAGING_BOOTSTRAP_BACKGROUND_BUCKET_MUST_BE_ABSENT';
  end if;

  if to_regclass('supabase_migrations.schema_migrations') is not null then
    select coalesce(array_agg(version || ':' || name order by version), array[]::text[])
      into actual_migrations
      from supabase_migrations.schema_migrations;
  end if;
  if actual_migrations = array[]::text[] then
    migration_state := 'bootstrapped';
  elsif actual_migrations = expected_migrations[1:1] then
    migration_state := 'migrations-1';
  elsif actual_migrations = expected_migrations[1:2] then
    migration_state := 'migrations-2';
  elsif actual_migrations = expected_migrations[1:3] then
    migration_state := 'migrations-3';
  elsif actual_migrations = expected_migrations then
    migration_state := 'complete';
  else
    raise exception 'STAGING_BOOTSTRAP_MIGRATION_STATE_CONTRADICTORY: %', actual_migrations;
  end if;
  if migration_state in ('bootstrapped', 'migrations-1')
     and (to_regnamespace('app_private') is not null
       or to_regclass('public.security_settings') is not null) then
    raise exception 'STAGING_BOOTSTRAP_PRIVATE_STATE_CONTRADICTORY: %', migration_state;
  end if;
  if migration_state in ('migrations-2', 'migrations-3', 'complete')
     and (to_regnamespace('app_private') is null
       or to_regclass('public.security_settings') is null) then
    raise exception 'STAGING_BOOTSTRAP_PRIVATE_STATE_CONTRADICTORY: %', migration_state;
  end if;
  insert into piba_staging_bootstrap_state values (migration_state);
end
$verify$;

select state from piba_staging_bootstrap_state;
drop table piba_staging_bootstrap_state;

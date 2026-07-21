-- Execute only against an isolated database after the foundation migration.
begin;

do $tests$
declare
  expected_private_signatures text[] := array[
    'app_private.begin_login(bytea,bytea,bytea)',
    'app_private.cas_backfill(uuid,bigint,bytea,text)',
    'app_private.consume_endpoint_limit(text,bytea,integer,integer)',
    'app_private.create_user_authorized(uuid,uuid,uuid,uuid,text,text,text,text,bytea,text)',
    'app_private.create_user_with_credential(uuid,text,text,text,text,bytea,text)',
    'app_private.finalize_login(uuid,bigint,bytea,text,text,uuid,uuid,bytea,timestamp with time zone)',
    'app_private.list_backfill_users()',
    'app_private.read_legacy_code(uuid,bigint)',
    'app_private.refresh_operation_status(bytea,uuid)',
    'app_private.refund_login_attempt(uuid,bytea,bytea,timestamp with time zone)',
    'app_private.revoke_session_family(bytea,text)',
    'app_private.rotate_session(bytea,uuid,uuid,uuid,bytea,timestamp with time zone)',
    'app_private.validate_session(bytea)'
  ];
  actual_private_signatures text[];
  returned_columns text[];
  safe_function pg_proc;
begin
  if (select count(*) from public.security_settings) <> 1 then
    raise exception 'security_settings must remain a singleton';
  end if;
  if has_table_privilege('anon', 'public.users', 'select')
     or has_table_privilege('authenticated', 'public.users', 'select') then
    raise exception 'client roles must not directly select public.users';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','app_private')
        and c.relname in ('security_settings','session_families','app_sessions','login_rate_limits','endpoint_rate_limits','user_credentials','credential_cutover_locks','login_attempt_refunds','user_creation_operations')
       and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then
    raise exception 'security tables must have forced RLS';
  end if;

  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
    into actual_private_signatures
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private';
  if actual_private_signatures is distinct from expected_private_signatures then
    raise exception 'private routine identity drift: %', actual_private_signatures;
  end if;
  if exists (
    select 1 from unnest(expected_private_signatures) as expected(signature)
     where to_regprocedure(expected.signature) is null
        or pg_get_function_identity_arguments(to_regprocedure(expected.signature)) is null
  ) then
    raise exception 'missing exact private routine identity';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app_private'
       and (coalesce(p.proacl::text, '') ~ 'anon' or coalesce(p.proacl::text, '') ~ 'authenticated')
  ) then
    raise exception 'client execute grant found on private routine';
  end if;
  if has_function_privilege('anon','public.session_create_user_authorized(uuid,uuid,uuid,uuid,text,text,text,text,bytea,text)','execute')
     or has_function_privilege('authenticated','public.session_create_user_authorized(uuid,uuid,uuid,uuid,text,text,text,text,bytea,text)','execute')
     or not has_function_privilege('service_role','public.session_create_user_authorized(uuid,uuid,uuid,uuid,text,text,text,text,bytea,text)','execute')
     or has_function_privilege('anon','public.session_refresh_status(bytea,uuid)','execute')
     or not has_function_privilege('service_role','public.session_refresh_status(bytea,uuid)','execute') then
    raise exception 'atomic create-user RPC grants drifted';
  end if;

  select p.* into safe_function from pg_proc p
   where p.oid = 'public.list_safe_users(uuid,text)'::regprocedure;
  if not safe_function.prosecdef
     or pg_get_userbyid(safe_function.proowner) in ('anon','authenticated')
     or not exists (select 1 from unnest(safe_function.proconfig) as c where c = 'search_path=pg_catalog, public')
      or has_function_privilege('anon','public.list_safe_users(uuid,text)','execute')
      or has_function_privilege('authenticated','public.list_safe_users(uuid,text)','execute')
     or not has_function_privilege('service_role','public.list_safe_users(uuid,text)','execute')
     or has_function_privilege('anon','app_private.begin_login(bytea,bytea,bytea)','execute') then
    raise exception 'safe RPC owner, definer, search path, or grants drifted';
  end if;
  select array_agg(parameter_name order by ordinal_position) into returned_columns
    from information_schema.parameters
   where specific_schema = 'public' and specific_name like 'list_safe_users%'
     and parameter_mode = 'OUT';
  if returned_columns is distinct from array['id','first_name','last_name','role','default_instrument']
     or pg_get_functiondef('public.list_safe_users(uuid,text)'::regprocedure)
          ~* '(access_code|credential_version|code_rotation)' then
    raise exception 'safe RPC projection drifted';
  end if;
end
$tests$;

do $atomic_create$
declare
  caller_id uuid;
  caller_session uuid := '00000000-0000-4000-8000-000000000110';
  caller_family uuid := '00000000-0000-4000-8000-000000000111';
  operation_id uuid := '00000000-0000-4000-8000-000000000112';
  created_id uuid := '00000000-0000-0000-0000-000000000101';
  failed_id uuid := '00000000-0000-0000-0000-000000000102';
  lookup bytea := extensions.digest('atomic-create','sha256');
  prepared_hash text := '$argon2id$v=19$m=65536,t=3,p=1$fixture$fixture-hash-value-32-bytes';
begin
  select id into strict caller_id from public.users where role = 'LIDER_REPASO' limit 1;
  insert into app_private.session_families(id,actor_id) values(caller_family,caller_id);
  insert into app_private.app_sessions(id,family_id,actor_id,jti_hash,expires_at)
  values(caller_session,caller_family,caller_id,extensions.digest('create-caller','sha256'),clock_timestamp()+interval '1 hour');
  if (select status from public.session_create_user_authorized(caller_id,caller_session,operation_id,created_id,'Atomic','User','GENERAL',null,lookup,prepared_hash)) <> 'created' then
    raise exception 'atomic create did not report created';
  end if;
  if (select status from public.session_create_user_authorized(caller_id,caller_session,operation_id,failed_id,'Atomic','User','GENERAL',null,lookup,prepared_hash)) <> 'repeated' then
    raise exception 'atomic retry did not report repeated';
  end if;
  if (select count(*) from public.users where id=created_id) <> 1
     or (select count(*) from app_private.user_credentials where actor_id=created_id) <> 1 then
    raise exception 'atomic create must be idempotent';
  end if;
  begin
    perform public.session_create_user_authorized(caller_id,caller_session,'00000000-0000-4000-8000-000000000113',failed_id,'Failed','User','GENERAL',null,extensions.digest('failed','sha256'),'invalid');
    raise exception 'invalid prepared hash unexpectedly accepted';
  exception when sqlstate '22023' then null;
  end;
  if exists(select 1 from public.users where id=failed_id)
     or exists(select 1 from app_private.user_credentials where actor_id=failed_id) then
    raise exception 'failed atomic create left a partial row';
  end if;
end
$atomic_create$;

do $refresh_status$
declare
  caller_id uuid;
  family_id uuid := '00000000-0000-4000-8000-000000000120';
  old_session uuid := '00000000-0000-4000-8000-000000000121';
  new_session uuid := '00000000-0000-4000-8000-000000000122';
  operation_id uuid := '00000000-0000-4000-8000-000000000123';
  old_hash bytea := extensions.digest('status-old','sha256');
begin
  select id into strict caller_id from public.users limit 1;
  insert into app_private.session_families(id,actor_id) values(family_id,caller_id);
  insert into app_private.app_sessions(id,family_id,actor_id,jti_hash,expires_at)
  values(old_session,family_id,caller_id,old_hash,clock_timestamp()+interval '1 hour');
  if (select status from public.session_refresh_status(old_hash,operation_id)) <> 'fresh' then
    raise exception 'fresh refresh status failed';
  end if;
  perform app_private.rotate_session(old_hash,operation_id,new_session,
    '00000000-0000-4000-8000-000000000124',extensions.digest('status-new','sha256'),clock_timestamp()+interval '1 hour');
  if (select status from public.session_refresh_status(old_hash,operation_id)) <> 'repeated'
     or (select status from public.session_refresh_status(old_hash,'00000000-0000-4000-8000-000000000125')) <> 'replay' then
    raise exception 'refresh operation classification failed';
  end if;
  if exists(select 1 from app_private.session_families where id=family_id and revoked_at is not null) then
    raise exception 'status-only replay check revoked the family';
  end if;
end
$refresh_status$;

set local role service_role;
select count(*) as service_safe_rows,
       bool_and(not (to_jsonb(u) ?| array['access_code','access_code_hash','access_code_lookup_hash','credential_version','code_rotation_required'])) as service_no_secret_columns
  from public.list_safe_users() as u;
reset role;

set local role anon;
do $anon$ begin
  perform public.list_safe_users();
  raise exception 'anon unexpectedly executed list_safe_users';
exception when insufficient_privilege then null; end $anon$;
reset role;

set local role authenticated;
do $authenticated$ begin
  perform public.list_safe_users();
  raise exception 'authenticated unexpectedly executed list_safe_users';
exception when insufficient_privilege then null; end $authenticated$;
reset role;

rollback;

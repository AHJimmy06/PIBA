begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;

-- Credential material never enters the exposed public.users relation. This is
-- additive: the legacy access_code remains until the separately approved
-- cutover, while all new secret-bearing fields live in the private schema.
create table app_private.user_credentials(
  actor_id uuid primary key references public.users(id) on delete restrict,
  access_code_hash text,
  access_code_lookup_hash bytea,
  credential_version bigint not null default 1,
  code_rotation_required boolean not null default true,
  code_rotated_at timestamptz,
  check(access_code_hash is null or access_code_hash ~ '^\$argon2id\$v=19\$m=[1-9][0-9]*,t=[1-9][0-9]*,p=[1-9][0-9]*\$[^$]+\$[^$]+$'),
  check(access_code_lookup_hash is null or octet_length(access_code_lookup_hash) = 32)
);
create unique index user_credentials_lookup_hash_unique
  on app_private.user_credentials(access_code_lookup_hash)
  where access_code_lookup_hash is not null;
insert into app_private.user_credentials(actor_id)
  select id from public.users
  on conflict (actor_id) do nothing;

create table public.security_settings(
  id boolean primary key default true check(id),
  legacy_code_cutoff_at timestamptz not null default 'infinity',
  migration_state text not null default 'compatibility'
    check(migration_state in('compatibility','hash_only')),
  fallback_enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by_release text not null
    check(updated_by_release ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
);
insert into public.security_settings(id,updated_by_release)
values(true,'secure-access-code-sessions-foundation-20260408020000');
alter table public.security_settings enable row level security;
alter table public.security_settings force row level security;
revoke all on table public.security_settings from public,anon,authenticated;
grant select,update on table public.security_settings to service_role;

create table app_private.session_families(
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  revocation_reason text,
  check ((revoked_at is null) = (revocation_reason is null))
);

create table app_private.app_sessions(
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_private.session_families(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete restrict,
  jti_hash bytea not null unique check(octet_length(jti_hash)=32),
  token_jti uuid,
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text,
  rotated_to_session_id uuid references app_private.app_sessions(id) on delete set null,
  rotation_operation_id uuid,
  check(expires_at > issued_at)
);
create index app_sessions_family_active_index
  on app_private.app_sessions(family_id) where revoked_at is null;
create index app_sessions_expiry_index on app_private.app_sessions(expires_at);

create table app_private.credential_cutover_locks(
  actor_id uuid primary key references public.users(id) on delete restrict,
  locked_at timestamptz not null default clock_timestamp()
);

create table app_private.login_rate_limits(
  dimension text not null check(dimension in('ip','code')),
  bucket_hash bytea not null check(octet_length(bucket_hash)=32),
  window_started_at timestamptz not null,
  attempt_count integer not null check(attempt_count > 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(dimension,bucket_hash,window_started_at)
);

create table app_private.endpoint_rate_limits(
  endpoint text not null,
  bucket_hash bytea not null check(octet_length(bucket_hash)=32),
  window_started_at timestamptz not null,
  request_count integer not null check(request_count > 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(endpoint,bucket_hash,window_started_at)
);

alter table app_private.session_families enable row level security;
alter table app_private.session_families force row level security;
alter table app_private.app_sessions enable row level security;
alter table app_private.app_sessions force row level security;
alter table app_private.login_rate_limits enable row level security;
alter table app_private.login_rate_limits force row level security;
alter table app_private.endpoint_rate_limits enable row level security;
alter table app_private.endpoint_rate_limits force row level security;
alter table app_private.user_credentials enable row level security;
alter table app_private.user_credentials force row level security;
alter table app_private.credential_cutover_locks enable row level security;
alter table app_private.credential_cutover_locks force row level security;

create function app_private.consume_endpoint_limit(
  p_endpoint text,p_bucket_hash bytea,p_window_seconds integer,p_limit integer
) returns boolean
language plpgsql security definer set search_path = pg_catalog, app_private
as $function$
declare
  v_window timestamptz := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / greatest(p_window_seconds, 1))
    * greatest(p_window_seconds, 1)
  );
  v_count integer;
begin
  if octet_length(p_bucket_hash) <> 32 or p_limit < 1 then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT_INPUT';
  end if;
  insert into app_private.endpoint_rate_limits(endpoint,bucket_hash,window_started_at,request_count)
  values(p_endpoint,p_bucket_hash,v_window,1)
  on conflict(endpoint,bucket_hash,window_started_at) do update
    set request_count = app_private.endpoint_rate_limits.request_count + 1,
        updated_at = clock_timestamp()
  returning request_count into v_count;
  return v_count <= p_limit;
end
$function$;

create function app_private.create_user_with_credential(
  p_actor_id uuid,p_first_name text,p_last_name text,p_role text,
  p_default_instrument text,p_lookup_hash bytea,p_access_code_hash text
) returns table(id uuid)
language plpgsql security definer set search_path = pg_catalog, public, app_private
as $function$
declare v_existing public.users;
begin
  if p_actor_id is null or nullif(btrim(p_first_name),'') is null
     or nullif(btrim(p_last_name),'') is null or p_role not in ('GENERAL','LIDER_REPASO')
     or octet_length(p_lookup_hash) <> 32
     or p_access_code_hash !~ '^\$argon2id\$v=19\$m=[1-9][0-9]*,t=[1-9][0-9]*,p=[1-9][0-9]*\$[^$]+\$[^$]+$' then
    raise exception using errcode = '22023', message = 'INVALID_CREATE_USER_INPUT';
  end if;
  insert into public.users(id,first_name,last_name,role,default_instrument,access_code)
  values(p_actor_id,btrim(p_first_name),btrim(p_last_name),p_role,p_default_instrument,p_actor_id::text)
  on conflict on constraint users_pkey do nothing;
  insert into app_private.user_credentials(
    actor_id,access_code_hash,access_code_lookup_hash,code_rotation_required,code_rotated_at
  ) values(p_actor_id,p_access_code_hash,p_lookup_hash,false,clock_timestamp())
  on conflict(actor_id) do nothing;
  select * into v_existing from public.users where public.users.id = p_actor_id for update;
  if v_existing.first_name::text <> btrim(p_first_name)
     or v_existing.last_name::text <> btrim(p_last_name)
     or v_existing.role::text <> p_role
     or v_existing.default_instrument::text is distinct from p_default_instrument
     or not exists (
       select 1 from app_private.user_credentials c where c.actor_id=p_actor_id
         and c.access_code_lookup_hash=p_lookup_hash and c.access_code_hash=p_access_code_hash
     ) then
    raise exception using errcode = '23505', message = 'CREATE_USER_IDEMPOTENCY_CONFLICT';
  end if;
  return query select p_actor_id;
end
$function$;

create function app_private.list_backfill_users()
returns table(actor_id uuid,credential_version bigint,access_code_lookup_hash bytea,access_code_hash text)
language sql stable security definer set search_path = pg_catalog, app_private
as $function$
  select actor_id, credential_version, access_code_lookup_hash, access_code_hash
    from app_private.user_credentials
   order by actor_id
$function$;

create function app_private.read_legacy_code(p_actor_id uuid,p_expected_version bigint)
returns text
language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare
  v_code text;
begin
  if p_actor_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'INVALID_CREDENTIAL_INPUT';
  end if;
  select u.access_code into v_code from public.users u
   join app_private.user_credentials c on c.actor_id = u.id
   where u.id = p_actor_id and c.credential_version = p_expected_version;
  return v_code;
end
$function$;

create function app_private.cas_backfill(
  p_actor_id uuid,p_expected_version bigint,p_lookup_hash bytea,p_access_code_hash text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $function$
begin
  if p_actor_id is null or p_expected_version is null or p_expected_version < 1
     or octet_length(p_lookup_hash) <> 32
     or p_access_code_hash is null
     or p_access_code_hash !~ '^\$argon2id\$v=19\$m=[1-9][0-9]*,t=[1-9][0-9]*,p=[1-9][0-9]*\$[^$]+\$[^$]+$' then
    raise exception using errcode = '22023', message = 'INVALID_CREDENTIAL_MATERIAL';
  end if;
  update app_private.user_credentials
     set access_code_lookup_hash = p_lookup_hash,
         access_code_hash = p_access_code_hash,
         credential_version = credential_version + 1,
         code_rotation_required = false,
         code_rotated_at = clock_timestamp()
    where actor_id = p_actor_id
     and credential_version = p_expected_version
     and access_code_lookup_hash is null;
  return found;
end
$function$;

create function app_private.begin_login(
  p_lookup_hash bytea,p_ip_hash bytea,p_code_hash bytea
) returns table(
  status text,actor_id uuid,credential_version bigint,access_code_hash text,
  legacy_access_code text,legacy_allowed boolean
)
language plpgsql security definer set search_path = pg_catalog, public, app_private
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz := to_timestamp(floor(extract(epoch from v_now) / 900) * 900);
  v_ip_count integer;
  v_code_count integer;
   v_settings public.security_settings;
begin
  if octet_length(p_lookup_hash) <> 32 or octet_length(p_ip_hash) <> 32 or octet_length(p_code_hash) <> 32 then
    raise exception using errcode = '22023', message = 'INVALID_LOGIN_INPUT';
  end if;
  insert into app_private.login_rate_limits values('ip',p_ip_hash,v_window,1,v_now)
  on conflict(dimension,bucket_hash,window_started_at) do update
    set attempt_count = app_private.login_rate_limits.attempt_count + 1, updated_at = v_now
  returning attempt_count into v_ip_count;
  insert into app_private.login_rate_limits values('code',p_code_hash,v_window,1,v_now)
  on conflict(dimension,bucket_hash,window_started_at) do update
    set attempt_count = app_private.login_rate_limits.attempt_count + 1, updated_at = v_now
  returning attempt_count into v_code_count;
  if v_ip_count > 10 or v_code_count > 5 then
    return query select 'throttled'::text,null::uuid,null::bigint,null::text,null::text,false;
    return;
  end if;
  select * into v_settings from public.security_settings where id;
  return query
     select 'candidate'::text,u.id,c.credential_version,c.access_code_hash,
           case when v_settings.fallback_enabled
                       and v_settings.migration_state = 'compatibility'
                       and v_now < v_settings.legacy_code_cutoff_at then u.access_code end,
           v_settings.fallback_enabled and v_settings.migration_state = 'compatibility'
             and v_now < v_settings.legacy_code_cutoff_at
       from public.users u join app_private.user_credentials c on c.actor_id = u.id
      where c.access_code_lookup_hash = p_lookup_hash;
  if not found then
    return query select 'missing'::text,null::uuid,null::bigint,null::text,null::text,false;
  end if;
end
$function$;

create function app_private.finalize_login(
  p_actor_id uuid,p_expected_version bigint,p_lookup_hash bytea,
  p_verified_existing_hash text,p_upgrade_hash text,p_session_id uuid,
  p_family_id uuid,p_jti_hash bytea,p_expires_at timestamptz
) returns table(status text,session_id uuid,family_id uuid,actor_id uuid,role text,first_name text,last_name text,default_instrument text,expires_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, app_private, extensions
as $function$
declare
   v_user public.users;
begin
   if p_actor_id is null or p_expected_version is null or p_expected_version < 1
      or p_session_id is null or p_family_id is null
      or octet_length(p_lookup_hash) <> 32 or octet_length(p_jti_hash) <> 32
      or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp() + interval '8 hours 1 minute'
      or (p_verified_existing_hash is not null and p_verified_existing_hash !~ '^\$argon2id\$v=19\$m=[1-9][0-9]*,t=[1-9][0-9]*,p=[1-9][0-9]*\$[^$]+\$[^$]+$')
      or (p_upgrade_hash is not null and p_upgrade_hash !~ '^\$argon2id\$v=19\$m=[1-9][0-9]*,t=[1-9][0-9]*,p=[1-9][0-9]*\$[^$]+\$[^$]+$') then
    raise exception using errcode = '22023', message = 'INVALID_SESSION_INPUT';
  end if;
   select u.* into v_user from public.users u join app_private.user_credentials c on c.actor_id=u.id
    where u.id = p_actor_id and c.credential_version = p_expected_version
      and c.access_code_lookup_hash = p_lookup_hash
      and c.access_code_hash is not distinct from p_verified_existing_hash
   for update;
  if not found then
    return query select 'stale'::text,null::uuid,null::uuid,null::uuid,null::text,null::text,null::text,null::text,null::timestamptz;
    return;
  end if;
  if p_upgrade_hash is not null then
     update app_private.user_credentials set access_code_hash = p_upgrade_hash,
      credential_version = credential_version + 1, code_rotation_required = true
     where actor_id = v_user.id;
  end if;
  insert into app_private.session_families(id,actor_id) values(p_family_id,v_user.id);
  insert into app_private.app_sessions(id,family_id,actor_id,jti_hash,expires_at)
  values(p_session_id,p_family_id,v_user.id,p_jti_hash,p_expires_at);
  return query select 'issued'::text,p_session_id,p_family_id,v_user.id,v_user.role,v_user.first_name,v_user.last_name,v_user.default_instrument,p_expires_at;
end
$function$;

create function app_private.validate_session(p_jti_hash bytea)
returns table(session_id uuid,family_id uuid,actor_id uuid,role text,expires_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, app_private
as $function$
begin
   if p_jti_hash is null or octet_length(p_jti_hash) <> 32 then
    raise exception using errcode = '22023', message = 'AUTH_INVALID';
  end if;
  return query select s.id,s.family_id,s.actor_id,u.role,s.expires_at
    from app_private.app_sessions s
    join app_private.session_families f on f.id = s.family_id
    join public.users u on u.id = s.actor_id
   where s.jti_hash = p_jti_hash and s.revoked_at is null and f.revoked_at is null
     and s.expires_at > clock_timestamp();
end
$function$;

create function app_private.rotate_session(
  p_old_jti_hash bytea,p_operation_id uuid,p_new_session_id uuid,p_new_jti uuid,p_new_jti_hash bytea,p_new_expires_at timestamptz
)
returns table(status text,session_id uuid,family_id uuid,actor_id uuid,role text,jti uuid,issued_at timestamptz,expires_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, app_private, extensions
as $function$
declare
  v_old app_private.app_sessions;
  v_successor app_private.app_sessions;
  v_role text;
begin
   if p_old_jti_hash is null or p_operation_id is null or p_new_session_id is null or p_new_jti is null or p_new_jti_hash is null
      or octet_length(p_old_jti_hash) <> 32 or octet_length(p_new_jti_hash) <> 32
      or p_new_expires_at <= clock_timestamp() or p_new_expires_at > clock_timestamp() + interval '8 hours 1 minute' then
    raise exception using errcode = '22023', message = 'AUTH_INVALID';
  end if;
  select * into v_old from app_private.app_sessions where jti_hash = p_old_jti_hash for update;
  if not found or v_old.expires_at <= clock_timestamp() then
    return query select 'invalid'::text,null::uuid,null::uuid,null::uuid,null::text,null::uuid,null::timestamptz,null::timestamptz; return;
  end if;
  if v_old.rotated_to_session_id is not null or (v_old.revoked_at is not null and v_old.revocation_reason = 'rotated') then
    if v_old.rotation_operation_id = p_operation_id and not exists(select 1 from app_private.session_families where id = v_old.family_id and revoked_at is not null) then
      select * into v_successor from app_private.app_sessions where id = v_old.rotated_to_session_id;
      select u.role into v_role from public.users u where u.id = v_old.actor_id;
      return query select 'repeated'::text,v_successor.id,v_old.family_id,v_old.actor_id,v_role,v_successor.token_jti,v_successor.issued_at,v_successor.expires_at;
      return;
    end if;
    update app_private.session_families set revoked_at = coalesce(revoked_at,clock_timestamp()),
      revocation_reason = coalesce(revocation_reason,'refresh_replay') where id = v_old.family_id;
     update app_private.app_sessions s set revoked_at = coalesce(s.revoked_at,clock_timestamp()),
       revocation_reason = coalesce(s.revocation_reason,'refresh_replay') where s.family_id = v_old.family_id;
    return query select 'replay_revoked'::text,null::uuid,null::uuid,null::uuid,null::text,null::uuid,null::timestamptz,null::timestamptz; return;
  end if;
  if v_old.revoked_at is not null then
    return query select 'invalid'::text,null::uuid,null::uuid,null::uuid,null::text,null::uuid,null::timestamptz,null::timestamptz; return;
  end if;
  insert into app_private.app_sessions(id,family_id,actor_id,jti_hash,token_jti,expires_at)
  values(p_new_session_id,v_old.family_id,v_old.actor_id,p_new_jti_hash,p_new_jti,p_new_expires_at);
  update app_private.app_sessions set revoked_at = clock_timestamp(), revocation_reason = 'rotated',
    rotated_to_session_id = p_new_session_id, rotation_operation_id = p_operation_id where id = v_old.id;
   select u.role into v_role from public.users u where u.id = v_old.actor_id;
  select * into v_successor from app_private.app_sessions where id = p_new_session_id;
  return query select 'rotated'::text,p_new_session_id,v_old.family_id,v_old.actor_id,v_role,p_new_jti,v_successor.issued_at,p_new_expires_at;
end
$function$;

create function app_private.revoke_session_family(p_jti_hash bytea,p_reason text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, app_private
as $function$
declare v_family uuid;
begin
   if p_jti_hash is null or octet_length(p_jti_hash) <> 32 or p_reason is null or length(p_reason) = 0 then
     raise exception using errcode = '22023', message = 'AUTH_INVALID';
   end if;
   select family_id into v_family from app_private.app_sessions where jti_hash = p_jti_hash for update;
  if not found then return false; end if;
  update app_private.session_families set revoked_at = coalesce(revoked_at,clock_timestamp()),
    revocation_reason = coalesce(revocation_reason,left(p_reason,64)) where id = v_family;
  update app_private.app_sessions set revoked_at = coalesce(revoked_at,clock_timestamp()),
    revocation_reason = coalesce(revocation_reason,left(p_reason,64)) where family_id = v_family;
  return true;
end
$function$;

-- These narrow RPC facades are executable only by service_role. Edge handlers
-- use them because app_private is intentionally not exposed through PostgREST.
create function public.session_begin_login(p_lookup_hash bytea,p_ip_hash bytea,p_code_hash bytea)
returns table(status text,actor_id uuid,credential_version bigint,access_code_hash text,legacy_access_code text,legacy_allowed boolean)
language sql security definer set search_path = pg_catalog, app_private
as $function$ select * from app_private.begin_login(p_lookup_hash,p_ip_hash,p_code_hash) $function$;
create function public.session_finalize_login(p_actor_id uuid,p_expected_version bigint,p_lookup_hash bytea,p_verified_existing_hash text,p_upgrade_hash text,p_session_id uuid,p_family_id uuid,p_jti_hash bytea,p_expires_at timestamptz)
returns table(status text,session_id uuid,family_id uuid,actor_id uuid,role text,first_name text,last_name text,default_instrument text,expires_at timestamptz)
language sql security definer set search_path = pg_catalog, app_private
as $function$ select * from app_private.finalize_login(p_actor_id,p_expected_version,p_lookup_hash,p_verified_existing_hash,p_upgrade_hash,p_session_id,p_family_id,p_jti_hash,p_expires_at) $function$;
create function public.session_validate(p_jti_hash bytea)
returns table(session_id uuid,family_id uuid,actor_id uuid,role text,expires_at timestamptz)
language sql security definer set search_path = pg_catalog, app_private
as $function$ select * from app_private.validate_session(p_jti_hash) $function$;
create function public.session_rotate(p_old_jti_hash bytea,p_operation_id uuid,p_new_session_id uuid,p_new_jti uuid,p_new_jti_hash bytea,p_new_expires_at timestamptz)
returns table(status text,session_id uuid,family_id uuid,actor_id uuid,role text,jti uuid,issued_at timestamptz,expires_at timestamptz)
language sql security definer set search_path = pg_catalog, app_private
as $function$ select * from app_private.rotate_session(p_old_jti_hash,p_operation_id,p_new_session_id,p_new_jti,p_new_jti_hash,p_new_expires_at) $function$;
create function public.session_revoke(p_jti_hash bytea,p_reason text)
returns boolean language sql security definer set search_path = pg_catalog, app_private
as $function$ select app_private.revoke_session_family(p_jti_hash,p_reason) $function$;
create function public.consume_endpoint_limit(p_endpoint text,p_bucket_hash bytea,p_window_seconds integer,p_limit integer)
returns boolean language sql security definer set search_path = pg_catalog, app_private
as $function$ select app_private.consume_endpoint_limit(p_endpoint,p_bucket_hash,p_window_seconds,p_limit) $function$;
create function public.session_create_user(p_actor_id uuid,p_first_name text,p_last_name text,p_role text,p_default_instrument text,p_lookup_hash bytea,p_access_code_hash text)
returns table(id uuid) language sql security definer set search_path = pg_catalog, app_private
as $function$ select * from app_private.create_user_with_credential(p_actor_id,p_first_name,p_last_name,p_role,p_default_instrument,p_lookup_hash,p_access_code_hash) $function$;
create function public.session_initialize_credential(p_actor_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, app_private
as $function$
begin
  if p_actor_id is null then raise exception using errcode = '22023', message = 'INVALID_CREDENTIAL_INPUT'; end if;
  insert into app_private.user_credentials(actor_id) values(p_actor_id) on conflict (actor_id) do nothing;
  return true;
end
$function$;
create function public.session_set_credential(p_actor_id uuid,p_lookup_hash bytea,p_access_code_hash text)
returns boolean language sql security definer set search_path = pg_catalog, app_private
as $function$ select app_private.cas_backfill(p_actor_id,1,p_lookup_hash,p_access_code_hash) $function$;
create function public.session_backfill_list()
returns table(actor_id uuid,credential_version bigint,access_code_lookup_hash bytea,access_code_hash text)
language sql security definer set search_path = pg_catalog, app_private
as $function$ select * from app_private.list_backfill_users() $function$;
create function public.session_backfill_read(p_actor_id uuid,p_expected_version bigint)
returns text language sql security definer set search_path = pg_catalog, app_private
as $function$ select app_private.read_legacy_code(p_actor_id,p_expected_version) $function$;
create function public.session_backfill_cas(p_actor_id uuid,p_expected_version bigint,p_lookup_hash bytea,p_access_code_hash text)
returns boolean language sql security definer set search_path = pg_catalog, app_private
as $function$ select app_private.cas_backfill(p_actor_id,p_expected_version,p_lookup_hash,p_access_code_hash) $function$;
revoke all on function public.session_begin_login(bytea,bytea,bytea), public.session_finalize_login(uuid,bigint,bytea,text,text,uuid,uuid,bytea,timestamptz), public.session_validate(bytea), public.session_rotate(bytea,uuid,uuid,uuid,bytea,timestamptz), public.session_revoke(bytea,text), public.consume_endpoint_limit(text,bytea,integer,integer), public.session_create_user(uuid,text,text,text,text,bytea,text), public.session_initialize_credential(uuid), public.session_set_credential(uuid,bytea,text), public.session_backfill_list(), public.session_backfill_read(uuid,bigint), public.session_backfill_cas(uuid,bigint,bytea,text) from public,anon,authenticated;
grant execute on function public.session_begin_login(bytea,bytea,bytea), public.session_finalize_login(uuid,bigint,bytea,text,text,uuid,uuid,bytea,timestamptz), public.session_validate(bytea), public.session_rotate(bytea,uuid,uuid,uuid,bytea,timestamptz), public.session_revoke(bytea,text), public.consume_endpoint_limit(text,bytea,integer,integer), public.session_create_user(uuid,text,text,text,text,bytea,text), public.session_initialize_credential(uuid), public.session_set_credential(uuid,bytea,text), public.session_backfill_list(), public.session_backfill_read(uuid,bigint), public.session_backfill_cas(uuid,bigint,bytea,text) to service_role;

revoke all on all tables in schema app_private from public,anon,authenticated;
grant select,insert,update,delete on all tables in schema app_private to service_role;
revoke all on all functions in schema app_private from public,anon,authenticated;
grant execute on all functions in schema app_private to service_role;
alter default privileges in schema app_private revoke execute on functions from public;

alter table public.users enable row level security;
alter table public.users force row level security;
revoke all on table public.users from public,anon,authenticated;

create function public.list_safe_users(p_id uuid default null,p_role text default null)
returns table(id uuid,first_name text,last_name text,role text,default_instrument text)
language sql stable security definer set search_path = pg_catalog, public
as $function$
  select u.id,u.first_name::text,u.last_name::text,u.role::text,u.default_instrument::text
    from public.users as u
   where (p_id is null or u.id = p_id) and (p_role is null or u.role::text = p_role)
   order by u.id
$function$;
revoke all on function public.list_safe_users(uuid,text) from public,anon,authenticated;
grant execute on function public.list_safe_users(uuid,text) to service_role;

commit;

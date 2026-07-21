begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table app_private.user_creation_operations(
  operation_id uuid primary key,
  caller_actor_id uuid not null,
  caller_session_id uuid not null,
  created_actor_id uuid not null unique,
  first_name text not null,
  last_name text not null,
  role text not null check(role in ('GENERAL','LIDER_REPASO')),
  default_instrument text,
  access_code_lookup_hash bytea not null check(octet_length(access_code_lookup_hash) = 32),
  created_at timestamptz not null default clock_timestamp()
);
alter table app_private.user_creation_operations enable row level security;
alter table app_private.user_creation_operations force row level security;
revoke all on table app_private.user_creation_operations from public,anon,authenticated;
grant select,insert,update on table app_private.user_creation_operations to service_role;

create function app_private.create_user_authorized(
  p_caller_actor_id uuid,p_caller_session_id uuid,p_operation_id uuid,p_actor_id uuid,
  p_first_name text,p_last_name text,p_role text,p_default_instrument text,
  p_lookup_hash bytea,p_access_code_hash text
) returns table(
  status text,id uuid,first_name text,last_name text,role text,default_instrument text
)
language plpgsql security definer set search_path = pg_catalog, public, app_private
as $function$
declare
  v_operation app_private.user_creation_operations;
  v_user public.users;
  v_session app_private.app_sessions;
  v_family app_private.session_families;
  v_inserted boolean;
begin
  if p_caller_actor_id is null or p_caller_session_id is null or p_operation_id is null
     or p_actor_id is null or nullif(btrim(p_first_name),'') is null
     or nullif(btrim(p_last_name),'') is null or p_role not in ('GENERAL','LIDER_REPASO')
     or p_lookup_hash is null or octet_length(p_lookup_hash) <> 32
     or p_access_code_hash is null
     or p_access_code_hash !~ '^\$argon2id\$v=19\$m=[1-9][0-9]*,t=[1-9][0-9]*,p=[1-9][0-9]*\$[^$]+\$[^$]+$' then
    raise exception using errcode = '22023', message = 'INVALID_CREATE_USER_INPUT';
  end if;

  select s.* into v_session from app_private.app_sessions s
   where s.id = p_caller_session_id and s.actor_id = p_caller_actor_id
     and s.revoked_at is null and s.expires_at > clock_timestamp()
   for update;
  if not found then
    return query select 'forbidden'::text,null::uuid,null::text,null::text,null::text,null::text;
    return;
  end if;
  select f.* into v_family from app_private.session_families f
   where f.id = v_session.family_id and f.revoked_at is null
   for update;
  if not found then
    return query select 'forbidden'::text,null::uuid,null::text,null::text,null::text,null::text;
    return;
  end if;
  select u.* into v_user from public.users u where u.id = p_caller_actor_id for update;
  if not found or v_user.role::text <> 'LIDER_REPASO' then
    return query select 'forbidden'::text,null::uuid,null::text,null::text,null::text,null::text;
    return;
  end if;

  insert into app_private.user_creation_operations(
    operation_id,caller_actor_id,caller_session_id,created_actor_id,
    first_name,last_name,role,default_instrument,access_code_lookup_hash
  ) values(
    p_operation_id,p_caller_actor_id,p_caller_session_id,p_actor_id,
    btrim(p_first_name),btrim(p_last_name),p_role,nullif(btrim(p_default_instrument),''),p_lookup_hash
  ) on conflict(operation_id) do nothing;
  v_inserted := found;

  select * into v_operation from app_private.user_creation_operations
   where operation_id = p_operation_id for update;
  if v_operation.caller_actor_id <> p_caller_actor_id
     or v_operation.caller_session_id <> p_caller_session_id
     or v_operation.first_name <> btrim(p_first_name)
     or v_operation.last_name <> btrim(p_last_name)
     or v_operation.role <> p_role
     or v_operation.default_instrument is distinct from nullif(btrim(p_default_instrument),'')
     or v_operation.access_code_lookup_hash <> p_lookup_hash then
    return query select 'conflict'::text,null::uuid,null::text,null::text,null::text,null::text;
    return;
  end if;

  if v_inserted then
    insert into public.users(id,first_name,last_name,role,default_instrument,access_code)
    values(
      v_operation.created_actor_id,v_operation.first_name,v_operation.last_name,
      v_operation.role,v_operation.default_instrument,v_operation.created_actor_id::text
    );
    insert into app_private.user_credentials(
      actor_id,access_code_hash,access_code_lookup_hash,code_rotation_required,code_rotated_at
    ) values(
      v_operation.created_actor_id,p_access_code_hash,p_lookup_hash,false,clock_timestamp()
    );
  end if;

  select u.* into strict v_user from public.users u where u.id = v_operation.created_actor_id;
  return query select case when v_inserted then 'created' else 'repeated' end,
    v_user.id,v_user.first_name::text,v_user.last_name::text,
    v_user.role::text,v_user.default_instrument::text;
end
$function$;

create function app_private.refresh_operation_status(
  p_old_jti_hash bytea,p_operation_id uuid
) returns table(
  status text,session_id uuid,family_id uuid,actor_id uuid,role text,
  jti uuid,issued_at timestamptz,expires_at timestamptz
)
language plpgsql security definer set search_path = pg_catalog, public, app_private
as $function$
declare
  v_old app_private.app_sessions;
  v_successor app_private.app_sessions;
  v_role text;
begin
  if p_old_jti_hash is null or octet_length(p_old_jti_hash) <> 32 or p_operation_id is null then
    raise exception using errcode = '22023', message = 'AUTH_INVALID';
  end if;
  select * into v_old from app_private.app_sessions where jti_hash = p_old_jti_hash for update;
  if not found or v_old.expires_at <= clock_timestamp()
     or exists(select 1 from app_private.session_families f where f.id=v_old.family_id and f.revoked_at is not null) then
    return query select 'invalid'::text,null::uuid,null::uuid,null::uuid,null::text,null::uuid,null::timestamptz,null::timestamptz;
    return;
  end if;
  if v_old.rotated_to_session_id is not null
     or (v_old.revoked_at is not null and v_old.revocation_reason = 'rotated') then
    if v_old.rotation_operation_id = p_operation_id then
      select * into v_successor from app_private.app_sessions where id = v_old.rotated_to_session_id;
      select u.role::text into v_role from public.users u where u.id = v_old.actor_id;
      return query select 'repeated'::text,v_successor.id,v_old.family_id,v_old.actor_id,
        v_role,v_successor.token_jti,v_successor.issued_at,v_successor.expires_at;
    else
      return query select 'replay'::text,null::uuid,null::uuid,null::uuid,null::text,null::uuid,null::timestamptz,null::timestamptz;
    end if;
    return;
  end if;
  if v_old.revoked_at is not null then
    return query select 'invalid'::text,null::uuid,null::uuid,null::uuid,null::text,null::uuid,null::timestamptz,null::timestamptz;
    return;
  end if;
  return query select 'fresh'::text,null::uuid,null::uuid,null::uuid,null::text,null::uuid,null::timestamptz,null::timestamptz;
end
$function$;

create function public.session_create_user_authorized(
  p_caller_actor_id uuid,p_caller_session_id uuid,p_operation_id uuid,p_actor_id uuid,
  p_first_name text,p_last_name text,p_role text,p_default_instrument text,
  p_lookup_hash bytea,p_access_code_hash text
) returns table(
  status text,id uuid,first_name text,last_name text,role text,default_instrument text
)
language sql security definer set search_path = pg_catalog, app_private
as $function$
  select * from app_private.create_user_authorized(
    p_caller_actor_id,p_caller_session_id,p_operation_id,p_actor_id,p_first_name,
    p_last_name,p_role,p_default_instrument,p_lookup_hash,p_access_code_hash
  )
$function$;

create function public.session_refresh_status(p_old_jti_hash bytea,p_operation_id uuid)
returns table(
  status text,session_id uuid,family_id uuid,actor_id uuid,role text,
  jti uuid,issued_at timestamptz,expires_at timestamptz
)
language sql security definer set search_path = pg_catalog, app_private
as $function$ select * from app_private.refresh_operation_status(p_old_jti_hash,p_operation_id) $function$;

revoke all on function app_private.create_user_authorized(uuid,uuid,uuid,uuid,text,text,text,text,bytea,text),
  app_private.refresh_operation_status(bytea,uuid),
  public.session_create_user_authorized(uuid,uuid,uuid,uuid,text,text,text,text,bytea,text),
  public.session_refresh_status(bytea,uuid)
  from public,anon,authenticated;
grant execute on function app_private.create_user_authorized(uuid,uuid,uuid,uuid,text,text,text,text,bytea,text),
  app_private.refresh_operation_status(bytea,uuid),
  public.session_create_user_authorized(uuid,uuid,uuid,uuid,text,text,text,text,bytea,text),
  public.session_refresh_status(bytea,uuid)
  to service_role;

commit;

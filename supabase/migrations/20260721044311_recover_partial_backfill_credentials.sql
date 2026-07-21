create or replace function app_private.cas_backfill(
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
     and (
       access_code_lookup_hash is null
       or (
         access_code_lookup_hash = p_lookup_hash
         and access_code_hash is null
       )
     );
  return found;
end
$function$;

create table app_private.login_attempt_refunds(
  request_id uuid primary key,
  ip_hash bytea not null check(octet_length(ip_hash) = 32),
  code_hash bytea not null check(octet_length(code_hash) = 32),
  window_started_at timestamptz not null,
  refunded_at timestamptz not null default clock_timestamp()
);
alter table app_private.login_attempt_refunds enable row level security;
alter table app_private.login_attempt_refunds force row level security;
revoke all on table app_private.login_attempt_refunds from public, anon, authenticated;

drop function if exists public.session_begin_login(bytea,bytea,bytea);
drop function if exists app_private.begin_login(bytea,bytea,bytea);

create function app_private.begin_login(
  p_lookup_hash bytea,p_ip_hash bytea,p_code_hash bytea
) returns table(
  status text,actor_id uuid,credential_version bigint,access_code_hash text,
  legacy_access_code text,legacy_allowed boolean,attempt_window timestamptz
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
    return query select 'throttled'::text,null::uuid,null::bigint,null::text,null::text,false,v_window;
    return;
  end if;
  select * into v_settings from public.security_settings where id;
  return query
     select 'candidate'::text,u.id,c.credential_version,c.access_code_hash,
           case when v_settings.fallback_enabled
                       and v_settings.migration_state = 'compatibility'
                       and v_now < v_settings.legacy_code_cutoff_at then u.access_code end,
           v_settings.fallback_enabled and v_settings.migration_state = 'compatibility'
             and v_now < v_settings.legacy_code_cutoff_at,
           v_window
       from public.users u join app_private.user_credentials c on c.actor_id = u.id
      where c.access_code_lookup_hash = p_lookup_hash;
  if not found then
    return query select 'missing'::text,null::uuid,null::bigint,null::text,null::text,false,v_window;
  end if;
end
$function$;

create function app_private.refund_login_attempt(
  p_request_id uuid,p_ip_hash bytea,p_code_hash bytea,p_window_started_at timestamptz
) returns boolean
language plpgsql security definer set search_path = pg_catalog, app_private
as $function$
declare
  v_inserted boolean;
  v_ip_refunded boolean := false;
  v_code_refunded boolean := false;
begin
  if p_request_id is null or octet_length(p_ip_hash) <> 32
     or octet_length(p_code_hash) <> 32 or p_window_started_at is null then
    raise exception using errcode = '22023', message = 'INVALID_LOGIN_REFUND_INPUT';
  end if;
  insert into app_private.login_attempt_refunds(
    request_id,ip_hash,code_hash,window_started_at
  ) values(p_request_id,p_ip_hash,p_code_hash,p_window_started_at)
  on conflict(request_id) do nothing;
  v_inserted := found;
  if not v_inserted then return false; end if;

  update app_private.login_rate_limits set attempt_count = attempt_count - 1,
    updated_at = clock_timestamp()
  where dimension = 'ip' and bucket_hash = p_ip_hash
    and window_started_at = p_window_started_at and attempt_count > 1;
  v_ip_refunded := found;
  if not v_ip_refunded then
    delete from app_private.login_rate_limits
    where dimension = 'ip' and bucket_hash = p_ip_hash
      and window_started_at = p_window_started_at and attempt_count = 1;
    v_ip_refunded := found;
  end if;

  update app_private.login_rate_limits set attempt_count = attempt_count - 1,
    updated_at = clock_timestamp()
  where dimension = 'code' and bucket_hash = p_code_hash
    and window_started_at = p_window_started_at and attempt_count > 1;
  v_code_refunded := found;
  if not v_code_refunded then
    delete from app_private.login_rate_limits
    where dimension = 'code' and bucket_hash = p_code_hash
      and window_started_at = p_window_started_at and attempt_count = 1;
    v_code_refunded := found;
  end if;

  if not v_ip_refunded or not v_code_refunded then
    raise exception using errcode = 'P0001', message = 'LOGIN_REFUND_ACCOUNTING_MISMATCH';
  end if;
  return true;
end
$function$;

create function public.session_begin_login(p_lookup_hash bytea,p_ip_hash bytea,p_code_hash bytea)
returns table(status text,actor_id uuid,credential_version bigint,access_code_hash text,legacy_access_code text,legacy_allowed boolean,attempt_window timestamptz)
language sql security definer set search_path = pg_catalog, app_private
as $function$ select * from app_private.begin_login(p_lookup_hash,p_ip_hash,p_code_hash) $function$;

create function public.session_refund_login_attempt(
  p_request_id uuid,p_ip_hash bytea,p_code_hash bytea,p_window_started_at timestamptz
) returns boolean language sql security definer set search_path = pg_catalog, app_private
as $function$ select app_private.refund_login_attempt(p_request_id,p_ip_hash,p_code_hash,p_window_started_at) $function$;

revoke all on function public.session_begin_login(bytea,bytea,bytea),
  public.session_refund_login_attempt(uuid,bytea,bytea,timestamptz)
  from public,anon,authenticated;
grant execute on function public.session_begin_login(bytea,bytea,bytea),
  public.session_refund_login_attempt(uuid,bytea,bytea,timestamptz)
  to service_role;
revoke all on function app_private.begin_login(bytea,bytea,bytea),
  app_private.refund_login_attempt(uuid,bytea,bytea,timestamptz)
  from public,anon,authenticated;
grant execute on function app_private.begin_login(bytea,bytea,bytea),
  app_private.refund_login_attempt(uuid,bytea,bytea,timestamptz)
  to service_role;

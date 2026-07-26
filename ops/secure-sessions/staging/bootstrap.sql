-- Non-production input for a fresh, isolated, session-infrastructure staging
-- database. Apply with scripts/bootstrap-secure-session-staging.sh only.
begin;

create temporary table piba_staging_bootstrap_target (
  environment text not null,
  target_project_ref text not null
) on commit drop;

insert into piba_staging_bootstrap_target values (
  :'bootstrap_environment',
  :'target_project_ref'
);

do $guard$
declare
  target piba_staging_bootstrap_target%rowtype;
  application_tables constant text[] := array[
    'users', 'songs', 'rehearsals', 'rehearsal_users',
    'rehearsal_songs', 'rehearsal_song_chords', 'background_assets'
  ];
  migration_count bigint;
begin
  select * into strict target from piba_staging_bootstrap_target;
  if target.environment <> 'staging'
     or target.target_project_ref <> 'ejxfoxbfndplinraqrvw'
     or target.target_project_ref = 'kyrgdkghgyazmphvpsub' then
    raise exception 'STAGING_BOOTSTRAP_TARGET_REJECTED';
  end if;
  if exists (
    select 1
    from unnest(application_tables) as expected(name)
    where to_regclass(format('public.%I', expected.name)) is not null
  ) or to_regnamespace('app_private') is not null then
    raise exception 'STAGING_BOOTSTRAP_REQUIRES_EMPTY_APPLICATION_SCHEMA';
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select count(*) from supabase_migrations.schema_migrations'
      into migration_count;
    if migration_count <> 0 then
      raise exception 'STAGING_BOOTSTRAP_REQUIRES_EMPTY_MIGRATION_HISTORY';
    end if;
  end if;
end
$guard$;

create extension if not exists "uuid-ossp" with schema extensions;

create table public.users (
  id uuid primary key default extensions.uuid_generate_v4(),
  first_name text not null,
  last_name text not null,
  access_code text unique,
  role text not null check (role = any (array['LIDER_REPASO'::text, 'GENERAL'::text])),
  default_instrument text,
  created_at timestamptz default now()
);

create table public.songs (
  id uuid primary key default extensions.uuid_generate_v4(),
  title text not null,
  author text not null default 'Desconocido'::text,
  lyrics text not null,
  base_chords text not null,
  created_at timestamptz default now()
);

create table public.background_assets (
  id uuid primary key default extensions.uuid_generate_v4(),
  name text not null,
  storage_path text not null unique,
  width integer,
  height integer,
  category text default 'general'::text,
  created_at timestamptz default now(),
  created_by uuid references public.users(id)
);

create table public.rehearsals (
  id uuid primary key default extensions.uuid_generate_v4(),
  date timestamptz not null,
  status text not null default 'PENDING'::text
    check (status = any (array[
      'PENDING'::text,
      'IN_PROGRESS'::text,
      'PAUSED'::text,
      'READY'::text,
      'COMPLETED'::text
    ])),
  leader_id uuid references public.users(id) on delete cascade,
  created_at timestamptz default now(),
  background_id uuid references public.background_assets(id) on delete set null
);

create table public.rehearsal_users (
  rehearsal_id uuid not null references public.rehearsals(id),
  user_id uuid not null references public.users(id),
  primary key (rehearsal_id, user_id)
);

create table public.rehearsal_songs (
  rehearsal_id uuid not null references public.rehearsals(id),
  song_id uuid not null references public.songs(id),
  primary key (rehearsal_id, song_id)
);

create table public.rehearsal_song_chords (
  id uuid primary key default extensions.uuid_generate_v4(),
  rehearsal_id uuid not null,
  song_id uuid not null,
  instrument text not null,
  custom_chords text not null,
  created_at timestamptz default now(),
  constraint rehearsal_song_chords_rehearsal_id_song_id_instrument_key
    unique (rehearsal_id, song_id, instrument),
  constraint fk_rehearsal_song_relation
    foreign key (rehearsal_id, song_id)
    references public.rehearsal_songs(rehearsal_id, song_id)
);

create index idx_rehearsal_status on public.rehearsals using btree (status);
create index idx_rehearsal_users_user on public.rehearsal_users using btree (user_id);
create index idx_rehearsal_songs_song on public.rehearsal_songs using btree (song_id);

create function public.generate_user_access_code()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  rand_num integer;
  f_name text;
  l_name text;
  should_generate boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.access_code is null then should_generate := true; end if;
  elsif tg_op = 'UPDATE' then
    if new.access_code is null
       or new.first_name is distinct from old.first_name
       or new.last_name is distinct from old.last_name then
      should_generate := true;
    end if;
  end if;

  if should_generate then
    rand_num := floor(random() * 900 + 100)::integer;
    f_name := lower(substring(coalesce(new.first_name, 'xxx') from 1 for 3));
    l_name := lower(substring(coalesce(new.last_name, 'xxx') from 1 for 3));
    new.access_code := rand_num::text || f_name || l_name;
  end if;
  return new;
end;
$function$;

create trigger trigger_generate_user_access_code
  before insert or update of first_name, last_name on public.users
  for each row execute function public.generate_user_access_code();

create function public.create_rehearsal_with_details(
  p_date timestamptz,
  p_status text,
  p_leader_id uuid,
  p_user_ids uuid[],
  p_song_ids uuid[]
)
returns uuid
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_rehearsal_id uuid;
begin
  insert into public.rehearsals (date, status, leader_id)
  values (p_date, p_status, p_leader_id)
  returning id into v_rehearsal_id;

  if p_user_ids is not null and array_length(p_user_ids, 1) > 0 then
    insert into public.rehearsal_users (rehearsal_id, user_id)
    select v_rehearsal_id, unnest(p_user_ids);
  end if;

  if p_song_ids is not null and array_length(p_song_ids, 1) > 0 then
    insert into public.rehearsal_songs (rehearsal_id, song_id)
    select v_rehearsal_id, unnest(p_song_ids);
  end if;
  return v_rehearsal_id;
end;
$function$;

create function public.update_rehearsal_with_details(
  p_rehearsal_id uuid,
  p_date timestamptz,
  p_user_ids uuid[],
  p_song_ids uuid[]
)
returns void
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  update public.rehearsals set date = p_date where id = p_rehearsal_id;
  delete from public.rehearsal_users where rehearsal_id = p_rehearsal_id;
  if p_user_ids is not null and array_length(p_user_ids, 1) > 0 then
    insert into public.rehearsal_users (rehearsal_id, user_id)
    select p_rehearsal_id, unnest(p_user_ids);
  end if;

  delete from public.rehearsal_songs
  where rehearsal_id = p_rehearsal_id
    and song_id not in (select unnest(p_song_ids));
  if p_song_ids is not null and array_length(p_song_ids, 1) > 0 then
    insert into public.rehearsal_songs (rehearsal_id, song_id)
    select p_rehearsal_id, song_id from unnest(p_song_ids) as song_id
    on conflict (rehearsal_id, song_id) do nothing;
  end if;
end;
$function$;

alter table public.users enable row level security;
alter table public.users force row level security;
alter table public.songs enable row level security;
alter table public.songs force row level security;
alter table public.rehearsals enable row level security;
alter table public.rehearsals force row level security;
alter table public.rehearsal_users enable row level security;
alter table public.rehearsal_users force row level security;
alter table public.rehearsal_songs enable row level security;
alter table public.rehearsal_songs force row level security;
alter table public.rehearsal_song_chords enable row level security;
alter table public.rehearsal_song_chords force row level security;
alter table public.background_assets enable row level security;
alter table public.background_assets force row level security;

revoke all on table public.users, public.songs, public.rehearsals,
  public.rehearsal_users, public.rehearsal_songs,
  public.rehearsal_song_chords, public.background_assets
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.users to service_role;

revoke all on function public.generate_user_access_code(),
  public.create_rehearsal_with_details(timestamptz,text,uuid,uuid[],uuid[]),
  public.update_rehearsal_with_details(uuid,timestamptz,uuid[],uuid[])
  from public, anon, authenticated, service_role;

commit;

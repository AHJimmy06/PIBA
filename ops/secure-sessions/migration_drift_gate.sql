-- Read-only remote gate. Invoke with: psql -X -q -v ON_ERROR_STOP=1 -tA -f this-file
begin read only;

do $drift$
declare
  actual_count integer;
begin
  select count(*) into actual_count from supabase_migrations.schema_migrations;
  if not exists (
    select 1 from supabase_migrations.schema_migrations
     where version = '20260408014035' and name = 'fix_rehearsal_song_chords_fk'
  ) then
    raise exception 'REMOTE_APPROVED_BASELINE_MISSING';
  end if;
  if actual_count <> 1 then
    raise exception 'REMOTE_MIGRATION_INVENTORY_UNEXPECTED: count=%', actual_count;
  end if;
  if exists (
    select 1 from supabase_migrations.schema_migrations
     where version <> '20260408014035'
        or name <> 'fix_rehearsal_song_chords_fk'
  ) then
    raise exception 'REMOTE_MIGRATION_INVENTORY_UNEXPECTED';
  end if;
end
$drift$;

select json_build_object(
  'status', 'pass',
  'migrations', (
    select json_agg(json_build_object('version',version,'name',name) order by version,name)
      from supabase_migrations.schema_migrations
  )
)::text;

rollback;

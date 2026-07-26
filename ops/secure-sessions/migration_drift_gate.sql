-- Read-only remote gate. Invoke with: psql -X -q -v ON_ERROR_STOP=1 -tA -f this-file
begin read only;

select set_config('piba.deployment_environment', :'deployment_environment', true);
select set_config('piba.target_project_ref', :'target_project_ref', true);
select set_config('piba.production_project_ref', :'production_project_ref', true);

do $drift$
declare
  actual_count integer;
begin
  if current_setting('piba.deployment_environment') <> 'production'
     or current_setting('piba.target_project_ref')
        <> current_setting('piba.production_project_ref') then
    raise exception 'PRODUCTION_DRIFT_GATE_TARGET_REJECTED';
  end if;
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260408010000'
       or name = 'baseline_application_schema'
  ) then
    raise exception 'RETROACTIVE_STAGING_BOOTSTRAP_HISTORY_FORBIDDEN';
  end if;
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

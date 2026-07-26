#!/usr/bin/env bash
set -euo pipefail

approved_ref='ejxfoxbfndplinraqrvw'
production_ref='kyrgdkghgyazmphvpsub'
bootstrap='ops/secure-sessions/staging/bootstrap.sql'
verification='ops/secure-sessions/staging/verify-bootstrap.sql'
verifier='scripts/verify-secure-session-foundation.mjs'

: "${PIBA_DEPLOY_ENV:?PIBA_DEPLOY_ENV is required}"
: "${PIBA_STAGING_PROJECT_REF:?PIBA_STAGING_PROJECT_REF is required}"
: "${PIBA_STAGING_DATABASE_URL:?PIBA_STAGING_DATABASE_URL is required}"
: "${PIBA_RELEASE_MANIFEST:?PIBA_RELEASE_MANIFEST is required}"
: "${PIBA_GIT_COMMIT:?PIBA_GIT_COMMIT is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"

if [[ "$PIBA_DEPLOY_ENV" != 'staging' ]]; then
  printf 'staging bootstrap rejected: PIBA_DEPLOY_ENV must equal staging\n' >&2
  exit 2
fi
if [[ "$PIBA_STAGING_PROJECT_REF" != "$approved_ref" ]] || [[ "$PIBA_STAGING_PROJECT_REF" == "$production_ref" ]]; then
  printf 'staging bootstrap rejected: project ref is not the approved staging target\n' >&2
  exit 2
fi

node "$verifier" --validate-staging-bootstrap-authorization "$PIBA_RELEASE_MANIFEST" \
  --git-commit "$PIBA_GIT_COMMIT" \
  --repository "$GITHUB_REPOSITORY"

ssl_active="$(psql "$PIBA_STAGING_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 \
  -c "select coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false)::text")"
if [[ "$ssl_active" != 'true' && "$ssl_active" != 't' ]]; then
  printf 'staging bootstrap rejected: database connection is not using SSL\n' >&2
  exit 2
fi
if [[ "${PIBA_STAGING_BOOTSTRAP_DRY_RUN:-0}" == '1' ]]; then
  printf 'limited staging provider and database target guard: PASS\n'
  exit 0
fi

schema_snapshot="$(psql "$PIBA_STAGING_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 -c \
  "select count(*)::text || '|' || (to_regnamespace('app_private') is not null)::text || '|' || (to_regclass('public.security_settings') is not null)::text || '|' || (select count(*) from supabase_migrations.schema_migrations)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname in ('users','songs','rehearsals','rehearsal_users','rehearsal_songs','rehearsal_song_chords','background_assets')")"

case "$schema_snapshot" in
  '0|false|false|0'|'0|f|f|0')
    state='fresh'
    ;;
  '7|'*)
    state="$(psql "$PIBA_STAGING_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 -f "$verification")"
    ;;
  *)
    printf 'staging bootstrap rejected: contradictory or partial database state\n' >&2
    exit 3
    ;;
esac

if [[ "$state" == 'fresh' ]]; then
  psql "$PIBA_STAGING_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
    -v bootstrap_environment="$PIBA_DEPLOY_ENV" \
    -v target_project_ref="$approved_ref" \
    -f "$bootstrap"
  state="$(psql "$PIBA_STAGING_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 -f "$verification")"
fi

case "$state" in
  bootstrapped|migrations-1|migrations-2|migrations-3)
    if ! supabase db push --db-url "$PIBA_STAGING_DATABASE_URL" --yes; then
      printf 'staging migration step failed; rerun to resume from verified migration history\n' >&2
      exit 4
    fi
    ;;
  complete)
    ;;
  *)
    printf 'staging bootstrap rejected: unrecognized recovery state\n' >&2
    exit 3
    ;;
esac

final_state="$(psql "$PIBA_STAGING_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 -f "$verification")"
if [[ "$final_state" != 'complete' ]]; then
  printf 'staging bootstrap final verification did not reach complete state\n' >&2
  exit 5
fi
printf 'limited staging bootstrap: complete\n'

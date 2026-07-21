-- Isolated-rehearsal teardown only. This is not a production rollback and must
-- never be applied to rewrite migration history.
\set ON_ERROR_STOP on
begin;
-- Remove PR3 objects before their PR1 foundation dependencies.
drop function public.session_create_user_authorized(uuid,uuid,uuid,uuid,text,text,text,text,bytea,text);
drop function public.session_refresh_status(bytea,uuid);
drop function app_private.create_user_authorized(uuid,uuid,uuid,uuid,text,text,text,text,bytea,text);
drop function app_private.refresh_operation_status(bytea,uuid);
drop table app_private.user_creation_operations;

revoke all on function public.list_safe_users(uuid,text) from anon,authenticated,service_role;
drop function public.list_safe_users(uuid,text);
drop function public.session_begin_login(bytea,bytea,bytea);
drop function public.session_finalize_login(uuid,bigint,bytea,text,text,uuid,uuid,bytea,timestamptz);
drop function public.session_validate(bytea);
drop function public.session_rotate(bytea,uuid,uuid,uuid,bytea,timestamptz);
drop function public.session_revoke(bytea,text);
drop function public.consume_endpoint_limit(text,bytea,integer,integer);
drop function public.session_create_user(uuid,text,text,text,text,bytea,text);
drop function public.session_refund_login_attempt(uuid,bytea,bytea,timestamptz);
drop function public.session_initialize_credential(uuid);
drop function public.session_set_credential(uuid,bytea,text);
drop function public.session_backfill_list();
drop function public.session_backfill_read(uuid,bigint);
drop function public.session_backfill_cas(uuid,bigint,bytea,text);
drop function app_private.consume_endpoint_limit(text,bytea,integer,integer);
drop function app_private.create_user_with_credential(uuid,text,text,text,text,bytea,text);
drop function app_private.refund_login_attempt(uuid,bytea,bytea,timestamptz);
drop function app_private.cas_backfill(uuid,bigint,bytea,text);
drop function app_private.read_legacy_code(uuid,bigint);
drop function app_private.list_backfill_users();
drop function app_private.revoke_session_family(bytea,text);
drop function app_private.rotate_session(bytea,uuid,uuid,uuid,bytea,timestamptz);
drop function app_private.validate_session(bytea);
drop function app_private.finalize_login(uuid,bigint,bytea,text,text,uuid,uuid,bytea,timestamptz);
drop function app_private.begin_login(bytea,bytea,bytea);
drop table app_private.endpoint_rate_limits;
drop table app_private.login_rate_limits;
drop table app_private.login_attempt_refunds;
drop table app_private.app_sessions;
drop table app_private.session_families;
drop table app_private.credential_cutover_locks;
drop table app_private.user_credentials;
drop table public.security_settings;
alter table public.users disable row level security;
drop schema app_private;
commit;

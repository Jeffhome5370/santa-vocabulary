-- Actual approved addresses are maintained privately, never in this repository.
begin;
create schema if not exists santa_private;
revoke all on schema santa_private from public, anon, authenticated;
grant usage on schema santa_private to supabase_auth_admin;

create table santa_private.signup_allowlist (
  email text primary key check (
    email = lower(btrim(email)) and length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table santa_private.signup_allowlist enable row level security;
revoke all on santa_private.signup_allowlist from public, anon, authenticated;
grant select on santa_private.signup_allowlist to supabase_auth_admin;
create policy auth_reads_signup_allowlist on santa_private.signup_allowlist
  for select to supabase_auth_admin using (true);

-- Preserve current verified members without publishing their addresses.
insert into santa_private.signup_allowlist(email)
  select distinct lower(btrim(email)) from auth.users
  where email_confirmed_at is not null and email is not null
  on conflict (email) do nothing;

create function santa_private.check_signup_allowlist(event jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  requested_email text := lower(btrim(coalesce(event->'user'->>'email', '')));
begin
  if exists (
    select 1 from santa_private.signup_allowlist
    where email = requested_email and enabled
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', '此 Email 尚未獲准註冊。請聯絡網站管理者。'
  ));
end;
$$;
revoke all on function santa_private.check_signup_allowlist(jsonb) from public, anon, authenticated;
grant execute on function santa_private.check_signup_allowlist(jsonb) to supabase_auth_admin;
commit;

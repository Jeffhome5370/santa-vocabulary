-- Only an authenticated caller can consume their own AI allowance.
-- The counter has no client write access; the private definer is required to
-- increment it without giving clients permission to reset their allowance.
begin;
create schema if not exists santa_ai_private;
revoke all on schema santa_ai_private from public, anon, authenticated;
grant usage on schema santa_ai_private to authenticated;

create table santa_ai_private.usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  usage_day date not null,
  day_count integer not null default 0 check (day_count between 0 and 60),
  minute_start timestamptz not null,
  minute_count integer not null default 0 check (minute_count between 0 and 6)
);
alter table santa_ai_private.usage enable row level security;
revoke all on santa_ai_private.usage from public, anon, authenticated;

create function santa_ai_private.consume_allowance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Taipei')::date;
  v_minute timestamptz := date_trunc('minute', now());
  v_row santa_ai_private.usage%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  insert into santa_ai_private.usage(user_id, usage_day, minute_start)
    values (v_user_id, v_day, v_minute) on conflict(user_id) do nothing;
  select * into strict v_row from santa_ai_private.usage where user_id = v_user_id for update;
  if v_row.usage_day <> v_day then v_row.day_count := 0; end if;
  if v_row.minute_start <> v_minute then v_row.minute_count := 0; end if;
  if v_row.day_count >= 60 or v_row.minute_count >= 6 then
    return jsonb_build_object('allowed', false);
  end if;
  update santa_ai_private.usage set usage_day = v_day, day_count = v_row.day_count + 1,
    minute_start = v_minute, minute_count = v_row.minute_count + 1 where user_id = v_user_id;
  return jsonb_build_object('allowed', true);
end;
$$;
revoke all on function santa_ai_private.consume_allowance() from public, anon, authenticated;
grant execute on function santa_ai_private.consume_allowance() to authenticated;

create function public.consume_santa_ai_allowance() returns jsonb
language sql security invoker set search_path = '' as $$
  select santa_ai_private.consume_allowance();
$$;
revoke all on function public.consume_santa_ai_allowance() from public, anon;
grant execute on function public.consume_santa_ai_allowance() to authenticated;
commit;

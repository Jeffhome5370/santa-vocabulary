-- Apply to the intended Supabase project. No secrets or personal data here.
begin;

create table if not exists public.santa_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{"version":2,"progress":{},"history":[]}'::jsonb,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint santa_progress_state_shape check (
    jsonb_typeof(state) = 'object' and state ?& array['version', 'progress', 'history'] and state->>'version' = '2'
    and jsonb_typeof(state->'progress') = 'object'
    and jsonb_typeof(state->'history') = 'array'
    and jsonb_array_length(state->'history') <= 500
    and octet_length(state::text) <= 2000000
  )
);

alter table public.santa_progress enable row level security;
revoke all on public.santa_progress from anon;
revoke all on public.santa_progress from authenticated;
grant select, insert, update on public.santa_progress to authenticated;

drop policy if exists santa_progress_read_own on public.santa_progress;
create policy santa_progress_read_own on public.santa_progress for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists santa_progress_insert_own on public.santa_progress;
create policy santa_progress_insert_own on public.santa_progress for insert to authenticated
with check ((select auth.uid()) = user_id);
drop policy if exists santa_progress_update_own on public.santa_progress;
create policy santa_progress_update_own on public.santa_progress for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.sync_santa_progress(
  p_expected_user_id uuid, p_base_revision integer, p_state jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.santa_progress%rowtype;
begin
  if v_user_id is null or v_user_id <> p_expected_user_id then
    raise exception 'Authentication changed; sign in again.' using errcode = '42501';
  end if;
  if p_base_revision is null or p_base_revision < 0 then
    raise exception 'Invalid revision.' using errcode = '22023';
  end if;
  if p_state is null or p_state->>'version' is distinct from '2'
    or jsonb_typeof(p_state->'progress') is distinct from 'object'
    or jsonb_typeof(p_state->'history') is distinct from 'array'
    or octet_length(p_state::text) > 2000000 then
    raise exception 'Invalid progress payload.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_state->'history') > 500 then
    raise exception 'Too many recent review events.' using errcode = '22023';
  end if;
  insert into public.santa_progress(user_id) values (v_user_id)
    on conflict(user_id) do nothing;
  select * into strict v_row from public.santa_progress where user_id = v_user_id for update;
  if v_row.revision <> p_base_revision then
    return jsonb_build_object('applied', false, 'revision', v_row.revision, 'state', v_row.state, 'updated_at', v_row.updated_at);
  end if;
  update public.santa_progress set state = p_state, revision = revision + 1, updated_at = now()
    where user_id = v_user_id returning * into v_row;
  return jsonb_build_object('applied', true, 'revision', v_row.revision, 'state', v_row.state, 'updated_at', v_row.updated_at);
end;
$$;

revoke all on function public.sync_santa_progress(uuid, integer, jsonb) from public, anon;
grant execute on function public.sync_santa_progress(uuid, integer, jsonb) to authenticated;
commit;

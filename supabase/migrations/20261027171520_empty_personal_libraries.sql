-- New account libraries start empty; preserve existing library modes.
begin;
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
  if p_state ? 'customWords' then
    if jsonb_typeof(p_state->'customWords') is distinct from 'array' then
      raise exception 'Invalid custom vocabulary.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_state->'customWords') > 500 then
      raise exception 'Too many custom words.' using errcode = '22023';
    end if;
  end if;
  if p_state ? 'includeBaseWords' and jsonb_typeof(p_state->'includeBaseWords') is distinct from 'boolean' then
    raise exception 'Invalid library mode.' using errcode = '22023';
  end if;
  insert into public.santa_progress(user_id, state) values (v_user_id, '{"version":2,"progress":{},"history":[],"customWords":[],"includeBaseWords":false}'::jsonb)
    on conflict(user_id) do nothing;
  select * into strict v_row from public.santa_progress where user_id = v_user_id for update;
  if v_row.revision <> p_base_revision then
    return jsonb_build_object('applied', false, 'revision', v_row.revision, 'state', v_row.state, 'updated_at', v_row.updated_at);
  end if;
  -- Existing rows without this flag keep their original library. New rows start empty.
  if coalesce(p_state->'includeBaseWords','true'::jsonb) is distinct from coalesce(v_row.state->'includeBaseWords','true'::jsonb) then
    raise exception 'Library mode changed; reload the page and synchronize again.' using errcode = '22023';
  end if;
  -- Older browser tabs must reload before they can overwrite a custom library.
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_row.state->'customWords', '[]'::jsonb)) saved_word
    where not exists (
      select 1 from jsonb_array_elements(coalesce(p_state->'customWords', '[]'::jsonb)) incoming_word
      where incoming_word->'id' = saved_word->'id'
    )
  ) then
    raise exception 'Custom vocabulary is missing; reload the page and synchronize again.' using errcode = '22023';
  end if;
  update public.santa_progress set state = p_state, revision = revision + 1, updated_at = now()
    where user_id = v_user_id returning * into v_row;
  return jsonb_build_object('applied', true, 'revision', v_row.revision, 'state', v_row.state, 'updated_at', v_row.updated_at);
end;
$$;

revoke all on function public.sync_santa_progress(uuid, integer, jsonb) from public, anon;
grant execute on function public.sync_santa_progress(uuid, integer, jsonb) to authenticated;
commit;

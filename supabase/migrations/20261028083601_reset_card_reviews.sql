-- Preserve explicit review resets against stale tabs and older clients.
begin;
CREATE OR REPLACE FUNCTION public.sync_santa_progress(p_expected_user_id uuid, p_base_revision integer, p_state jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_row public.santa_progress%rowtype;
  v_change jsonb; v_saved jsonb; v_incoming jsonb; v_id bigint;
  v_key text; v_limit integer;
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

  if p_state ? 'reviewReset' then
    if jsonb_typeof(p_state->'reviewReset') is distinct from 'object'
      or not ((p_state->'reviewReset') ?& array['at','id'])
      or jsonb_typeof(p_state->'reviewReset'->'at') is distinct from 'string'
      or (p_state->'reviewReset'->>'at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      or jsonb_typeof(p_state->'reviewReset'->'id') is distinct from 'string'
      or (p_state->'reviewReset'->>'id') !~ '^[a-zA-Z0-9_-]{1,100}$' then
      raise exception 'Invalid review reset.' using errcode = '22023';
    end if;
    perform (p_state->'reviewReset'->>'at')::timestamptz;
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
  if p_state ? 'wordChanges' then
    if jsonb_typeof(p_state->'wordChanges') is distinct from 'array' then
      raise exception 'Invalid word changes.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_state->'wordChanges') > 586
      or (select count(distinct item->>'id') from jsonb_array_elements(p_state->'wordChanges') item) <> jsonb_array_length(p_state->'wordChanges') then
      raise exception 'Invalid word changes.' using errcode = '22023';
    end if;
    for v_change in select value from jsonb_array_elements(p_state->'wordChanges') loop
      if jsonb_typeof(v_change) is distinct from 'object'
        or not (v_change ?& array['id','fields','updatedAt','changeId','deletedAt','restoredAt'])
        or jsonb_typeof(v_change->'id') is distinct from 'number'
        or (v_change->>'id') !~ '^[0-9]+$'
        or jsonb_typeof(v_change->'fields') is distinct from 'object'
        or jsonb_typeof(v_change->'changeId') is distinct from 'string'
        or (v_change->>'changeId') !~ '^[a-zA-Z0-9_-]{1,100}$' then
        raise exception 'Invalid word change entry.' using errcode = '22023';
      end if;
      v_id := (v_change->>'id')::bigint;
      if v_id < 1 or v_id > 9007199254740991 or not (
        v_id between 1 and 86 or exists (
          select 1 from jsonb_array_elements(coalesce(p_state->'customWords','[]'::jsonb)) word where word->'id' = v_change->'id'
        )
      ) then raise exception 'Unknown word change ID.' using errcode = '22023'; end if;
      for v_key, v_limit in select * from (values ('word',100),('meaning',500),('pos',40),('example',1000),('translation',1000),('note',500)) fields(key,lim) loop
        if jsonb_typeof(v_change->'fields'->v_key) is distinct from 'string'
          or char_length(v_change->'fields'->>v_key) > v_limit then
          raise exception 'Invalid word change fields.' using errcode = '22023';
        end if;
      end loop;
      if btrim(v_change->'fields'->>'word') = '' or btrim(v_change->'fields'->>'meaning') = '' then
        raise exception 'Missing word or meaning.' using errcode = '22023';
      end if;
      foreach v_key in array array['updatedAt','deletedAt','restoredAt'] loop
        if v_key = 'updatedAt' or v_change->v_key <> 'null'::jsonb then
          if jsonb_typeof(v_change->v_key) is distinct from 'string'
            or (v_change->>v_key) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
            raise exception 'Invalid word change date.' using errcode = '22023';
          end if;
          perform (v_change->>v_key)::timestamptz;
        end if;
      end loop;
    end loop;
  end if;
  insert into public.santa_progress(user_id, state) values (v_user_id, '{"version":2,"progress":{},"history":[],"customWords":[],"includeBaseWords":false}'::jsonb)
    on conflict(user_id) do nothing;
  select * into strict v_row from public.santa_progress where user_id = v_user_id for update;
  if v_row.revision <> p_base_revision then
    return jsonb_build_object('applied', false, 'revision', v_row.revision, 'state', v_row.state, 'updated_at', v_row.updated_at);
  end if;

  if v_row.state ? 'reviewReset' and (
    not (p_state ? 'reviewReset')
    or (p_state->'reviewReset'->>'at')::timestamptz < (v_row.state->'reviewReset'->>'at')::timestamptz
    or ((p_state->'reviewReset'->>'at')::timestamptz = (v_row.state->'reviewReset'->>'at')::timestamptz
        and (p_state->'reviewReset'->>'id') < (v_row.state->'reviewReset'->>'id'))
  ) then
    raise exception 'Review reset is missing or stale; use the current preview and synchronize again.' using errcode = '22023';
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
  -- Content clocks and deletion/restoration clocks are independent. A later
  -- offline edit cannot implicitly restore a word deleted on another device.
  for v_saved in select value from jsonb_array_elements(coalesce(v_row.state->'wordChanges','[]'::jsonb)) loop
    v_incoming := null;
    select value into v_incoming from jsonb_array_elements(coalesce(p_state->'wordChanges','[]'::jsonb)) item where item->'id' = v_saved->'id';
    if v_incoming is null
      or (v_incoming->>'updatedAt')::timestamptz < (v_saved->>'updatedAt')::timestamptz
      or ((v_incoming->>'updatedAt')::timestamptz = (v_saved->>'updatedAt')::timestamptz and (v_incoming->>'changeId') < (v_saved->>'changeId'))
      or ((v_incoming->>'updatedAt')::timestamptz = (v_saved->>'updatedAt')::timestamptz and v_incoming->>'changeId' = v_saved->>'changeId' and v_incoming->'fields' is distinct from v_saved->'fields')
      or coalesce((v_incoming->>'deletedAt')::timestamptz,'epoch'::timestamptz) < coalesce((v_saved->>'deletedAt')::timestamptz,'epoch'::timestamptz)
      or coalesce((v_incoming->>'restoredAt')::timestamptz,'epoch'::timestamptz) < coalesce((v_saved->>'restoredAt')::timestamptz,'epoch'::timestamptz) then
      raise exception 'Word changes are missing or stale; reload and synchronize again.' using errcode = '22023';
    end if;
  end loop;
  update public.santa_progress set state = p_state, revision = revision + 1, updated_at = now()
    where user_id = v_user_id returning * into v_row;
  return jsonb_build_object('applied', true, 'revision', v_row.revision, 'state', v_row.state, 'updated_at', v_row.updated_at);
end;
$function$;
revoke all on function public.sync_santa_progress(uuid, integer, jsonb) from public, anon;
grant execute on function public.sync_santa_progress(uuid, integer, jsonb) to authenticated;
commit;

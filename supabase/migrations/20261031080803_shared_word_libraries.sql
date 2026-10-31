begin;

create function public.santa_valid_library_content(payload jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare item jsonb; fields jsonb; k text; lim integer; ids bigint[] := '{}'; v_id bigint;
begin
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text) > 1800000
    or not (payload ?& array['includeBaseWords','customWords','wordChanges'])
    or exists(select 1 from jsonb_object_keys(payload) key where key not in ('includeBaseWords','customWords','wordChanges'))
    or jsonb_typeof(payload->'includeBaseWords') is distinct from 'boolean'
    or jsonb_typeof(payload->'customWords') is distinct from 'array'
    or jsonb_typeof(payload->'wordChanges') is distinct from 'array' then return false; end if;
  if jsonb_array_length(payload->'customWords') > 500 or jsonb_array_length(payload->'wordChanges') > 586 then return false; end if;
  for item in select value from jsonb_array_elements(payload->'customWords') loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'id') is distinct from 'number'
      or (item->>'id') !~ '^[0-9]{7,16}$' then return false; end if;
    v_id := (item->>'id')::bigint;
    if v_id < 1000000 or v_id > 9007199254740991 or v_id = any(ids) then return false; end if;
    ids := array_append(ids,v_id);
    if exists(select 1 from jsonb_object_keys(item) key where key not in ('id','word','meaning','pos','example','translation','note')) then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(payload->'wordChanges') loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'id') is distinct from 'number'
      or (item->>'id') !~ '^[0-9]{1,16}$' then return false; end if;
    v_id := (item->>'id')::bigint;
    if not (v_id between 1 and 86 or v_id = any(ids))
      or not (item ?& array['fields','updatedAt','changeId','deletedAt','restoredAt'])
      or jsonb_typeof(item->'fields') is distinct from 'object'
      or jsonb_typeof(item->'updatedAt') is distinct from 'string'
      or (item->>'updatedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      or jsonb_typeof(item->'changeId') is distinct from 'string'
      or (item->>'changeId') !~ '^[a-zA-Z0-9_-]{1,100}$' then return false; end if;
    perform (item->>'updatedAt')::timestamptz;
    foreach k in array array['deletedAt','restoredAt'] loop
      if item->k <> 'null'::jsonb then
        if jsonb_typeof(item->k) is distinct from 'string' or (item->>k) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' then return false; end if;
        perform (item->>k)::timestamptz;
      end if;
    end loop;
    if exists(select 1 from jsonb_object_keys(item) key where key not in ('id','fields','updatedAt','changeId','deletedAt','restoredAt')) then return false; end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(payload->'wordChanges')) <> jsonb_array_length(payload->'wordChanges') then return false; end if;
  for fields in select value from jsonb_array_elements(payload->'customWords')
    union all select value->'fields' from jsonb_array_elements(payload->'wordChanges') loop
    foreach k in array array['word','meaning','pos','example','translation','note'] loop
      lim := case k when 'word' then 100 when 'meaning' then 500 when 'pos' then 40 when 'example' then 1000 when 'translation' then 1000 else 500 end;
      if jsonb_typeof(fields->k) is distinct from 'string' or length(fields->>k) > lim then return false; end if;
    end loop;
    if length(trim(fields->>'word')) = 0 or (fields->>'word') !~ '[a-zA-Z]' or length(trim(fields->>'meaning')) = 0 then return false; end if;
    if exists(select 1 from jsonb_object_keys(fields) key where key not in ('id','word','meaning','pos','example','translation','note')) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.santa_valid_library_content(jsonb) from public, anon;
grant execute on function public.santa_valid_library_content(jsonb) to authenticated;

create table public.santa_libraries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 500),
  creator_name text not null default '單字同好' check (length(trim(creator_name)) between 1 and 40),
  visibility text not null default 'private' check (visibility in ('private','public')),
  content jsonb not null default '{"includeBaseWords":false,"customWords":[],"wordChanges":[]}'::jsonb check (public.santa_valid_library_content(content)),
  revision integer not null default 1 check(revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index santa_libraries_owner_created on public.santa_libraries(owner_id,created_at desc,id);
create index santa_libraries_public_created on public.santa_libraries(created_at desc,id) where visibility = 'public';
alter table public.santa_libraries enable row level security;
revoke all on public.santa_libraries from anon, authenticated;
grant select on public.santa_libraries to authenticated;
grant insert(owner_id,name,description,creator_name,visibility,content) on public.santa_libraries to authenticated;
grant update(name,description,creator_name,visibility,content) on public.santa_libraries to authenticated;
create policy libraries_read on public.santa_libraries for select to authenticated
  using(owner_id = (select auth.uid()) or visibility = 'public');
create policy libraries_create on public.santa_libraries for insert to authenticated
  with check(owner_id = (select auth.uid()));
create policy libraries_edit on public.santa_libraries for update to authenticated
  using(owner_id = (select auth.uid())) with check(owner_id = (select auth.uid()));

create function public.santa_library_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.id <> old.id or new.owner_id <> old.owner_id then raise exception 'Library ownership cannot change.' using errcode='42501'; end if;
  if new.content->'includeBaseWords' is distinct from old.content->'includeBaseWords' then raise exception 'Library base cannot change.' using errcode='22023'; end if;
  new.revision := old.revision + 1; new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.santa_library_revision() from public, anon, authenticated;
create trigger santa_library_revision before update on public.santa_libraries for each row execute function public.santa_library_revision();

create table public.santa_library_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  library_id uuid not null references public.santa_libraries(id) on delete cascade,
  state jsonb not null default '{"version":2,"progress":{},"history":[],"includeBaseWords":false,"customWords":[],"wordChanges":[]}'::jsonb,
  revision integer not null default 0 check(revision >= 0),
  updated_at timestamptz not null default now(),
  primary key(user_id,library_id),
  check(jsonb_typeof(state) = 'object' and state->>'version' = '2'
    and jsonb_typeof(state->'progress') = 'object' and jsonb_typeof(state->'history') = 'array'
    and jsonb_array_length(state->'history') <= 500 and octet_length(state::text) <= 2000000)
);
create index santa_library_progress_library on public.santa_library_progress(library_id);
alter table public.santa_library_progress enable row level security;
revoke all on public.santa_library_progress from anon, authenticated;
grant select,insert,update on public.santa_library_progress to authenticated;
create policy library_progress_read on public.santa_library_progress for select to authenticated using(user_id = (select auth.uid()));
create policy library_progress_insert on public.santa_library_progress for insert to authenticated with check(user_id = (select auth.uid()) and exists(select 1 from public.santa_libraries l where l.id=library_id));
create policy library_progress_update on public.santa_library_progress for update to authenticated using(user_id = (select auth.uid())) with check(user_id = (select auth.uid()) and exists(select 1 from public.santa_libraries l where l.id=library_id));

create function public.sync_santa_library_progress(p_expected_user_id uuid,p_library_id uuid,p_base_revision integer,p_state jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_content jsonb; v_row public.santa_library_progress%rowtype; v_state jsonb;
begin
  if v_uid is null or v_uid <> p_expected_user_id then raise exception 'Authentication changed; sign in again.' using errcode='42501'; end if;
  if p_base_revision is null or p_base_revision < 0 then raise exception 'Invalid revision.' using errcode='22023'; end if;
  select content into v_content from public.santa_libraries where id=p_library_id;
  if not found then raise exception 'Library is not accessible.' using errcode='42501'; end if;
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' or p_state->>'version' is distinct from '2'
    or jsonb_typeof(p_state->'progress') is distinct from 'object' or jsonb_typeof(p_state->'history') is distinct from 'array'
    or octet_length(p_state::text) > 2000000 then raise exception 'Invalid progress payload.' using errcode='22023'; end if;
  if jsonb_array_length(p_state->'history') > 500 then raise exception 'Too many review events.' using errcode='22023'; end if;
  if p_state ? 'reviewReset' then
    if jsonb_typeof(p_state->'reviewReset') is distinct from 'object'
      or jsonb_typeof(p_state->'reviewReset'->'at') is distinct from 'string'
      or (p_state->'reviewReset'->>'at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      or jsonb_typeof(p_state->'reviewReset'->'id') is distinct from 'string'
      or (p_state->'reviewReset'->>'id') !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'Invalid review reset.' using errcode='22023'; end if;
    perform (p_state->'reviewReset'->>'at')::timestamptz;
  end if;
  v_state := (p_state - 'includeBaseWords' - 'customWords' - 'wordChanges') || v_content;
  insert into public.santa_library_progress(user_id,library_id,state) values(v_uid,p_library_id,
    '{"version":2,"progress":{},"history":[]}'::jsonb || v_content) on conflict(user_id,library_id) do nothing;
  select * into strict v_row from public.santa_library_progress where user_id=v_uid and library_id=p_library_id for update;
  if v_row.revision <> p_base_revision then return jsonb_build_object('applied',false,'revision',v_row.revision,'state',v_row.state,'updated_at',v_row.updated_at); end if;
  if v_row.state ? 'reviewReset' and (not (v_state ? 'reviewReset')
    or (v_state->'reviewReset'->>'at')::timestamptz < (v_row.state->'reviewReset'->>'at')::timestamptz
    or ((v_state->'reviewReset'->>'at')::timestamptz = (v_row.state->'reviewReset'->>'at')::timestamptz and (v_state->'reviewReset'->>'id') < (v_row.state->'reviewReset'->>'id'))) then
    raise exception 'Review reset is missing or stale.' using errcode='22023';
  end if;
  update public.santa_library_progress set state=v_state,revision=revision+1,updated_at=now() where user_id=v_uid and library_id=p_library_id returning * into v_row;
  return jsonb_build_object('applied',true,'revision',v_row.revision,'state',v_row.state,'updated_at',v_row.updated_at);
end;
$$;
revoke all on function public.sync_santa_library_progress(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.sync_santa_library_progress(uuid,uuid,integer,jsonb) to authenticated;

commit;

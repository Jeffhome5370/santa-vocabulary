begin;
alter table public.santa_libraries add column deleted_at timestamptz;
create index santa_libraries_owner_deleted on public.santa_libraries(owner_id,deleted_at desc,id) where deleted_at is not null;
grant update(deleted_at) on public.santa_libraries to authenticated;
alter policy libraries_read on public.santa_libraries using(owner_id=(select auth.uid()) or (visibility='public' and deleted_at is null));
alter policy library_progress_insert on public.santa_library_progress with check(user_id=(select auth.uid()) and exists(select 1 from public.santa_libraries l where l.id=library_id and l.deleted_at is null));
alter policy library_progress_update on public.santa_library_progress using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from public.santa_libraries l where l.id=library_id and l.deleted_at is null));

create or replace function public.santa_library_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.id <> old.id or new.owner_id <> old.owner_id then raise exception 'Library ownership cannot change.' using errcode='42501'; end if;
  if new.content->'includeBaseWords' is distinct from old.content->'includeBaseWords' then raise exception 'Library base cannot change.' using errcode='22023'; end if;
  if old.deleted_at is not null and new.deleted_at is not null then raise exception 'Restore the library before editing.' using errcode='22023'; end if;
  if new.deleted_at is distinct from old.deleted_at then
    if (new.name,new.description,new.creator_name,new.visibility,new.content) is distinct from (old.name,old.description,old.creator_name,old.visibility,old.content) then
      raise exception 'Delete or restore separately from editing.' using errcode='22023';
    end if;
    if new.deleted_at is not null then new.deleted_at:=now(); end if;
  end if;
  new.revision:=old.revision+1; new.updated_at:=now();
  return new;
end;
$$;

create function public.set_santa_library_deleted(p_library_id uuid,p_base_revision integer,p_deleted boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid:=auth.uid(); v_row public.santa_libraries%rowtype;
begin
  if v_uid is null then raise exception 'Sign in first.' using errcode='42501'; end if;
  if p_base_revision is null or p_base_revision<1 or p_deleted is null then raise exception 'Invalid library change.' using errcode='22023'; end if;
  update public.santa_libraries set deleted_at=case when p_deleted then now() else null end
    where id=p_library_id and owner_id=v_uid and revision=p_base_revision
      and ((p_deleted and deleted_at is null) or (not p_deleted and deleted_at is not null)) returning * into v_row;
  if not found then raise exception 'Library changed or is not owned by you; reload and try again.' using errcode='40001'; end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.set_santa_library_deleted(uuid,integer,boolean) from public,anon;
grant execute on function public.set_santa_library_deleted(uuid,integer,boolean) to authenticated;


create or replace function public.sync_santa_library_progress(p_expected_user_id uuid,p_library_id uuid,p_base_revision integer,p_state jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_content jsonb; v_row public.santa_library_progress%rowtype; v_state jsonb;
begin
  if v_uid is null or v_uid <> p_expected_user_id then raise exception 'Authentication changed; sign in again.' using errcode='42501'; end if;
  if p_base_revision is null or p_base_revision < 0 then raise exception 'Invalid revision.' using errcode='22023'; end if;
  select content into v_content from public.santa_libraries where id=p_library_id and deleted_at is null;
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

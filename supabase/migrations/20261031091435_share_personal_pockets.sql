begin;
alter table public.santa_libraries add column source_personal boolean not null default false;
create unique index santa_libraries_one_personal_source on public.santa_libraries(owner_id) where source_personal;
grant insert(source_personal) on public.santa_libraries to authenticated;

-- Expose vocabulary only. Private reviews, stars, history and account data never
-- become part of the shared content. This helper obeys the existing private RLS.
create function public.santa_personal_pocket_content(p_owner_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select coalesce((select jsonb_build_object(
    'includeBaseWords',coalesce(state->'includeBaseWords','true'::jsonb),
    'customWords',coalesce(state->'customWords','[]'::jsonb),
    'wordChanges',coalesce(state->'wordChanges','[]'::jsonb))
    from public.santa_progress where user_id=p_owner_id and p_owner_id=(select auth.uid())),
    '{"includeBaseWords":false,"customWords":[],"wordChanges":[]}'::jsonb);
$$;
revoke all on function public.santa_personal_pocket_content(uuid) from public,anon;
grant execute on function public.santa_personal_pocket_content(uuid) to authenticated;

create function public.santa_personal_library_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP='UPDATE' and new.source_personal is distinct from old.source_personal then
    raise exception 'Library source cannot change.' using errcode='42501';
  end if;
  if new.source_personal then
    if new.deleted_at is not null then raise exception 'Use personal pocket sharing settings to stop sharing.' using errcode='22023'; end if;
    new.content:=public.santa_personal_pocket_content(new.owner_id);
  end if;
  return new;
end;
$$;
revoke all on function public.santa_personal_library_guard() from public,anon,authenticated;
-- Alphabetical trigger order ensures authoritative content is set before the
-- existing revision and deletion guards inspect it.
create trigger santa_library_personal_guard before insert or update on public.santa_libraries for each row execute function public.santa_personal_library_guard();

create function public.santa_refresh_personal_library() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_content jsonb;
begin
  if new.user_id is distinct from auth.uid() then return new; end if;
  v_content:=public.santa_personal_pocket_content(new.user_id);
  update public.santa_libraries set content=v_content
    where owner_id=new.user_id and source_personal and visibility='public' and deleted_at is null and content is distinct from v_content;
  return new;
end;
$$;
revoke all on function public.santa_refresh_personal_library() from public,anon,authenticated;
create trigger santa_progress_refresh_personal_library after insert or update of state on public.santa_progress for each row execute function public.santa_refresh_personal_library();

create function public.share_santa_personal_pocket(p_base_revision integer,p_name text,p_description text,p_creator_name text,p_visibility text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_library public.santa_libraries%rowtype;
begin
  if v_uid is null then raise exception 'Sign in first.' using errcode='42501'; end if;
  if p_base_revision is null or p_base_revision<0 or p_name is null or p_description is null or p_creator_name is null or p_visibility is null then raise exception 'Invalid sharing settings.' using errcode='22023'; end if;
  -- Serialize with normal progress writes so publishing cannot miss a concurrent
  -- vocabulary edit. Use the same private-row -> library-row lock order.
  insert into public.santa_progress(user_id,state) values(v_uid,'{"version":2,"progress":{},"history":[],"includeBaseWords":false,"customWords":[],"wordChanges":[]}'::jsonb) on conflict(user_id) do nothing;
  perform 1 from public.santa_progress where user_id=v_uid for update;
  select * into v_library from public.santa_libraries where owner_id=v_uid and source_personal for update;
  if found then
    if v_library.revision<>p_base_revision then raise exception 'Sharing settings changed; reload and try again.' using errcode='40001'; end if;
    update public.santa_libraries set name=p_name,description=p_description,creator_name=p_creator_name,visibility=p_visibility,
      content=public.santa_personal_pocket_content(v_uid) where id=v_library.id returning * into v_library;
  else
    if p_base_revision<>0 then raise exception 'Sharing settings changed; reload and try again.' using errcode='40001'; end if;
    insert into public.santa_libraries(owner_id,name,description,creator_name,visibility,source_personal,content)
      values(v_uid,p_name,p_description,p_creator_name,p_visibility,true,public.santa_personal_pocket_content(v_uid)) returning * into v_library;
  end if;
  return to_jsonb(v_library);
end;
$$;
revoke all on function public.share_santa_personal_pocket(integer,text,text,text,text) from public,anon;
grant execute on function public.share_santa_personal_pocket(integer,text,text,text,text) to authenticated;
commit;

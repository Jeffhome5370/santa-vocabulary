begin;
-- Retire the provisional unbound overload before publishing the new UI.
revoke all on function public.share_santa_personal_pocket(integer,text,text,text,text) from public,anon,authenticated;
create function public.share_santa_personal_pocket(p_expected_user_id uuid,p_base_revision integer,p_name text,p_description text,p_creator_name text,p_visibility text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_library public.santa_libraries%rowtype;
begin
  if v_uid is null or v_uid is distinct from p_expected_user_id then raise exception 'Authentication changed; sign in again.' using errcode='42501'; end if;
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
revoke all on function public.share_santa_personal_pocket(uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.share_santa_personal_pocket(uuid,integer,text,text,text,text) to authenticated;
commit;

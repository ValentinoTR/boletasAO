-- La cuenta se crea y valida con la API de administración de Auth en la función.
-- service_role no necesita permiso de lectura sobre auth.users.
create or replace function public.ao_server_finish_activation(owner_id uuid, owner_name text) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from ao_private.settings where key='activation' and value->>'state'='in_progress') then raise exception 'Activación no disponible.'; end if;
  insert into public.ao_members(user_id,display_name,role) values(owner_id,owner_name,'owner');
  update ao_private.settings set value=jsonb_build_object('state','consumed'),updated_at=now() where key='activation';
end;
$$;
revoke all on function public.ao_server_finish_activation(uuid,text) from public, anon, authenticated;
grant execute on function public.ao_server_finish_activation(uuid,text) to service_role;

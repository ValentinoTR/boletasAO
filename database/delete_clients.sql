-- Incremental update for an existing AO Nexus Central installation (run once in the Supabase SQL editor).
-- Lets the team remove a client that has no issued receipts, for example a test or duplicated client.
-- Clients with receipts are kept: their receipts are the sale history. Delete those receipts first
-- («Boletas emitidas → Eliminar»); a deleted receipt no longer counts as a sale of the client.
create function ao_private.suite_delete_client(client_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  saved public.ao_clients%rowtype;
  sales_count integer;
begin
  if not ao_private.is_member() then raise exception 'Acceso no autorizado.' using errcode='42501'; end if;
  if client_key is null then raise exception 'Selecciona el cliente que deseas eliminar.'; end if;
  -- The row lock serializes with a receipt being issued for the same client (its upsert locks this row too).
  select * into saved from public.ao_clients where id=client_key for update;
  if not found then
    return jsonb_build_object('deleted',true,'already_deleted',true,'id',client_key);
  end if;
  select count(*) into sales_count from public.ao_sales where client_id=client_key;
  if sales_count>0 then
    raise exception 'Este cliente tiene % boleta(s) emitida(s). Para eliminarlo, primero elimina sus boletas en «Boletas emitidas».',sales_count
      using errcode='23503';
  end if;
  delete from public.ao_clients where id=client_key;
  return jsonb_build_object('deleted',true,'already_deleted',false,'id',client_key,'name',saved.name);
end;
$$;
revoke all on function ao_private.suite_delete_client(uuid) from public,anon;
grant execute on function ao_private.suite_delete_client(uuid) to authenticated;
create function public.ao_suite_delete_client(client_key uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select ao_private.suite_delete_client(client_key);
$$;
revoke all on function public.ao_suite_delete_client(uuid) from public,anon;
grant execute on function public.ao_suite_delete_client(uuid) to authenticated;

notify pgrst,'reload schema';

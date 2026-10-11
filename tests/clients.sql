-- Real PostgreSQL checks for database/delete_clients.sql. Every fixture is rolled back.
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true)
from public.ao_members where active and role='owner' limit 1;
set local role authenticated;
do $$
declare
  rid uuid:=gen_random_uuid(); client uuid; result jsonb; rejected boolean; message text;
begin
  -- Una boleta registra al cliente.
  perform public.ao_suite_issue_receipt(rid,jsonb_build_object('version',1,'series','QACLI','number','1','date','2026-10-11','customer','PRUEBA CLIENTE','docType','DNI',
    'document','22222222','address','','email','cliente@example.com','observations','','items',jsonb_build_array(jsonb_build_object('description','Mouse','serial','','code','',
    'unit','NIU','quantity','1','price','50.00','inventoryMode','units','inventory',jsonb_build_array(jsonb_build_object('source','external','name','PRUEBA MOUSE','supplier','Venta sin stock','cost','0.00','price','50.00'))))));
  select client_id into client from public.ao_sales where receipt_id=rid;
  if client is null then raise exception 'La boleta no registró al cliente'; end if;

  -- Con una boleta emitida no se puede eliminar: su boleta es el historial de la venta.
  rejected:=false;
  begin perform public.ao_suite_delete_client(client);
    exception when foreign_key_violation then rejected:=true; message:=sqlerrm; end;
  if not rejected or message not like '%1 boleta(s) emitida(s)%' or not exists(select 1 from public.ao_clients where id=client)
    then raise exception 'Se eliminó un cliente con boletas emitidas'; end if;

  -- Eliminada su boleta, el cliente ya no tiene ventas y se puede eliminar.
  perform public.ao_suite_delete_receipt(rid);
  result:=public.ao_suite_delete_client(client);
  if result->>'deleted'<>'true' or result->>'already_deleted'<>'false' or exists(select 1 from public.ao_clients where id=client)
    then raise exception 'No se eliminó el cliente sin boletas: %',result; end if;
  -- Repetir la eliminación no falla.
  result:=public.ao_suite_delete_client(client);
  if result->>'already_deleted'<>'true' then raise exception 'Un reintento de eliminación falló: %',result; end if;

  -- El mismo documento vuelve a registrarse con una boleta nueva.
  perform public.ao_suite_issue_receipt(gen_random_uuid(),jsonb_build_object('version',1,'series','QACLI','number','2','date','2026-10-11','customer','PRUEBA CLIENTE','docType','DNI',
    'document','22222222','address','','email','','observations','','items',jsonb_build_array(jsonb_build_object('description','Mouse','serial','','code','',
    'unit','NIU','quantity','1','price','50.00','inventoryMode','units','inventory',jsonb_build_array(jsonb_build_object('source','external','name','PRUEBA MOUSE','supplier','Venta sin stock','cost','0.00','price','50.00'))))));
  if (select count(*) from public.ao_clients where doc_type='DNI' and document='22222222')<>1 then raise exception 'El cliente no se volvió a registrar'; end if;

  -- Sin acceso al equipo no se puede eliminar (con el id real del cliente, leído antes como dueño).
  select id into client from public.ao_clients where doc_type='DNI' and document='22222222';
  perform set_config('request.jwt.claims','{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}',true);
  rejected:=false;
  begin perform public.ao_suite_delete_client(client);
    exception when insufficient_privilege then rejected:=true; end;
  if not rejected or client is null then raise exception 'Una cuenta ajena puede eliminar clientes'; end if;
end;
$$;
rollback;
select true as client_tests_passed;

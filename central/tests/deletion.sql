begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true)
from public.ao_members where active and role='owner' limit 1;
set local role authenticated;
do $$
declare
  product bigint; purchase bigint; unit_id bigint; mixed_unit bigint;
  rid uuid:=gen_random_uuid(); mixed uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid();
  receipt jsonb; rejected boolean:=false;
begin
  insert into public.ao_products(data,web_price,managed)
    values('{"name":"PRUEBA ELIMINAR SSD","category":"ssd"}',750,false) returning id into product;
  insert into public."COMPRAS"(nombre,costo) values('PRUEBA ELIMINAR SSD',600) returning id into purchase;
  insert into public."COMPONENTES"(compra_id,nombre,costo)
    values(purchase,'PRUEBA ELIMINAR SSD',600) returning id into unit_id;
  perform public.ao_suite_link_stock(product,array[unit_id],1);
  receipt:=jsonb_build_object('version',1,'series','QADELETE','number','1','date','2026-10-10',
    'customer','PRUEBA BORRAR CLIENTE','docType','NONE','document','','address','','email','','observations','',
    'items',jsonb_build_array(jsonb_build_object('description','SSD 1 TB','serial','','code','','unit','NIU',
      'quantity','1','price','700.00','inventoryMode','units','inventory',jsonb_build_array(
        jsonb_build_object('source','stock','id',unit_id,'price','700.00')))));
  perform public.ao_suite_issue_receipt(rid,receipt);
  begin update public.ao_receipts set deleted_at=now() where id=rid;
    exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Se permite eliminar sin la reversión controlada'; end if;
  rejected:=false;
  begin update public."COMPONENTES" set receipt_id=null,precio_venta=null,sale_cost=null,
    fecha_venta=null,comprador_nombre=null,comprador_documento=null where id=unit_id;
    exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'Una venta vigente puede revertirse directamente'; end if;
  insert into public."COMPRAS"(nombre,costo) values('PRUEBA ELIMINAR CPU',1000) returning id into purchase;
  insert into public."COMPONENTES"(compra_id,nombre,costo)
    values(purchase,'PRUEBA ELIMINAR CPU',1000) returning id into mixed_unit;
  perform public.ao_suite_issue_receipt(mixed,jsonb_set(receipt,'{items}',jsonb_build_array(
    jsonb_build_object('description','PC completa','serial','','code','','unit','NIU','quantity','1',
      'price','2100.00','inventoryMode','bundle','inventory',jsonb_build_array(
        jsonb_build_object('source','stock','id',mixed_unit,'price','1200.00'),
        jsonb_build_object('source','external','name','PRUEBA ELIMINAR GPU','supplier','PRUEBA TIENDA',
          'cost','800.00','price','900.00'))))));
  perform public.ao_issue_receipt(legacy,receipt);
  perform set_config('ao.qa.delete',jsonb_build_object('id',rid,'mixed',mixed,'legacy',legacy,
    'unit',unit_id,'product',product,'receipt',receipt,'next_number',public.ao_next_number('QADELETE'))::text,true);
end;
$$;
reset role;
insert into public.ao_deliveries(id,receipt_id,digest,state,initiated_by)
values(gen_random_uuid(),(current_setting('ao.qa.delete')::jsonb->>'id')::uuid,repeat('a',64),'pending',auth.uid());
set local role authenticated;
do $$
declare ctx jsonb:=current_setting('ao.qa.delete')::jsonb; rejected boolean:=false;
begin
  begin perform public.ao_suite_delete_receipt((ctx->>'id')::uuid);
    exception when raise_exception then
      if sqlerrm like '%envío de correo en curso%' then rejected:=true; else raise; end if;
  end;
  if not rejected or not exists(select 1 from public.ao_sales where receipt_id=(ctx->>'id')::uuid)
    then raise exception 'El envío en curso no protegió la boleta y su venta'; end if;
end;
$$;
reset role;
update public.ao_deliveries set state='sent'
where receipt_id=(current_setting('ao.qa.delete')::jsonb->>'id')::uuid;
set local role authenticated;
do $$
declare
  ctx jsonb:=current_setting('ao.qa.delete')::jsonb;
  rid uuid:=(ctx->>'id')::uuid; mixed uuid:=(ctx->>'mixed')::uuid;
  result jsonb; replacement uuid:=gen_random_uuid(); rejected boolean; purchases_before integer;
begin
  result:=public.ao_suite_delete_receipt(rid);
  if result->>'deleted'<>'true' or result->>'restored_units'<>'1' then raise exception 'Eliminación incorrecta'; end if;
  if exists(select 1 from public.ao_receipts where id=rid) or exists(select 1 from public.ao_sales where receipt_id=rid)
    or exists(select 1 from public.ao_sale_items where receipt_id=rid) then raise exception 'Boleta eliminada sigue visible en el historial o las ventas'; end if;
  if not exists(select 1 from public."COMPONENTES" where id=(ctx->>'unit')::bigint
    and receipt_id is null and precio_venta is null and sale_cost is null and fecha_venta is null
    and comprador_nombre is null and comprador_documento is null and costo=600
    and product_id=(ctx->>'product')::bigint) then raise exception 'Unidad no volvió al inventario con su costo y producto'; end if;
  if (select (value->>'stock')::integer from jsonb_array_elements(public.ao_catalog_snapshot()->'productos')
    where (value->>'id')::bigint=(ctx->>'product')::bigint)<>1 then raise exception 'Stock de la web no se restauró'; end if;
  if public.ao_next_number('QADELETE')::text<>ctx->>'next_number' then raise exception 'Número eliminado fue reutilizado'; end if;
  result:=public.ao_suite_delete_receipt(rid);
  if result->>'already_deleted'<>'true' or result->>'restored_units'<>'0' then raise exception 'Reintento de eliminar no es idempotente'; end if;
  rejected:=false;
  begin perform public.ao_suite_issue_receipt(rid,ctx->'receipt'); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'Un reintento recreó una boleta eliminada'; end if;
  rejected:=false;
  begin perform public.ao_issue_receipt(rid,ctx->'receipt'); exception when raise_exception then
    if sqlerrm like '%boleta fue eliminada%' then rejected:=true;else raise;end if; end;
  if not rejected then raise exception 'Numerador anterior devuelve una boleta eliminada'; end if;
  perform public.ao_suite_issue_receipt(replacement,ctx->'receipt');
  if (select sum(sale_price-cost) from public.ao_sale_items where receipt_id=replacement)<>100
    then raise exception 'La unidad restaurada no puede revenderse correctamente'; end if;
  perform public.ao_suite_delete_receipt(rid);
  if not exists(select 1 from public."COMPONENTES" where id=(ctx->>'unit')::bigint and receipt_id=replacement)
    then raise exception 'Repetir eliminación alteró la venta nueva'; end if;
  perform public.ao_suite_delete_receipt(replacement);
  select count(*) into purchases_before from public."COMPRAS";
  result:=public.ao_suite_delete_receipt(mixed);
  if result->>'restored_units'<>'2' then raise exception 'PC mixta no devuelve todos sus componentes'; end if;
  if (select count(*) from public."COMPRAS")<>purchases_before or not exists(select 1 from public."COMPONENTES"
    where nombre='PRUEBA ELIMINAR GPU' and costo=800 and precio_venta is null and receipt_id is null)
    then raise exception 'Compra externa no se conservó disponible con su costo real'; end if;
  result:=public.ao_suite_delete_receipt((ctx->>'legacy')::uuid);
  if result->>'restored_units'<>'0' or exists(select 1 from public.ao_receipts where id=(ctx->>'legacy')::uuid)
    then raise exception 'No se puede eliminar una boleta antigua sin inventario vinculado'; end if;
end;
$$;
reset role;
do $$
declare ctx jsonb:=current_setting('ao.qa.delete')::jsonb; rejected boolean:=false;
begin
  if not exists(select 1 from public.ao_receipts where id=(ctx->>'id')::uuid and deleted_at is not null
    and deleted_by=auth.uid()) then raise exception 'No se conservó registro de eliminación y numeración'; end if;
  begin insert into public.ao_deliveries(id,receipt_id,digest,state,initiated_by)
    values(gen_random_uuid(),(ctx->>'id')::uuid,repeat('b',64),'pending',auth.uid());
    exception when raise_exception then
      if sqlerrm like '%fue eliminada%' then rejected:=true; else raise; end if;
  end;
  if not rejected then raise exception 'Un envío tardío puede enviar una boleta eliminada'; end if;
end;
$$;
set local role anon;
do $$
declare rejected boolean:=false;
begin
  begin perform public.ao_suite_delete_receipt(gen_random_uuid()); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Usuario público puede eliminar'; end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}',true);
do $$
declare rejected boolean:=false;
begin
  begin perform public.ao_suite_delete_receipt((current_setting('ao.qa.delete')::jsonb->>'id')::uuid);
    exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Cuenta ajena puede eliminar'; end if;
end;
$$;
rollback;
select true as deletion_tests_passed;

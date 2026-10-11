-- Real PostgreSQL checks. Every fixture is rolled back.
-- Activar el descuento automático: la cantidad del catálogo anterior pasa a unidades reales sin costo,
-- y desde entonces las ventas (boleta o Compras) bajan el stock publicado y eliminar la boleta lo devuelve.
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true)
from public.ao_members where active and role='owner' limit 1;
set local role authenticated;
do $$
declare
  legacy bigint; empty_legacy bigint; huge bigint; key1 uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid();
  first_result jsonb; unit bigint; receipt jsonb; rejected boolean;
  function_stock integer;
begin
  insert into public.ao_products(data,web_price,published,managed,reference_stock)
    values('{"name":"PRUEBA 7700X","category":"cpu"}',850,true,false,2) returning id into legacy;
  insert into public.ao_products(data,web_price,published,managed,reference_stock)
    values('{"name":"PRUEBA SIN STOCK","category":"cpu"}',450,true,false,0) returning id into empty_legacy;
  insert into public.ao_products(data,web_price,published,managed,reference_stock)
    values('{"name":"PRUEBA ENORME","category":"cpu"}',100,true,false,1200) returning id into huge;
  select (e->>'stock')::integer into function_stock from jsonb_array_elements(public.ao_catalog_snapshot()->'productos') e where (e->>'id')::bigint=legacy;
  if function_stock<>2 then raise exception 'El catálogo anterior debía publicar 2 unidades'; end if;

  -- Argumentos que envía la app: cantidad anterior como unidades reales sin costo.
  first_result:=public.ao_suite_set_stock(key1,legacy,'PRUEBA 7700X',2,0,0,null,current_date);
  if (select managed from public.ao_products where id=legacy) is not true
    or (select reference_stock from public.ao_products where id=legacy)<>0
    or (select count(*) from public."COMPONENTES" where product_id=legacy and precio_venta is null and in_stock)<>2
    or (select costo from public."COMPRAS" where id=(first_result->>'purchase_id')::bigint)<>0
    then raise exception 'La activación no registró 2 unidades sin costo'; end if;
  if public.ao_suite_set_stock(key1,legacy,'PRUEBA 7700X',2,0,0,null,current_date)<>first_result
    or (select count(*) from public."COMPONENTES" where product_id=legacy)<>2
    then raise exception 'Un reintento duplicó las unidades'; end if;
  select (e->>'stock')::integer into function_stock from jsonb_array_elements(public.ao_catalog_snapshot()->'productos') e where (e->>'id')::bigint=legacy;
  if function_stock<>2 then raise exception 'Tras activar debía seguir publicando 2 unidades'; end if;

  -- Venta en una boleta: el stock publicado baja y eliminar la boleta lo devuelve.
  select min(id) into unit from public."COMPONENTES" where product_id=legacy;
  receipt:=jsonb_build_object('version',1,'series','QAACT','number','1','date','2026-10-11','customer','PRUEBA ACTIVACION','docType','NONE',
    'document','','address','','email','','observations','','items',jsonb_build_array(jsonb_build_object('description','7700X','serial','','code','',
    'unit','NIU','quantity','1','price','850.00','inventoryMode','units','inventory',jsonb_build_array(jsonb_build_object('source','stock','id',unit,'name','PRUEBA 7700X','price','850.00')))));
  perform public.ao_suite_issue_receipt(rid,receipt);
  select (e->>'stock')::integer into function_stock from jsonb_array_elements(public.ao_catalog_snapshot()->'productos') e where (e->>'id')::bigint=legacy;
  if function_stock<>1 then raise exception 'La venta en boleta no bajó el stock publicado (esperado 1, hay %)',function_stock; end if;
  perform public.ao_suite_delete_receipt(rid);
  select (e->>'stock')::integer into function_stock from jsonb_array_elements(public.ao_catalog_snapshot()->'productos') e where (e->>'id')::bigint=legacy;
  if function_stock<>2 then raise exception 'Eliminar la boleta no devolvió la unidad (esperado 2, hay %)',function_stock; end if;

  -- Venta registrada desde Compras (actualiza COMPONENTES directamente).
  update public."COMPONENTES" set precio_venta=800,fecha_venta=now() where id=unit;
  select (e->>'stock')::integer into function_stock from jsonb_array_elements(public.ao_catalog_snapshot()->'productos') e where (e->>'id')::bigint=legacy;
  if function_stock<>1 then raise exception 'La venta en Compras no bajó el stock publicado (esperado 1, hay %)',function_stock; end if;

  -- Producto sin cantidad: solo pasa a controlado, sin crear compras.
  perform public.ao_suite_set_stock(gen_random_uuid(),empty_legacy,'PRUEBA SIN STOCK',0,0,0,null,current_date);
  if (select managed from public.ao_products where id=empty_legacy) is not true
    or exists(select 1 from public."COMPRAS" where nombre='PRUEBA SIN STOCK') then raise exception 'Un producto sin cantidad creó compras'; end if;

  -- Un producto ya controlado no se reactiva con otra clave.
  rejected:=false;
  begin perform public.ao_suite_set_stock(gen_random_uuid(),legacy,'PRUEBA 7700X',2,0,0,null,current_date);
    exception when others then rejected:=true; end;
  if not rejected or (select count(*) from public."COMPONENTES" where product_id=legacy)<>2 then raise exception 'Se reactivó un producto ya controlado'; end if;

  -- Más de 1000 unidades por compra se rechaza sin tocar el producto.
  rejected:=false;
  begin perform public.ao_suite_set_stock(gen_random_uuid(),huge,'PRUEBA ENORME',1200,0,0,null,current_date);
    exception when others then rejected:=true; end;
  if not rejected or (select managed from public.ao_products where id=huge) is true then raise exception 'Se activó un producto con más de 1000 unidades'; end if;
end;
$$;
rollback;
select true as activation_tests_passed;

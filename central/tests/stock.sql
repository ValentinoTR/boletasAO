-- Real PostgreSQL checks. Every fixture is rolled back.
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true)
from public.ao_members where active and role='owner' limit 1;
set local role authenticated;
do $$
declare
  req uuid:=gen_random_uuid(); correction uuid:=gen_random_uuid(); restock uuid:=gen_random_uuid();
  purchase_req uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid();
  data jsonb:='{"data":{"name":"PRUEBA STOCK SSD","category":"ssd","image":"https://example.com/ssd.png"},"web_price":750,"published":true,"updated_at":"2026-10-10T12:00:00Z"}';
  result jsonb; original_result jsonb; receipt jsonb; product bigint; purchase bigint; ids bigint[];
  retired bigint; second_product bigint; before_products integer; before_purchases integer;
  before_units integer; before_ops integer; rejected boolean; entry jsonb;
begin
  result:=public.ao_suite_create_product(req,data,3,600,'PRUEBA PROVEEDOR','2026-10-10');
  product:=(result->>'product_id')::bigint; purchase:=(result->>'purchase_id')::bigint;
  select array_agg(id order by id) into ids from public."COMPONENTES" where product_id=product;
  if cardinality(ids)<>3 or (select costo from public."COMPRAS" where id=purchase)<>1800
    or exists(select 1 from unnest(ids) id where public.ao_component_cost(id)<>600)
    then raise exception 'Cantidad inicial o costo de las unidades incorrectos'; end if;
  original_result:=public.ao_suite_create_product(req,data||'{"updated_at":"2026-10-11T01:00:00Z"}',3,600,'PRUEBA PROVEEDOR','2026-10-10');
  if result<>original_result or (select count(*) from public."COMPONENTES" where product_id=product)<>3
    then raise exception 'Un reintento duplicó el producto o sus unidades'; end if;
  rejected:=false;
  begin perform public.ao_suite_create_product(req,data,4,600,'PRUEBA PROVEEDOR','2026-10-10');
    exception when unique_violation then rejected:=true; end;
  if not rejected then raise exception 'Se cambiaron los datos de una operación ya guardada'; end if;
  receipt:=jsonb_build_object('version',1,'series','QASTOCK','number','1','date','2026-10-10',
    'customer','PRUEBA STOCK CLIENTE','docType','NONE','document','','address','','email','','observations','',
    'items',jsonb_build_array(jsonb_build_object('description','SSD 1 TB','serial','','code','','unit','NIU',
      'quantity','1','price','700.00','inventoryMode','units','inventory',jsonb_build_array(
        jsonb_build_object('source','stock','id',ids[1],'price','700.00')))));
  perform public.ao_suite_issue_receipt(rid,receipt);
  result:=public.ao_suite_set_stock(correction,product,'PRUEBA STOCK SSD',1,2,null,null,'2026-10-10');
  if result->>'change'<>'-1' or (select count(*) from public."COMPONENTES" where product_id=product)<>3
    or (select count(*) from public."COMPONENTES" where product_id=product and in_stock and precio_venta is null)<>1
    or exists(select 1 from unnest(ids) id where public.ao_component_cost(id)<>600)
    or (select sale_price-cost from public.ao_sale_items where receipt_id=rid)<>100
    then raise exception 'Corregir stock alteró compras, costos o ganancias anteriores'; end if;
  select id into retired from public."COMPONENTES" where product_id=product and not in_stock;
  if retired<>ids[3] then raise exception 'No se retiró primero la unidad disponible más reciente'; end if;
  if result<>public.ao_suite_set_stock(correction,product,'PRUEBA STOCK SSD',1,2,null,null,'2026-10-10')
    then raise exception 'El reintento de corrección no es idempotente'; end if;
  rejected:=false;
  begin perform public.ao_suite_issue_receipt(gen_random_uuid(),jsonb_set(receipt,'{items,0,inventory,0,id}',to_jsonb(retired)));
    exception when raise_exception then if sqlerrm like '%ya se vendió%' then rejected:=true;else raise;end if; end;
  if not rejected then raise exception 'Se vendió una unidad retirada del stock'; end if;
  rejected:=false;
  begin perform public.ao_suite_link_stock(product,array[retired],2);
    exception when raise_exception then if sqlerrm like '%unidades disponibles%' then rejected:=true;else raise;end if; end;
  if not rejected then raise exception 'Se volvió a vincular una unidad retirada'; end if;
  rejected:=false;
  begin perform public.ao_suite_set_stock(gen_random_uuid(),product,'PRUEBA STOCK SSD',2,2,400,null,'2026-10-10');
    exception when raise_exception then if sqlerrm like '%stock cambió%' then rejected:=true;else raise;end if; end;
  if not rejected then raise exception 'Se aceptó una cantidad desactualizada'; end if;
  perform public.ao_suite_set_stock(gen_random_uuid(),product,'PRUEBA STOCK SSD',0,1,null,null,'2026-10-10');
  select value into entry from jsonb_array_elements(public.ao_catalog_snapshot()->'productos')
    where (value->>'id')::bigint=product;
  if entry->>'stock'<>'0' or entry->>'image'<>'https://example.com/ssd.png'
    then raise exception 'El producto agotado no conserva su ficha y su foto'; end if;
  result:=public.ao_suite_set_stock(restock,product,'PRUEBA STOCK SSD',2,0,400,'OTRO PROVEEDOR','2026-10-10');
  purchase:=(result->>'purchase_id')::bigint;
  if (select costo from public."COMPRAS" where id=purchase)<>800
    or (select count(*) from public."COMPONENTES" where compra_id=purchase)<>2
    or exists(select 1 from public."COMPONENTES" where compra_id=purchase and public.ao_component_cost(id)<>400)
    then raise exception 'La reposición no conserva la cantidad y el costo nuevo'; end if;
  if result<>public.ao_suite_set_stock(restock,product,'PRUEBA STOCK SSD',2,0,400,'OTRO PROVEEDOR','2026-10-10')
    or (select count(*) from public."COMPONENTES" where product_id=product)<>5
    then raise exception 'Reintentar la reposición duplicó unidades'; end if;
  perform public.ao_suite_delete_receipt(rid);
  if (select count(*) from public."COMPONENTES" where product_id=product and in_stock and precio_venta is null)<>3
    or (select count(*) from public."COMPONENTES" where product_id=product and not in_stock)<>2
    then raise exception 'Eliminar la boleta no restauró solo su unidad vendida'; end if;
  select value into entry from jsonb_array_elements(public.ao_catalog_snapshot()->'productos')
    where (value->>'id')::bigint=product;
  if entry->>'stock'<>'3' then raise exception 'La tienda no muestra las unidades disponibles actuales'; end if;
  select count(*) into before_purchases from public."COMPRAS";
  result:=public.ao_suite_create_product(gen_random_uuid(),jsonb_set(data,'{data,name}','"PRUEBA SIN STOCK"'),0,null,null,'2026-10-10');
  second_product:=(result->>'product_id')::bigint;
  if result->'purchase_id'<>'null'::jsonb or (select count(*) from public."COMPRAS")<>before_purchases
    or exists(select 1 from public."COMPONENTES" where product_id=second_product)
    then raise exception 'Un producto para reposición creó una compra inexistente'; end if;
  result:=public.ao_suite_create_purchase(purchase_req,
    '{"nombre":"PRUEBA COMPRA USD","costo":100,"moneda":"USD","tipo_cambio":3.75,"impuesto":10,"peso_kg":2,"costo_envio_kg":10,"tax_usa":5,"impuesto_peru":15,"otros_gastos":10,"numero_pedido":"QA-1","fecha_compra":"2026-10-10"}',5,null);
  purchase:=(result->>'purchase_id')::bigint;
  if (select count(*) from public."COMPONENTES" where compra_id=purchase)<>5
    or exists(select 1 from public."COMPONENTES" where compra_id=purchase and public.ao_component_cost(id)<>92.50)
    or (select numero_pedido from public."COMPRAS" where id=purchase)<>'QA-1'
    then raise exception 'La cantidad o el costo con cambio, impuestos y envío se perdió'; end if;
  if result<>public.ao_suite_create_purchase(purchase_req,
    '{"nombre":"PRUEBA COMPRA USD","costo":100,"moneda":"USD","tipo_cambio":3.75,"impuesto":10,"peso_kg":2,"costo_envio_kg":10,"tax_usa":5,"impuesto_peru":15,"otros_gastos":10,"numero_pedido":"QA-1","fecha_compra":"2026-10-10"}',5,null)
    then raise exception 'El reintento duplicó la compra'; end if;
  perform public.ao_suite_set_stock(gen_random_uuid(),null,'PRUEBA COMPRA USD',0,5,null,null,'2026-10-10');
  if exists(select 1 from public."COMPONENTES" where compra_id=purchase and in_stock)
    or exists(select 1 from public."COMPONENTES" where compra_id=purchase and public.ao_component_cost(id)<>92.50)
    then raise exception 'Corregir un producto sin vínculo alteró su costo'; end if;
  perform public.ao_suite_set_stock(gen_random_uuid(),null,'PRUEBA COMPRA USD',1,0,80,null,'2026-10-10');
  if (select count(*) from public."COMPONENTES" where nombre='PRUEBA COMPRA USD' and in_stock and precio_venta is null)<>1
    then raise exception 'No se puede reponer un producto sin vínculo al catálogo'; end if;
  select count(*) into before_products from public.ao_products;
  select count(*) into before_purchases from public."COMPRAS";
  select count(*) into before_units from public."COMPONENTES";
  select count(*) into before_ops from public.ao_stock_operations;
  rejected:=false;
  begin perform public.ao_suite_create_product(gen_random_uuid(),data,1,-1,null,'2026-10-10');
    exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'Se aceptó costo negativo'; end if;
  rejected:=false;
  begin perform public.ao_suite_create_purchase(gen_random_uuid(),'{"nombre":"INVÁLIDO","costo":50}',1001,null);
    exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'Se aceptó una cantidad fuera del límite'; end if;
  if (select count(*) from public.ao_products)<>before_products or (select count(*) from public."COMPRAS")<>before_purchases
    or (select count(*) from public."COMPONENTES")<>before_units or (select count(*) from public.ao_stock_operations)<>before_ops
    then raise exception 'Una operación inválida dejó datos parciales'; end if;
  rejected:=false;
  begin perform ao_private.register_purchase('{"nombre":"PRUEBA DIRECTA","costo":1}',1,null);
    exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'El helper interno permite llamadas directas'; end if;
end;
$$;
set local role anon;
do $$
declare rejected boolean:=false; entry jsonb;
begin
  begin perform public.ao_suite_create_product(gen_random_uuid(),'{}',0,null,null,null);
    exception when insufficient_privilege then rejected:=true;end;
  if not rejected then raise exception 'Una visita anónima puede agregar productos';end if;
  rejected:=false;
  begin perform * from public.ao_stock_operations;exception when insufficient_privilege then rejected:=true;end;
  if not rejected then raise exception 'Las operaciones de stock son públicas';end if;
  for entry in select value from jsonb_array_elements(public.ao_catalog_snapshot()->'productos') loop
    if entry?'cost' or entry?'cost_per_unit' or entry?'supplier' or entry?'customer'
      then raise exception 'La tienda expone datos privados';end if;
  end loop;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}',true);
do $$
declare rejected boolean:=false;
begin
  if exists(select 1 from public.ao_stock_operations) then raise exception 'Una cuenta ajena puede leer operaciones';end if;
  begin perform public.ao_suite_set_stock(gen_random_uuid(),null,'PRUEBA AJENA',1,0,1,null,null);
    exception when insufficient_privilege then rejected:=true;end;
  if not rejected then raise exception 'Una cuenta ajena puede modificar stock';end if;
  rejected:=false;
  begin perform public.ao_suite_create_purchase(gen_random_uuid(),'{"nombre":"PRUEBA AJENA","costo":1}',1,null);
    exception when insufficient_privilege then rejected:=true;end;
  if not rejected then raise exception 'Una cuenta ajena puede registrar compras';end if;
end;
$$;
rollback;
select true as stock_tests_passed;

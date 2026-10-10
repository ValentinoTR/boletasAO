begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true)
from public.ao_members where active and role='owner' limit 1;
set local role authenticated;
do $$
declare
 p bigint; c bigint; p2 bigint; c2 bigint; product bigint; rid uuid:=gen_random_uuid(); mixed uuid:=gen_random_uuid();
 receipt jsonb; r2 jsonb; result jsonb; n integer; rejected boolean;
 p3 bigint; c3 bigint; c4 bigint; multiple uuid:=gen_random_uuid();
 bundle jsonb; imported jsonb;
begin
 insert into public.ao_products(data,web_price,managed) values('{"name":"PRUEBA AO placa","category":"placa-am5"}',750,false) returning id into product;
 insert into public."COMPRAS"(nombre,costo) values('PRUEBA AO placa',600) returning id into p;
 insert into public."COMPONENTES"(compra_id,nombre,costo) values(p,'PRUEBA AO placa',600) returning id into c;
 perform public.ao_suite_link_stock(product,array[c],1);
 if (select (value->>'stock')::integer from jsonb_array_elements(public.ao_catalog_snapshot()->'productos') where (value->>'id')::bigint=product)<>1 then raise exception 'Stock inicial incorrecto'; end if;
 receipt:=jsonb_build_object('version',1,'series','QATEST','number','1','date','2026-10-10','customer','PRUEBA AO CLIENTE','docType','DNI','document','87654321','address','','email','cliente@example.com','observations','','items',jsonb_build_array(jsonb_build_object('description','Placa B850','serial','','code','','unit','NIU','quantity','1','price','700.00','inventory',jsonb_build_array(jsonb_build_object('source','stock','id',c,'name','PRUEBA AO placa','price','700.00')))));
 result:=public.ao_suite_issue_receipt(rid,receipt);
 if result->>'id'<>rid::text or (result->>'total_cents')::integer<>70000 then raise exception 'Boleta incorrecta'; end if;
 if (select sale_price-cost from public.ao_sale_items where receipt_id=rid)<>100 then raise exception 'Ganancia incorrecta'; end if;
 if (select comprador_documento from public."COMPONENTES" where id=c)<>'87654321' then raise exception 'Comprador no vinculado'; end if;
 if (select (value->>'stock')::integer from jsonb_array_elements(public.ao_catalog_snapshot()->'productos') where (value->>'id')::bigint=product)<>0 then raise exception 'Stock no descontado'; end if;
 perform public.ao_suite_issue_receipt(rid,receipt||'{"number":"999"}'::jsonb);
 if (select count(*) from public.ao_sales where receipt_id=rid)<>1 or (select count(*) from public.ao_sale_items where receipt_id=rid)<>1 then raise exception 'Venta duplicada'; end if;
 rejected:=false;
 begin perform public.ao_suite_issue_receipt(rid,receipt||'{"customer":"OTRO"}'::jsonb); exception when unique_violation then rejected:=true; end;
 if not rejected then raise exception 'Se permitió cambiar una boleta emitida'; end if;
 rejected:=false;
 begin perform public.ao_suite_issue_receipt(gen_random_uuid(),receipt); exception when raise_exception then if sqlerrm like '%ya se vendió%' then rejected:=true;else raise;end if; end;
 if not rejected then raise exception 'Se vendió dos veces la misma unidad'; end if;
 rejected:=false;
 begin update public."COMPONENTES" set precio_venta=800 where id=c; exception when raise_exception then if sqlerrm like '%boleta emitida%' then rejected:=true;else raise;end if; end;
 if not rejected then raise exception 'Se permitió alterar la venta emitida'; end if;
 rejected:=false;
 begin update public."COMPRAS" set costo=650 where id=p; exception when raise_exception then if sqlerrm like '%boletas emitidas%' then rejected:=true;else raise;end if; end;
 if not rejected then raise exception 'Se permitió alterar su costo histórico'; end if;
 insert into public."COMPRAS"(nombre,costo) values('PRUEBA AO Ryzen 9',1000) returning id into p2;
 insert into public."COMPONENTES"(compra_id,nombre) values(p2,'PRUEBA AO Ryzen 9') returning id into c2;
 r2:=jsonb_set(receipt,'{items}',jsonb_build_array(jsonb_build_object('description','Computadora completa','serial','','code','','unit','NIU','quantity','1','price','2100.00','inventory',jsonb_build_array(jsonb_build_object('source','stock','id',c2,'name','Ryzen 9','price','1200.00'),jsonb_build_object('source','external','name','GPU comprada para reventa','supplier','TIENDA DE PRUEBA','cost','800.00','price','900.00')))));
 perform public.ao_suite_issue_receipt(mixed,r2);
 if (select count(*) from public.ao_sale_items where receipt_id=mixed)<>2 or (select sum(sale_price-cost) from public.ao_sale_items where receipt_id=mixed)<>300 then raise exception 'PC mixta no conserva costos ni ganancia'; end if;
 if not exists(select 1 from public.ao_sale_items where receipt_id=mixed and cost_estimated) then raise exception 'Costo repartido no señalado'; end if;
 select count(*) into n from public."COMPRAS";
 rejected:=false;
 r2:=jsonb_set(receipt,'{items}',jsonb_build_array(jsonb_build_object('description','SSD externo','serial','','code','','unit','NIU','quantity','1','price','100.00','inventory',jsonb_build_array(jsonb_build_object('source','external','name','SSD PRUEBA INVALIDA','cost','50.00','price','90.00')))));
 begin perform public.ao_suite_issue_receipt(gen_random_uuid(),r2); exception when raise_exception then if sqlerrm like '%suma de los componentes%' then rejected:=true;else raise;end if; end;
 if not rejected or (select count(*) from public."COMPRAS")<>n then raise exception 'Una boleta inválida dejó una compra parcial'; end if;
 insert into public."COMPRAS"(nombre,costo) values('PRUEBA AO dos SSD',800) returning id into p3;
 insert into public."COMPONENTES"(compra_id,nombre,costo) values(p3,'SSD 1 TB',400) returning id into c3;
 insert into public."COMPONENTES"(compra_id,nombre,costo) values(p3,'SSD 1 TB',400) returning id into c4;
 r2:=jsonb_set(receipt,'{items}',jsonb_build_array(jsonb_build_object('description','Dos SSD 1 TB','serial','','code','','unit','NIU','quantity','2','price','450.25','inventoryMode','units','inventory',jsonb_build_array(jsonb_build_object('source','stock','id',c3,'price','450.25'),jsonb_build_object('source','stock','id',c4,'price','450.25')))));
 perform public.ao_suite_issue_receipt(multiple,r2);
 if (select total_cents from public.ao_receipts where id=multiple)<>90050 or (select sum(sale_price-cost) from public.ao_sale_items where receipt_id=multiple)<>100.50 then raise exception 'La cantidad o el precio unitario real no se respetó'; end if;
 r2:=jsonb_set(receipt,'{items}',jsonb_build_array(jsonb_build_object('description','Cantidad incorrecta','serial','','code','','unit','NIU','quantity','2','price','100.00','inventoryMode','units','inventory',jsonb_build_array(jsonb_build_object('source','external','name','SSD PRUEBA CANTIDAD','cost','50.00','price','200.00')))));
 rejected:=false;
 begin perform public.ao_suite_issue_receipt(gen_random_uuid(),r2); exception when raise_exception then if sqlerrm like '%una unidad de stock por cada unidad%' then rejected:=true;else raise;end if; end;
 if not rejected then raise exception 'Una cantidad incorrecta fue aceptada'; end if;
 r2:=jsonb_set(r2,'{items,0,inventoryMode}','"bundle"');
 rejected:=false;
 begin perform public.ao_suite_issue_receipt(gen_random_uuid(),r2); exception when raise_exception then if sqlerrm like '%grupo de componentes%' then rejected:=true;else raise;end if; end;
 if not rejected then raise exception 'Se aceptaron dos computadoras con un solo conjunto de componentes'; end if;
 bundle:='{"source":"rqoxzaszzvwxpvomfvay","compras":[{"id":"qa-import","nombre":"PRUEBA IMPORTACIÓN","costo":600,"moneda":"PEN"}],"componentes":[{"id":"qa-unit","compra_id":"qa-import","nombre":"PRUEBA UNIDAD","costo":600,"precio_venta":700,"comprador_nombre":"PRUEBA CLIENTE ANTERIOR","comprador_documento":"12345678"}]}'::jsonb;
 imported:=public.ao_suite_import_accounting(bundle);
 if imported->>'compras'<>'1' or imported->>'componentes'<>'1' then raise exception 'Importación no incorporó los registros'; end if;
 imported:=public.ao_suite_import_accounting(bundle);
 if imported->>'compras'<>'0' or imported->>'componentes'<>'0' then raise exception 'Importación duplicada'; end if;
end;
$$;
set local role anon;
do $$
declare rejected boolean:=false; entry jsonb;
begin
 for entry in select value from jsonb_array_elements(public.ao_catalog_snapshot()->'productos') loop
  if entry?'cost' or entry?'costo' or entry?'client' or entry?'customer' or entry?'email' then raise exception 'Catálogo expone información privada'; end if;
 end loop;
 begin perform * from public.ao_clients; exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Cliente accesible públicamente'; end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}',true);
do $$
declare rejected boolean:=false;
begin
 if exists(select 1 from public."COMPRAS") then raise exception 'Cuenta ajena puede leer compras'; end if;
 begin perform public.ao_suite_issue_receipt(gen_random_uuid(),'{}'); exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Cuenta ajena puede emitir boleta'; end if;
end;
$$;
rollback;
select true as transaction_tests_passed;

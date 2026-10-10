-- Stock corrections preserve purchases, sold units and product references.
alter table public."COMPONENTES" add column in_stock boolean not null default true;
create table public.ao_stock_operations (
  request_id uuid primary key,
  product_id bigint references public.ao_products(id),
  created_by uuid not null references auth.users(id),
  signature jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.ao_stock_operations enable row level security;
revoke all on public.ao_stock_operations from public,anon,authenticated;
grant select on public.ao_stock_operations to authenticated;
create policy ao_stock_operations_team_read on public.ao_stock_operations for select to authenticated using((select ao_private.is_member()));
create index ao_stock_operations_product_idx on public.ao_stock_operations(product_id);
create index ao_stock_operations_created_by_idx on public.ao_stock_operations(created_by);

create function ao_private.register_purchase(details jsonb,quantity integer,product_key bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare p public."COMPRAS"%rowtype; purchase_id bigint;
begin
  if not ao_private.is_member() then raise exception 'Acceso no autorizado.' using errcode='42501'; end if;
  if quantity is null or quantity not between 0 and 1000 or jsonb_typeof(details) is distinct from 'object' then raise exception 'Indica una cantidad entre 0 y 1000.'; end if;
  p:=jsonb_populate_record(null::public."COMPRAS",details);
  if p.costo is null or p.costo<0 or p.costo>999999999.99 or length(trim(coalesce(p.nombre,''))) not between 1 and 350 then raise exception 'Revisa el producto y el costo total de la compra.'; end if;
  if coalesce(p.moneda,'PEN')='USD' and coalesce(p.tipo_cambio,0)<=0 then raise exception 'Indica el tipo de cambio para la compra en dólares.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ao_stock_group_'||coalesce(product_key::text,lower(trim(p.nombre))),0));
  if product_key is not null then
    perform id from public.ao_products where id=product_key for update;
    if not found then raise exception 'El producto no existe.'; end if;
  end if;
  insert into public."COMPRAS"(nombre,costo,moneda,tipo_cambio,impuesto,proveedor,fecha_compra,numero_pedido,courier,peso_kg,costo_envio_kg,tax_usa,impuesto_peru,otros_gastos,categoria,created_by)
    values(trim(p.nombre),p.costo,coalesce(p.moneda,'PEN'),coalesce(p.tipo_cambio,0),coalesce(p.impuesto,0),p.proveedor,p.fecha_compra,p.numero_pedido,p.courier,coalesce(p.peso_kg,0),coalesce(p.costo_envio_kg,0),coalesce(p.tax_usa,0),coalesce(p.impuesto_peru,0),coalesce(p.otros_gastos,0),p.categoria,auth.uid()) returning id into purchase_id;
  insert into public."COMPONENTES"(compra_id,nombre,product_id)
    select purchase_id,trim(p.nombre),product_key from generate_series(1,quantity);
  if product_key is not null and quantity>0 then
    update public.ao_products set managed=true,reference_stock=0,updated_at=now() where id=product_key;
  end if;
  return purchase_id;
end;
$$;
revoke all on function ao_private.register_purchase(jsonb,integer,bigint) from public,anon,authenticated;

create function ao_private.create_purchase(request_key uuid,purchase_data jsonb,quantity integer,product_key bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sig jsonb:=jsonb_build_object('kind','purchase','data',purchase_data,'quantity',quantity,'product',product_key);
  prior public.ao_stock_operations%rowtype; result jsonb; purchase_id bigint;
begin
  if not ao_private.is_member() then raise exception 'Acceso no autorizado.' using errcode='42501'; end if;
  if request_key is null then raise exception 'Identificador de compra inválido.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ao_stock_request_'||request_key::text,0));
  select * into prior from public.ao_stock_operations where request_id=request_key;
  if found then
    if prior.signature<>sig then raise exception 'La compra ya fue registrada con otros datos.' using errcode='23505';end if;
    return prior.result;
  end if;
  purchase_id:=ao_private.register_purchase(purchase_data,quantity,product_key);
  result:=jsonb_build_object('purchase_id',purchase_id,'quantity',quantity,'product_id',product_key);
  insert into public.ao_stock_operations(request_id,product_id,created_by,signature,result) values(request_key,product_key,auth.uid(),sig,result);
  return result;
end;
$$;
revoke all on function ao_private.create_purchase(uuid,jsonb,integer,bigint) from public,anon;
grant execute on function ao_private.create_purchase(uuid,jsonb,integer,bigint) to authenticated;
create function public.ao_suite_create_purchase(request_key uuid,purchase_data jsonb,quantity integer,product_key bigint)
returns jsonb language sql security invoker set search_path='' as $$select ao_private.create_purchase(request_key,purchase_data,quantity,product_key);$$;
revoke all on function public.ao_suite_create_purchase(uuid,jsonb,integer,bigint) from public,anon;
grant execute on function public.ao_suite_create_purchase(uuid,jsonb,integer,bigint) to authenticated;

create function ao_private.create_product(request_key uuid,product_data jsonb,quantity integer,cost_per_unit numeric,supplier text,purchased_on date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sig jsonb:=jsonb_build_object('kind','product','data',product_data-'updated_at','quantity',quantity,'cost',cost_per_unit,'supplier',supplier,'date',purchased_on);
  prior public.ao_stock_operations%rowtype; product_key bigint; purchase_id bigint; result jsonb;
begin
  if not ao_private.is_member() then raise exception 'Acceso no autorizado.' using errcode='42501'; end if;
  if request_key is null or quantity is null or quantity not between 0 and 1000 then raise exception 'Indica una cantidad entre 0 y 1000.';end if;
  if quantity>0 and (cost_per_unit is null or cost_per_unit<0 or cost_per_unit<>round(cost_per_unit,2)) then raise exception 'Indica el costo de compra por unidad con hasta dos decimales.';end if;
  if jsonb_typeof(product_data->'data') is distinct from 'object' or length(trim(coalesce(product_data#>>'{data,name}',''))) not between 1 and 350
    or length(coalesce(product_data#>>'{data,category}','')) not between 1 and 80 or octet_length(product_data::text)>50000 then raise exception 'Revisa los datos del producto.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ao_stock_request_'||request_key::text,0));
  select * into prior from public.ao_stock_operations where request_id=request_key;
  if found then
    if prior.signature<>sig then raise exception 'El producto ya fue registrado con otros datos.' using errcode='23505';end if;
    return prior.result;
  end if;
  insert into public.ao_products(data,web_price,published,managed,reference_stock)
    values(product_data->'data',(product_data->>'web_price')::numeric,coalesce((product_data->>'published')::boolean,true),true,0) returning id into product_key;
  if quantity>0 then purchase_id:=ao_private.register_purchase(jsonb_build_object('nombre',product_data#>>'{data,name}',
    'costo',quantity*cost_per_unit,'proveedor',supplier,'fecha_compra',purchased_on),quantity,product_key); end if;
  result:=jsonb_build_object('product_id',product_key,'quantity',quantity,'purchase_id',purchase_id);
  insert into public.ao_stock_operations(request_id,product_id,created_by,signature,result) values(request_key,product_key,auth.uid(),sig,result);
  return result;
end;
$$;
revoke all on function ao_private.create_product(uuid,jsonb,integer,numeric,text,date) from public,anon;
grant execute on function ao_private.create_product(uuid,jsonb,integer,numeric,text,date) to authenticated;
create function public.ao_suite_create_product(request_key uuid,product_data jsonb,quantity integer,cost_per_unit numeric,supplier text,purchased_on date)
returns jsonb language sql security invoker set search_path='' as $$select ao_private.create_product(request_key,product_data,quantity,cost_per_unit,supplier,purchased_on);$$;
revoke all on function public.ao_suite_create_product(uuid,jsonb,integer,numeric,text,date) from public,anon;
grant execute on function public.ao_suite_create_product(uuid,jsonb,integer,numeric,text,date) to authenticated;

create function ao_private.set_stock(request_key uuid,product_key bigint,product_name text,target_quantity integer,expected_quantity integer,cost_per_unit numeric,supplier text,purchased_on date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sig jsonb:=jsonb_build_object('kind','stock','product',product_key,'name',product_name,'target',target_quantity,'expected',expected_quantity,'cost',cost_per_unit,'supplier',supplier,'date',purchased_on);
  prior public.ao_stock_operations%rowtype; ids bigint[]; current_quantity integer; delta integer;
  purchase_id bigint; result jsonb; unit_ids bigint[];
begin
  if not ao_private.is_member() then raise exception 'Acceso no autorizado.' using errcode='42501';end if;
  if request_key is null or target_quantity is null or target_quantity not between 0 and 100000 or expected_quantity is null
    or length(trim(coalesce(product_name,''))) not between 1 and 350 then raise exception 'Revisa el producto y la cantidad de stock.';end if;
  perform pg_advisory_xact_lock(hashtextextended('ao_stock_request_'||request_key::text,0));
  select * into prior from public.ao_stock_operations where request_id=request_key;
  if found then
    if prior.signature<>sig then raise exception 'La corrección ya se guardó con otros datos.' using errcode='23505';end if;
    return prior.result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ao_stock_group_'||coalesce(product_key::text,lower(trim(product_name))),0));
  if product_key is not null then
    select data->>'name' into product_name from public.ao_products where id=product_key for update;
    if not found then raise exception 'El producto no existe.';end if;
  end if;
  select coalesce(array_agg(id),'{}'::bigint[]) into ids from public."COMPONENTES"
    where product_id=product_key or (product_key is null and product_id is null and lower(trim(nombre))=lower(trim(product_name)));
  perform p.id from public."COMPRAS" p where p.id in(select c.compra_id from public."COMPONENTES" c where c.id=any(ids)) order by p.id for update;
  perform c.id from public."COMPONENTES" c where c.id=any(ids) order by c.id for update;
  select count(*) into current_quantity from public."COMPONENTES" where id=any(ids) and precio_venta is null and in_stock;
  if current_quantity<>expected_quantity then raise exception 'El stock cambió mientras editabas. Actualiza los datos e inténtalo de nuevo.';end if;
  delta:=target_quantity-current_quantity;
  if delta>1000 then raise exception 'Registra hasta 1000 unidades nuevas por compra.';end if;
  if delta>0 then
    if cost_per_unit is null or cost_per_unit<0 or cost_per_unit<>round(cost_per_unit,2) then raise exception 'Indica el costo de compra de las unidades nuevas.';end if;
    purchase_id:=ao_private.register_purchase(jsonb_build_object('nombre',product_name,'costo',delta*cost_per_unit,'proveedor',supplier,'fecha_compra',purchased_on),delta,product_key);
  elsif delta<0 then
    select array_agg(id) into unit_ids from (select id from public."COMPONENTES" where id=any(ids) and precio_venta is null and in_stock order by id desc limit -delta)s;
    update public."COMPONENTES" set in_stock=false where id=any(unit_ids);
  end if;
  if product_key is not null then update public.ao_products set managed=true,reference_stock=0,updated_at=now() where id=product_key;end if;
  result:=jsonb_build_object('product_id',product_key,'quantity',target_quantity,'change',delta,'purchase_id',purchase_id,'retired_units',unit_ids);
  insert into public.ao_stock_operations(request_id,product_id,created_by,signature,result) values(request_key,product_key,auth.uid(),sig,result);
  return result;
end;
$$;
revoke all on function ao_private.set_stock(uuid,bigint,text,integer,integer,numeric,text,date) from public,anon;
grant execute on function ao_private.set_stock(uuid,bigint,text,integer,integer,numeric,text,date) to authenticated;
create function public.ao_suite_set_stock(request_key uuid,product_key bigint,product_name text,target_quantity integer,expected_quantity integer,cost_per_unit numeric,supplier text,purchased_on date)
returns jsonb language sql security invoker set search_path='' as $$select ao_private.set_stock(request_key,product_key,product_name,target_quantity,expected_quantity,cost_per_unit,supplier,purchased_on);$$;
revoke all on function public.ao_suite_set_stock(uuid,bigint,text,integer,integer,numeric,text,date) from public,anon;
grant execute on function public.ao_suite_set_stock(uuid,bigint,text,integer,integer,numeric,text,date) to authenticated;

-- Updated availability checks
create or replace function ao_private.catalog_snapshot() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('actualizado',coalesce(max(p.updated_at),now()),'productos',
   coalesce(jsonb_agg(jsonb_build_object(
     'id',p.id,'name',p.data->>'name','brand',p.data->>'brand','category',p.data->>'category',
     'price',p.web_price,'stock',case when p.managed then (select count(*) from public."COMPONENTES" c where c.product_id=p.id and c.precio_venta is null and c.in_stock) else p.reference_stock end,
     'oldPrice',p.data->'oldPrice','featured',p.data->'featured','best',p.data->'best',
     'sub',p.data->>'sub','image',p.data->>'image','specs',coalesce(p.data->'specs','{}'::jsonb)) order by p.id),'[]'::jsonb))
 from public.ao_products p where p.published;
$$;

create or replace function ao_private.suite_issue(request_id uuid,receipt jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  prior public.ao_sales%rowtype; saved jsonb; item jsonb; part jsonb; line_i integer:=0;
  signature_value jsonb:=receipt-'number'; unit public."COMPONENTES"%rowtype;
  ids bigint[]:='{}'; seen bigint[]:='{}'; cid bigint; purchase bigint;
  v_sale numeric; v_cost numeric; subtotal numeric; line_total numeric;
  plan jsonb:='[]'::jsonb; v_client uuid; v_doc text; v_doc_type text; v_estimated boolean;
  unit_count integer:=0;
begin
  if not ao_private.is_member() then raise exception 'Acceso no autorizado.' using errcode='42501'; end if;
  if request_id is null or jsonb_typeof(receipt) is distinct from 'object'
    or jsonb_typeof(receipt->'items') is distinct from 'array' then raise exception 'Boleta inválida.'; end if;
  if jsonb_array_length(receipt->'items') not between 1 and 100 then raise exception 'Incluye entre 1 y 100 productos.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ao_suite_'||request_id::text,0));
  select * into prior from public.ao_sales where receipt_id=request_id;
  if found then
    if prior.signature<>signature_value then raise exception 'La venta ya está guardada con otros datos.' using errcode='23505'; end if;
    select jsonb_build_object('id',r.id,'payload',r.payload,'total_cents',r.total_cents) into saved from public.ao_receipts r where r.id=request_id;
    return saved;
  end if;
  if exists(select 1 from public.ao_receipts where id=request_id) then raise exception 'Ese identificador pertenece a otra boleta.'; end if;
  -- Lock explicitly selected physical units in a consistent order.
  for item in select value from jsonb_array_elements(receipt->'items') loop
    if jsonb_typeof(item->'inventory') is distinct from 'array' or jsonb_array_length(item->'inventory') not between 1 and 500 then
      raise exception 'Selecciona el stock o registra la compra externa de cada producto.';
    end if;
    for part in select value from jsonb_array_elements(item->'inventory') loop
      unit_count:=unit_count+1;
      if unit_count>500 then raise exception 'La venta contiene demasiadas unidades.'; end if;
      if part->>'source'='stock' then
        if coalesce(part->>'id','') !~ '^[0-9]{1,16}$' then raise exception 'Unidad de stock inválida.'; end if;
        ids:=array_append(ids,(part->>'id')::bigint);
      elsif part->>'source' is distinct from 'external' then raise exception 'Origen del producto inválido.'; end if;
    end loop;
  end loop;
  if coalesce(array_length(ids,1),0)>500 then raise exception 'La venta contiene demasiadas unidades.'; end if;
  perform p.id from public."COMPRAS" p where p.id in(select c.compra_id from public."COMPONENTES" c where c.id=any(ids)) order by p.id for update;
  perform c.id from public."COMPONENTES" c where c.id=any(ids) order by c.id for update;
  for item in select value from jsonb_array_elements(receipt->'items') loop
    if coalesce(item->>'price','') !~ '^[0-9]{1,9}([.,][0-9]{1,2})?$' or coalesce(item->>'quantity','') !~ '^[0-9]{1,4}$' or (item->>'quantity')::integer<1 then
      raise exception 'Revisa la cantidad y el precio de cada producto de la boleta.';
    end if;
    line_total:=replace(item->>'price',',','.')::numeric*(item->>'quantity')::integer;
    if item->>'inventoryMode' is not null and item->>'inventoryMode' not in ('units','bundle') then
      raise exception 'Tipo de detalle de venta inválido.';
    end if;
    if item->>'inventoryMode'='bundle' and (item->>'quantity')::integer<>1 then
      raise exception 'Cada grupo de componentes corresponde a una computadora.';
    end if;
    if (item->>'inventoryMode'='units' or (item->>'inventoryMode' is null and (item->>'quantity')::integer>1))
      and jsonb_array_length(item->'inventory')<>(item->>'quantity')::integer then
      raise exception 'Selecciona una unidad de stock por cada unidad vendida.';
    end if;
    subtotal:=0;
    for part in select value from jsonb_array_elements(item->'inventory') loop
      if coalesce(part->>'price','') !~ '^[0-9]{1,9}([.,][0-9]{1,2})?$' then raise exception 'Revisa el precio de venta de cada componente.'; end if;
      v_sale:=replace(part->>'price',',','.')::numeric;
      if part->>'source'='stock' then
        cid:=(part->>'id')::bigint;
        if cid=any(seen) then raise exception 'Una unidad de stock aparece dos veces en la misma venta.'; end if;
        select * into unit from public."COMPONENTES" where id=cid;
        if not found or unit.precio_venta is not null or not unit.in_stock then raise exception 'Una unidad seleccionada ya se vendió o no existe.'; end if;
        select public.ao_component_cost(cid) into v_cost;
        v_estimated:=unit.costo is null;
      else
        if coalesce(part->>'cost','') !~ '^[0-9]{1,9}([.,][0-9]{1,2})?$' or length(trim(coalesce(part->>'name',''))) not between 1 and 350 or length(coalesce(part->>'supplier',''))>150 then
          raise exception 'Indica el producto y su costo real de compra externa.';
        end if;
        v_cost:=replace(part->>'cost',',','.')::numeric; v_estimated:=false;
        insert into public."COMPRAS"(nombre,costo,proveedor,fecha_compra,created_by)
          values(trim(part->>'name'),v_cost,nullif(trim(part->>'supplier'),''),(receipt->>'date')::date,auth.uid()) returning id into purchase;
        insert into public."COMPONENTES"(compra_id,nombre,costo,serial)
          values(purchase,trim(part->>'name'),v_cost,nullif(trim(part->>'serial'),'')) returning id into cid;
      end if;
      seen:=array_append(seen,cid);
      plan:=plan||jsonb_build_array(jsonb_build_object('id',cid,'line',line_i,'price',v_sale,'cost',v_cost,'estimated',v_estimated));
      subtotal:=subtotal+v_sale;
    end loop;
    if subtotal<>line_total then raise exception 'La suma de los componentes debe coincidir con el importe de su línea en la boleta.'; end if;
    line_i:=line_i+1;
  end loop;
  -- The existing validated receipt allocator keeps numbering and PDF history.
  saved:=ao_private.issue_receipt(request_id,receipt);
  v_doc:=trim(receipt->>'document'); v_doc_type:=receipt->>'docType';
  if v_doc_type='NONE' then v_doc:=''; end if;
  if v_doc<>'' then
    insert into public.ao_clients(name,doc_type,document,email,address)
      values(trim(receipt->>'customer'),v_doc_type,v_doc,nullif(trim(receipt->>'email'),''),nullif(trim(receipt->>'address'),''))
      on conflict(doc_type,document) where document<>'' do update set name=excluded.name,email=excluded.email,address=excluded.address,updated_at=now() returning id into v_client;
  else
    insert into public.ao_clients(name,doc_type,document,email,address)
      values(trim(receipt->>'customer'),v_doc_type,'',nullif(trim(receipt->>'email'),''),nullif(trim(receipt->>'address'),'')) returning id into v_client;
  end if;
  insert into public.ao_sales(receipt_id,client_id,signature) values(request_id,v_client,signature_value);
  for part in select value from jsonb_array_elements(plan) loop
    insert into public.ao_sale_items(receipt_id,component_id,line_index,sale_price,cost,cost_estimated)
      values(request_id,(part->>'id')::bigint,(part->>'line')::integer,(part->>'price')::numeric,(part->>'cost')::numeric,(part->>'estimated')::boolean);
    update public."COMPONENTES" set precio_venta=(part->>'price')::numeric,sale_cost=(part->>'cost')::numeric,
      fecha_venta=((receipt->>'date')||'T12:00:00-05:00')::timestamptz,comprador_nombre=trim(receipt->>'customer'),
      comprador_documento=nullif(v_doc,''),receipt_id=request_id where id=(part->>'id')::bigint;
  end loop;
  return saved;
end;
$$;

create or replace function ao_private.link_stock(product_key bigint,unit_keys bigint[],expected_stock integer) returns integer language plpgsql security definer set search_path='' as $$
declare actual integer;
begin
 if not ao_private.is_member() then raise exception 'Acceso no autorizado.' using errcode='42501'; end if;
 perform id from public.ao_products where id=product_key for update;
 if not found then raise exception 'Producto inexistente.'; end if;
 if coalesce(array_length(unit_keys,1),0)>10000 then raise exception 'Demasiadas unidades.'; end if;
 perform c.id from public."COMPONENTES" c where c.id=any(unit_keys) order by c.id for update;
 if exists(select 1 from public."COMPONENTES" where id=any(unit_keys) and (precio_venta is not null or not in_stock or (product_id is not null and product_id<>product_key))) then raise exception 'Selecciona unidades disponibles que no estén vinculadas a otro producto.'; end if;
 if (select count(*) from public."COMPONENTES" where id=any(unit_keys))<>(select count(distinct x) from unnest(unit_keys) x) then raise exception 'Una unidad seleccionada ya no existe.'; end if;
 update public."COMPONENTES" set product_id=product_key where id=any(unit_keys);
 select count(*) into actual from public."COMPONENTES" where product_id=product_key and precio_venta is null and in_stock;
 if actual<>expected_stock then raise exception 'El stock cambió durante la vinculación. Revisa las unidades antes de confirmar.'; end if;
 update public.ao_products set managed=true,updated_at=now() where id=product_key;
 return actual;
end;
$$;

notify pgrst,'reload schema';

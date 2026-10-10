CREATE OR REPLACE FUNCTION ao_private.issue_receipt(request_id uuid, receipt jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_data jsonb; v_series text; v_date date; v_number bigint; v_existing public.ao_receipts%rowtype;
  v_items jsonb := '[]'::jsonb; v_item jsonb; v_qty bigint; v_price numeric; v_total bigint := 0;
  v_key text; v_limit integer; v_text text;
begin
  if not ao_private.is_member() then raise exception 'Acceso no autorizado.' using errcode='42501'; end if;
  if request_id is null or jsonb_typeof(receipt) <> 'object' or receipt->>'version' is distinct from '1'
    or jsonb_typeof(receipt->'items') is distinct from 'array' then raise exception 'Boleta inválida.'; end if;
  if jsonb_array_length(receipt->'items') not between 1 and 100 then raise exception 'Incluye entre 1 y 100 productos.'; end if;
  for v_key, v_limit in select * from (values ('series',8),('customer',110),('docType',4),('document',20),('address',160),('email',254),('observations',800)) x(k,n) loop
    if jsonb_typeof(receipt->v_key) is distinct from 'string' or length(receipt->>v_key) > v_limit then raise exception 'Datos de la boleta inválidos.'; end if;
    if v_key <> 'observations' and (receipt->>v_key) ~ '[[:cntrl:]]' then raise exception 'Retira los caracteres de control.'; end if;
  end loop;
  v_series := upper(trim(receipt->>'series'));
  if v_series !~ '^[A-Z0-9]{1,8}$' or length(trim(receipt->>'customer')) = 0 then raise exception 'Completa la serie y el cliente.'; end if;
  if coalesce(receipt->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Fecha inválida.'; end if;
  v_date := (receipt->>'date')::date;
  if receipt->>'docType' not in ('DNI','RUC','CE','PAS','NONE') then raise exception 'Tipo de documento inválido.'; end if;
  if (receipt->>'docType' = 'DNI' and receipt->>'document' !~ '^[0-9]{8}$')
    or (receipt->>'docType' = 'RUC' and receipt->>'document' !~ '^[0-9]{11}$')
    or (receipt->>'docType' in ('CE','PAS') and length(trim(receipt->>'document')) = 0) then raise exception 'Revisa el documento del cliente.'; end if;
  if length(trim(receipt->>'email')) > 0 and (receipt->>'email') !~ '^[^[:space:]<>@,;:]+@[^[:space:]<>@,;:]+\.[^[:space:]<>@,;:]+$' then raise exception 'Correo inválido.'; end if;
  for v_item in select value from jsonb_array_elements(receipt->'items') loop
    if jsonb_typeof(v_item) is distinct from 'object' then raise exception 'Producto inválido.'; end if;
    for v_key, v_limit in select * from (values ('description',350),('serial',140),('code',22),('unit',5),('quantity',4),('price',12)) x(k,n) loop
      if jsonb_typeof(v_item->v_key) is distinct from 'string' or length(v_item->>v_key) > v_limit or (v_item->>v_key) ~ '[[:cntrl:]]' then raise exception 'Datos del producto inválidos.'; end if;
    end loop;
    if length(trim(v_item->>'description')) = 0 or length(trim(v_item->>'unit')) = 0
      or v_item->>'quantity' !~ '^[0-9]{1,4}$' or v_item->>'price' !~ '^[0-9]{1,9}([.,][0-9]{1,2})?$' then raise exception 'Revisa la cantidad y el precio de cada producto.'; end if;
    v_qty := (v_item->>'quantity')::bigint;
    if v_qty = 0 then raise exception 'La cantidad debe ser mayor que cero.'; end if;
    v_price := replace(v_item->>'price',',','.')::numeric * 100;
    v_total := v_total + (v_price * v_qty)::bigint;
    if v_total > 99999999999 then raise exception 'El importe total excede el máximo permitido.'; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('description',trim(v_item->>'description'),'serial',trim(v_item->>'serial'),'code',trim(v_item->>'code'),'unit',trim(v_item->>'unit'),'quantity',trim(v_item->>'quantity'),'price',trim(v_item->>'price')));
  end loop;
  v_data := jsonb_build_object('version',1,'series',v_series,'date',v_date::text,'customer',trim(receipt->>'customer'),'docType',receipt->>'docType','document',trim(receipt->>'document'),'address',trim(receipt->>'address'),'email',trim(receipt->>'email'),'observations',receipt->>'observations','items',v_items);
  perform pg_advisory_xact_lock(hashtextextended('ao_receipt_' || v_series,0));
  select * into v_existing from public.ao_receipts r where r.id = request_id;
  if found then
    if v_existing.deleted_at is not null then raise exception 'Esta boleta fue eliminada. Crea una boleta nueva con los datos correctos.'; end if;
    if v_existing.payload - 'number' <> v_data then raise exception 'El identificador ya corresponde a otra boleta.' using errcode='23505'; end if;
    return jsonb_build_object('id',v_existing.id,'payload',v_existing.payload,'total_cents',v_existing.total_cents);
  end if;
  insert into ao_private.sequences(series,next_number) values(v_series,case when v_series='B001' then 110 else 1 end) on conflict do nothing;
  select next_number into v_number from ao_private.sequences where series = v_series for update;
  if v_number > 9999999999 then raise exception 'La numeración de esta serie se agotó.'; end if;
  v_data := v_data || jsonb_build_object('number',v_number::text);
  insert into public.ao_receipts(id,series,number,date,customer,total_cents,payload,created_by)
    values(request_id,v_series,v_number::text,v_date,v_data->>'customer',v_total,v_data,auth.uid());
  update ao_private.sequences set next_number=v_number+1 where series=v_series;
  return jsonb_build_object('id',request_id,'payload',v_data,'total_cents',v_total);
end;
$function$

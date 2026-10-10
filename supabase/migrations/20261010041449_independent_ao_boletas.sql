-- AO Nexus: datos compartidos solo entre miembros activos del negocio.
create schema if not exists ao_private;
revoke all on schema ao_private from public, anon, authenticated;
grant usage on schema ao_private to authenticated, service_role;

create table public.ao_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80),
  role text not null default 'member' check (role in ('owner','member')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.ao_receipts (
  id uuid primary key,
  series text not null check (series ~ '^[A-Z0-9]{1,8}$'),
  number text not null check (number ~ '^[0-9]{1,10}$' and number::bigint > 0),
  date date not null,
  customer text not null check (length(customer) between 1 and 110),
  total_cents bigint not null check (total_cents between 0 and 99999999999),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  pdf_path text check (pdf_path is null or pdf_path = 'receipts/' || id::text || '.pdf'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(series,number)
);
create index ao_receipts_created_at_idx on public.ao_receipts(created_at desc);
create index ao_receipts_created_by_idx on public.ao_receipts(created_by);
create table public.ao_deliveries (
  id uuid primary key,
  receipt_id uuid not null references public.ao_receipts(id),
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('pending','sent','failed','unknown')),
  initiated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create index ao_deliveries_receipt_id_idx on public.ao_deliveries(receipt_id);
create index ao_deliveries_initiated_by_idx on public.ao_deliveries(initiated_by);
create table ao_private.settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table ao_private.sequences (series text primary key, next_number bigint not null check (next_number between 1 and 10000000000));
alter table public.ao_members enable row level security;
alter table public.ao_receipts enable row level security;
alter table public.ao_deliveries enable row level security;
alter table ao_private.settings enable row level security;
alter table ao_private.sequences enable row level security;
revoke all on public.ao_members, public.ao_receipts, public.ao_deliveries from public, anon, authenticated;
revoke all on ao_private.settings, ao_private.sequences from public, anon, authenticated;
grant select on public.ao_members, public.ao_receipts, public.ao_deliveries to authenticated;
grant update(pdf_path) on public.ao_receipts to authenticated;
grant all on public.ao_members, public.ao_receipts, public.ao_deliveries, ao_private.settings, ao_private.sequences to service_role;

-- Privilegios elevados limitados al esquema privado y a una comprobación de membresía.
create function ao_private.is_member() returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    and exists (select 1 from public.ao_members m where m.user_id = auth.uid() and m.active);
$$;
revoke all on function ao_private.is_member() from public, anon;
grant execute on function ao_private.is_member() to authenticated, service_role;
create policy ao_members_team_read on public.ao_members for select to authenticated using ((select ao_private.is_member()));
create policy ao_receipts_team_read on public.ao_receipts for select to authenticated using ((select ao_private.is_member()));
create policy ao_receipts_pdf_update on public.ao_receipts for update to authenticated using ((select ao_private.is_member())) with check ((select ao_private.is_member()));
create policy ao_deliveries_team_read on public.ao_deliveries for select to authenticated using ((select ao_private.is_member()));

create function ao_private.next_number(series_name text) returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_series text := upper(trim(series_name)); v_number bigint;
begin
  if not ao_private.is_member() then raise exception 'Acceso no autorizado.' using errcode='42501'; end if;
  if v_series is null or v_series !~ '^[A-Z0-9]{1,8}$' then raise exception 'Serie inválida.'; end if;
  select next_number into v_number from ao_private.sequences where series = v_series;
  return coalesce(v_number,case when v_series = 'B001' then 110 else 1 end);
end;
$$;
revoke all on function ao_private.next_number(text) from public, anon;
grant execute on function ao_private.next_number(text) to authenticated;
create function public.ao_next_number(series_name text) returns bigint language sql stable security invoker set search_path = '' as $$ select ao_private.next_number(series_name); $$;
revoke all on function public.ao_next_number(text) from public, anon;
grant execute on function public.ao_next_number(text) to authenticated;

create function ao_private.issue_receipt(request_id uuid, receipt jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function ao_private.issue_receipt(uuid,jsonb) from public, anon;
grant execute on function ao_private.issue_receipt(uuid,jsonb) to authenticated;
create function public.ao_issue_receipt(request_id uuid, receipt jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select ao_private.issue_receipt(request_id,receipt); $$;
revoke all on function public.ao_issue_receipt(uuid,jsonb) from public, anon;
grant execute on function public.ao_issue_receipt(uuid,jsonb) to authenticated;

-- APIs de servidor: SECURITY INVOKER y ejecución únicamente por service_role.
create function public.ao_server_read(config_key text) returns jsonb language sql stable security invoker set search_path = '' as $$ select value from ao_private.settings where key=config_key; $$;
create function public.ao_server_write(config_key text, config_value jsonb) returns void language sql security invoker set search_path = '' as $$
  insert into ao_private.settings(key,value,updated_at) values(config_key,config_value,now()) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
$$;
create function public.ao_server_claim_activation(expected_hash text) returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed integer;
begin
  update ao_private.settings set value=value || jsonb_build_object('state','in_progress'), updated_at=now()
    where key='activation' and value->>'hash'=expected_hash and value->>'state'='ready' and (value->>'expiresAt')::timestamptz > now();
  get diagnostics claimed = row_count;
  return claimed=1;
end;
$$;
create function public.ao_server_finish_activation(owner_id uuid, owner_name text) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from ao_private.settings where key='activation' and value->>'state'='in_progress') then raise exception 'Activación no disponible.'; end if;
  if not exists(select 1 from auth.users where id=owner_id and lower(email)='aonexuspe@gmail.com') then raise exception 'Cuenta administradora inválida.'; end if;
  insert into public.ao_members(user_id,display_name,role) values(owner_id,owner_name,'owner');
  update ao_private.settings set value=jsonb_build_object('state','consumed'),updated_at=now() where key='activation';
end;
$$;
create function public.ao_server_set_number(series_name text, next_value bigint) returns void language plpgsql security invoker set search_path = '' as $$
declare max_number bigint;
begin
  if series_name !~ '^[A-Z0-9]{1,8}$' or next_value not between 1 and 9999999999 then raise exception 'Numeración inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ao_receipt_' || series_name,0));
  select coalesce(max(number::bigint),0) into max_number from public.ao_receipts where series=series_name;
  if next_value <= max_number then raise exception 'El siguiente número debe ser mayor que los ya emitidos.'; end if;
  insert into ao_private.sequences(series,next_number) values(series_name,next_value) on conflict(series) do update set next_number=excluded.next_number;
end;
$$;
revoke all on function public.ao_server_read(text), public.ao_server_write(text,jsonb), public.ao_server_claim_activation(text), public.ao_server_finish_activation(uuid,text), public.ao_server_set_number(text,bigint) from public, anon, authenticated;
grant execute on function public.ao_server_read(text), public.ao_server_write(text,jsonb), public.ao_server_claim_activation(text), public.ao_server_finish_activation(uuid,text), public.ao_server_set_number(text,bigint) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('ao-boletas','ao-boletas',false,10485760,array['application/pdf']);
create policy ao_pdf_read on storage.objects for select to authenticated using(bucket_id='ao-boletas' and (select ao_private.is_member()) and exists(select 1 from public.ao_receipts r where name='receipts/'||r.id::text||'.pdf'));
create policy ao_pdf_insert on storage.objects for insert to authenticated with check(bucket_id='ao-boletas' and (select ao_private.is_member()) and exists(select 1 from public.ao_receipts r where name='receipts/'||r.id::text||'.pdf'));
create policy ao_pdf_update on storage.objects for update to authenticated using(bucket_id='ao-boletas' and (select ao_private.is_member()) and exists(select 1 from public.ao_receipts r where name='receipts/'||r.id::text||'.pdf')) with check(bucket_id='ao-boletas' and (select ao_private.is_member()) and exists(select 1 from public.ao_receipts r where name='receipts/'||r.id::text||'.pdf'));

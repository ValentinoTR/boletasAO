-- Incremental update for an existing AO Nexus Central installation.
-- Deletion removes a receipt from the application and reverses its sale.
-- Keep its original record internally so its number and request ID cannot be reused.
alter table public.ao_receipts
  add column deleted_at timestamptz,
  add column deleted_by uuid;

alter policy ao_receipts_team_read on public.ao_receipts
  using (deleted_at is null and (select ao_private.is_member()));
alter policy ao_receipts_pdf_update on public.ao_receipts
  using (deleted_at is null and (select ao_private.is_member()))
  with check (deleted_at is null and (select ao_private.is_member()));

create or replace function ao_private.protect_issued_component()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.receipt_id is not null then
    if tg_op='DELETE' then raise exception 'Esta unidad ya está vinculada a una boleta emitida.'; end if;
    -- Only the deletion transaction can expose this marked receipt and make
    -- this exact reversal. Client roles cannot update the deletion columns.
    if new.receipt_id is null and new.precio_venta is null and new.sale_cost is null
      and new.fecha_venta is null and new.comprador_nombre is null and new.comprador_documento is null
      and (to_jsonb(new)-array['receipt_id','precio_venta','sale_cost','fecha_venta','comprador_nombre','comprador_documento'])
        = (to_jsonb(old)-array['receipt_id','precio_venta','sale_cost','fecha_venta','comprador_nombre','comprador_documento'])
      and exists(select 1 from public.ao_receipts where id=old.receipt_id and deleted_at is not null)
    then return new; end if;
    if (to_jsonb(new)-'precio_sugerido') is distinct from (to_jsonb(old)-'precio_sugerido') then
      raise exception 'Los datos de una venta con boleta emitida se conservan en su historial.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create function ao_private.suite_delete_receipt(receipt_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  saved public.ao_receipts%rowtype;
  ids bigint[];
  restored integer;
begin
  if not ao_private.is_member() then raise exception 'Acceso no autorizado.' using errcode='42501'; end if;
  if receipt_key is null then raise exception 'Selecciona la boleta que deseas eliminar.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ao_suite_'||receipt_key::text,0));
  select * into saved from public.ao_receipts where id=receipt_key;
  if not found then raise exception 'La boleta no existe. Actualiza el historial.'; end if;
  if saved.deleted_at is not null then
    return jsonb_build_object('deleted',true,'already_deleted',true,'restored_units',0,'id',receipt_key);
  end if;
  select coalesce(array_agg(id order by id),'{}'::bigint[]) into ids
    from public."COMPONENTES" where receipt_id=receipt_key;
  -- Match the purchase-before-unit lock order used when issuing receipts.
  perform p.id from public."COMPRAS" p where p.id in
    (select c.compra_id from public."COMPONENTES" c where c.id=any(ids)) order by p.id for update;
  perform c.id from public."COMPONENTES" c where c.id=any(ids) order by c.id for update;
  select * into saved from public.ao_receipts where id=receipt_key for update;
  if exists(select 1 from public.ao_deliveries
    where receipt_id=receipt_key and state='pending' and updated_at>now()-interval '5 minutes') then
    raise exception 'Esta boleta tiene un envío de correo en curso. Espera a que termine e intenta eliminarla de nuevo.';
  end if;
  update public.ao_receipts set deleted_at=now(),deleted_by=auth.uid() where id=receipt_key;
  update public."COMPONENTES" set receipt_id=null,precio_venta=null,sale_cost=null,
    fecha_venta=null,comprador_nombre=null,comprador_documento=null where receipt_id=receipt_key;
  get diagnostics restored=row_count;
  delete from public.ao_sale_items where receipt_id=receipt_key;
  delete from public.ao_sales where receipt_id=receipt_key;
  return jsonb_build_object('deleted',true,'already_deleted',false,'restored_units',restored,
    'id',receipt_key,'series',saved.series,'number',saved.number);
end;
$$;
revoke all on function ao_private.suite_delete_receipt(uuid) from public,anon;
grant execute on function ao_private.suite_delete_receipt(uuid) to authenticated;
create function public.ao_suite_delete_receipt(receipt_key uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select ao_private.suite_delete_receipt(receipt_key);
$$;
revoke all on function public.ao_suite_delete_receipt(uuid) from public,anon;
grant execute on function public.ao_suite_delete_receipt(uuid) to authenticated;

-- Serialize mail claims with deletion. A request that read a receipt before
-- deletion cannot subsequently start (or retry) sending the deleted receipt.
create function ao_private.guard_receipt_delivery()
returns trigger language plpgsql security definer set search_path='' as $$
declare removed timestamptz;
begin
  if new.state='pending' then
    select deleted_at into removed from public.ao_receipts where id=new.receipt_id for update;
    if not found or removed is not null then raise exception 'La boleta fue eliminada y no puede enviarse por correo.'; end if;
  end if;
  return new;
end;
$$;
revoke all on function ao_private.guard_receipt_delivery() from public,anon,authenticated;
create trigger guard_receipt_delivery before insert or update on public.ao_deliveries
  for each row execute function ao_private.guard_receipt_delivery();

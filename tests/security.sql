-- Pruebas de datos y permisos. Todo se revierte al finalizar.
begin;
select set_config('ao_test.member',gen_random_uuid()::text,true), set_config('ao_test.outsider',gen_random_uuid()::text,true), set_config('ao_test.receipt',gen_random_uuid()::text,true);
insert into auth.users(id,aud,role,email) values
  (current_setting('ao_test.member')::uuid,'authenticated','authenticated','ao-qa-member@example.test'),
  (current_setting('ao_test.outsider')::uuid,'authenticated','authenticated','ao-qa-outsider@example.test');
insert into public.ao_members(user_id,display_name,role) values(current_setting('ao_test.member')::uuid,'Prueba temporal','member');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ao_test.member'),'role','authenticated','is_anonymous',false)::text,true);
set local role authenticated;
do $test$
declare
  receipt jsonb := '{"version":1,"series":"B001","number":"999","date":"2026-10-09","customer":"CLIENTE DE PRUEBA","docType":"DNI","document":"12345678","address":"Lima","email":"","observations":"1 AÑO DE GARANTÍA.","items":[{"description":"SSD NVMe 1 TB","serial":"","code":"","unit":"NIU","quantity":"1","price":"480.00"}]}'::jsonb;
  first_receipt jsonb; repeated jsonb; second_receipt jsonb;
begin
  first_receipt := public.ao_issue_receipt(current_setting('ao_test.receipt')::uuid,receipt);
  repeated := public.ao_issue_receipt(current_setting('ao_test.receipt')::uuid,receipt);
  second_receipt := public.ao_issue_receipt(gen_random_uuid(),receipt);
  if first_receipt <> repeated then raise exception 'Fallo: idempotencia.'; end if;
  if (first_receipt->>'total_cents')::bigint <> 48000 then raise exception 'Fallo: cálculo del total.'; end if;
  if (second_receipt->'payload'->>'number')::bigint <> (first_receipt->'payload'->>'number')::bigint+1 then raise exception 'Fallo: numeración compartida.'; end if;
  if (select count(*) from public.ao_receipts where created_by=auth.uid()) <> 2 then raise exception 'Fallo: historial compartido.'; end if;
  begin
    perform public.ao_issue_receipt(gen_random_uuid(),jsonb_set(receipt,'{items,0,quantity}','"0"'));
    raise exception 'Fallo: cantidad cero permitida.';
  exception when others then if sqlerrm like 'Fallo:%' then raise; end if; end;
  begin
    update public.ao_members set role='owner' where user_id=auth.uid();
    raise exception 'Fallo: elevación de privilegios.';
  exception when insufficient_privilege then null; end;
  begin
    update public.ao_receipts set customer='CAMBIO' where id=current_setting('ao_test.receipt')::uuid;
    raise exception 'Fallo: modificación de boleta emitida.';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ao_server_read('sender');
    raise exception 'Fallo: claves del servidor visibles.';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ao_test.outsider'),'role','authenticated','user_metadata',jsonb_build_object('role','owner'))::text,true);
  if (select count(*) from public.ao_receipts) <> 0 then raise exception 'Fallo: persona externa ve boletas.'; end if;
  if (select count(*) from public.ao_members) <> 0 then raise exception 'Fallo: persona externa ve el equipo.'; end if;
  begin
    perform public.ao_issue_receipt(gen_random_uuid(),receipt);
    raise exception 'Fallo: persona externa emite boleta.';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ao_test.member'),'role','authenticated','is_anonymous',true)::text,true);
  if (select count(*) from public.ao_receipts) <> 0 then raise exception 'Fallo: sesión anónima ve boletas.'; end if;
end;
$test$;
reset role;
update public.ao_members set active=false where user_id=current_setting('ao_test.member')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ao_test.member'),'role','authenticated','is_anonymous',false)::text,true);
set local role authenticated;
do $test$
begin
  if (select count(*) from public.ao_receipts) <> 0 then raise exception 'Fallo: miembro desactivado conserva acceso.'; end if;
end;
$test$;
reset role;
insert into ao_private.settings(key,value) values('activation','{"state":"in_progress"}'::jsonb) on conflict(key) do update set value=excluded.value;
set local role service_role;
select public.ao_server_finish_activation(current_setting('ao_test.outsider')::uuid,'Administrador temporal');
do $test$
begin
  if (select role from public.ao_members where user_id=current_setting('ao_test.outsider')::uuid) <> 'owner' then raise exception 'Fallo: activación de administrador.'; end if;
  if public.ao_server_read('activation')->>'state' <> 'consumed' then raise exception 'Fallo: activación no consumida.'; end if;
end;
$test$;
select 'PASS: total, numeración, idempotencia, historial, permisos, boletas inmutables, acceso desactivado y activación del administrador.' as result;
rollback;

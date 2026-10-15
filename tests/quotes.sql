-- Real PostgreSQL checks for database/quotes.sql. Every fixture is rolled back (the quote numbering too).
begin;
-- Solo el equipo usa la tabla: anon no tiene acceso y nadie lee ni cambia el contador de números.
do $$
begin
  if has_table_privilege('anon','public.ao_quotes','select,insert,update,delete,truncate,references,trigger')
    or has_table_privilege('authenticated','public.ao_quotes','truncate,references,trigger')
    or has_table_privilege('anon','ao_private.quote_counter','select,insert,update,delete,truncate,references,trigger')
    or has_table_privilege('authenticated','ao_private.quote_counter','select,insert,update,delete,truncate,references,trigger')
    then raise exception 'Permisos de las cotizaciones demasiado amplios'; end if;
end;
$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true)
from public.ao_members where active and role='owner' limit 1;
set local role authenticated;
do $$
declare
  owner uuid:=auth.uid(); claims text:=current_setting('request.jwt.claims');
  stranger text:='{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
  q1 uuid:=gen_random_uuid(); q2 uuid:=gen_random_uuid(); q3 uuid:=gen_random_uuid(); q4 uuid:=gen_random_uuid();
  rid uuid:=gen_random_uuid(); n1 bigint; n2 bigint; n3 bigint; n bigint; previous bigint; last_number bigint;
  base jsonb:='{"version":1,"date":"2026-10-14","validDays":7,"validUntil":"2026-10-21","customer":"PRUEBA COTIZACION",
    "docType":"DNI","document":"","phone":"","email":"","address":"","notes":"","items":[{"description":"Armado y configuración",
    "code":"","unit":"NIU","quantity":"1","price":"3300.00","parts":[],"mode":"units"}]}';
  valid jsonb; patch jsonb; saved public.ao_quotes%rowtype; affected integer; rejected boolean; message text;
begin
  if owner is null then raise exception 'No hay un administrador activo en ao_members'; end if;

  -- Un miembro crea cotizaciones: la base asigna números correlativos sin permisos extra y registra al autor.
  select coalesce(max(number),0) into previous from public.ao_quotes;
  insert into public.ao_quotes(id,quote,customer,document,phone,total_cents,quote_date,valid_until)
    values(q1,base,'PRUEBA COTIZACION','','',330000,'2026-10-14','2026-10-21') returning number into n1;
  insert into public.ao_quotes(id,quote,customer,document,phone,total_cents,quote_date,valid_until)
    values(q2,base,'PRUEBA COTIZACION','','',330000,'2026-10-14','2026-10-21') returning number into n2;
  select * into saved from public.ao_quotes where id=q1;
  if n1<=previous or n2<>n1+1 or saved.created_by is distinct from owner or saved.receipt_id is not null
    or saved.created_at<>now() or saved.updated_at<>now()
    then raise exception 'Numeración o autoría incorrectas: %, % (anterior %)',n1,n2,previous; end if;

  -- Guardar otra vez (upsert de la app) actualiza sin cambiar ni consumir números.
  insert into public.ao_quotes(id,quote,customer,document,phone,total_cents,quote_date,valid_until)
    values(q1,base||'{"customer":"PRUEBA COTIZACION EDITADA"}','PRUEBA COTIZACION EDITADA','12345678','936177329',660000,'2026-10-14','2026-10-29')
    on conflict(id) do update set id=excluded.id,quote=excluded.quote,customer=excluded.customer,document=excluded.document,
      phone=excluded.phone,total_cents=excluded.total_cents,quote_date=excluded.quote_date,valid_until=excluded.valid_until
    returning number into n;
  select * into saved from public.ao_quotes where id=q1;
  if n<>n1 or saved.customer<>'PRUEBA COTIZACION EDITADA' or saved.total_cents<>660000 or saved.phone<>'936177329'
    or saved.valid_until<>'2026-10-29' or saved.quote->>'customer'<>'PRUEBA COTIZACION EDITADA'
    then raise exception 'El upsert no actualizó la cotización %',n1; end if;

  -- El número, el autor y la fecha de creación los pone la base, aunque se envíen otros.
  insert into public.ao_quotes(id,number,quote,customer,total_cents,quote_date,valid_until,created_by,created_at,updated_at)
    values(q3,n1,base,'PRUEBA COTIZACION',330000,'2026-10-14','2026-10-21','99999999-9999-9999-9999-999999999999','2000-01-01','2000-01-01')
    returning number into n3;
  select * into saved from public.ao_quotes where id=q3;
  if n3<>n2+1 or saved.created_by is distinct from owner or saved.created_at<>now()
    then raise exception 'Se saltó o se eligió un número: % después de %',n3,n2; end if;
  update public.ao_quotes set number=n2,created_by='99999999-9999-9999-9999-999999999999',created_at='2000-01-01',
    updated_at='2000-01-01',customer='PRUEBA COTIZACION 3' where id=q3;
  select * into saved from public.ao_quotes where id=q3;
  if saved.number<>n3 or saved.created_by is distinct from owner or saved.created_at<>now() or saved.updated_at<>now()
    or saved.customer<>'PRUEBA COTIZACION 3' then raise exception 'Una edición cambió el número, el autor o las fechas'; end if;

  -- Datos inválidos se rechazan: cliente vacío o largo, vigencia imposible, totales fuera de rango, quote no objeto.
  valid:=jsonb_build_object('id',gen_random_uuid(),'quote',base,'customer','PRUEBA COTIZACION','document','','phone','',
    'total_cents',330000,'quote_date','2026-10-14','valid_until','2026-10-21');
  for patch in select jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('customer','   '),jsonb_build_object('customer',repeat('A',111)),
    jsonb_build_object('valid_until','2026-10-13'),jsonb_build_object('valid_until','2027-10-15'),
    jsonb_build_object('total_cents',-1),jsonb_build_object('total_cents',100000000000),
    jsonb_build_object('quote',jsonb_build_array()),jsonb_build_object('quote','texto'),
    jsonb_build_object('document',repeat('1',21)),jsonb_build_object('phone',repeat('9',21)))) loop
    rejected:=false;
    begin insert into public.ao_quotes select * from jsonb_populate_record(null::public.ao_quotes,valid||patch);
      exception when check_violation then rejected:=true; end;
    if not rejected then raise exception 'Se aceptó una cotización inválida: %',patch; end if;
  end loop;
  -- Vigencia en los límites (el mismo día y 365 días) y total cero se aceptan; los intentos rechazados no consumen números.
  insert into public.ao_quotes select * from jsonb_populate_record(null::public.ao_quotes,
    valid||jsonb_build_object('id',gen_random_uuid(),'valid_until','2026-10-14','total_cents',0)) returning number into n;
  if n<>n3+1 then raise exception 'Un guardado rechazado consumió un número: %',n; end if;
  insert into public.ao_quotes select * from jsonb_populate_record(null::public.ao_quotes,
    valid||jsonb_build_object('id',q4,'valid_until','2027-10-14')) returning number into last_number;

  -- Convertir: se enlaza la boleta preparada; mientras no se emita, la cotización se puede editar.
  update public.ao_quotes set receipt_id=rid where id=q1;
  get diagnostics affected=row_count;
  update public.ao_quotes set total_cents=650000 where id=q1;
  if affected<>1 or (select receipt_id from public.ao_quotes where id=q1) is distinct from rid
    or (select total_cents from public.ao_quotes where id=q1)<>650000 then raise exception 'No se enlazó la boleta'; end if;
  -- Emitida la boleta, la cotización queda tal como se envió (guardar sin cambios no falla).
  perform public.ao_suite_issue_receipt(rid,jsonb_build_object('version',1,'series','QACOT','number','1','date','2026-10-14','customer','PRUEBA COTIZACION','docType','NONE',
    'document','','address','','email','','observations','','items',jsonb_build_array(jsonb_build_object('description','Armado y configuración','serial','','code','',
    'unit','NIU','quantity','1','price','50.00','inventoryMode','units','inventory',jsonb_build_array(jsonb_build_object('source','external','name','PRUEBA COTIZACION ARMADO','supplier','Venta sin stock','cost','0.00','price','50.00'))))));
  update public.ao_quotes set customer=customer where id=q1;
  for patch in select jsonb_array_elements(jsonb_build_array(jsonb_build_object('total_cents',1),jsonb_build_object('receipt_id',gen_random_uuid()))) loop
    rejected:=false;
    begin update public.ao_quotes set total_cents=coalesce((patch->>'total_cents')::bigint,total_cents),
        receipt_id=coalesce((patch->>'receipt_id')::uuid,receipt_id) where id=q1;
      exception when raise_exception then rejected:=true; message:=sqlerrm; end;
    if not rejected or message not like '%duplícala%' then raise exception 'Se modificó una cotización ya convertida: %',patch; end if;
  end loop;
  -- Si se elimina su boleta, vuelve a ser editable y se puede convertir de nuevo.
  perform public.ao_suite_delete_receipt(rid);
  update public.ao_quotes set receipt_id=gen_random_uuid(),total_cents=640000 where id=q1;
  if (select total_cents from public.ao_quotes where id=q1)<>640000 then raise exception 'La cotización no volvió a ser editable'; end if;

  -- Una cuenta sin acceso al equipo no ve, no crea, no cambia ni elimina cotizaciones.
  perform set_config('request.jwt.claims',stranger,true);
  if exists(select 1 from public.ao_quotes) then raise exception 'Una cuenta ajena puede ver cotizaciones'; end if;
  rejected:=false;
  begin insert into public.ao_quotes(id,quote,customer,total_cents,quote_date,valid_until)
      values(gen_random_uuid(),base,'PRUEBA AJENA',100,'2026-10-14','2026-10-21');
    exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Una cuenta ajena puede crear cotizaciones'; end if;
  rejected:=false;
  begin insert into public.ao_quotes(id,quote,customer,total_cents,quote_date,valid_until)
      values(q2,base,'PRUEBA AJENA',100,'2026-10-14','2026-10-21') on conflict(id) do update set customer=excluded.customer;
    exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Una cuenta ajena puede sobrescribir cotizaciones'; end if;
  update public.ao_quotes set customer='PRUEBA AJENA' where id=q2;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Una cuenta ajena puede editar cotizaciones'; end if;
  delete from public.ao_quotes where id=q2;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Una cuenta ajena puede eliminar cotizaciones'; end if;
  perform set_config('request.jwt.claims',claims,true);
  if (select customer from public.ao_quotes where id=q2) is distinct from 'PRUEBA COTIZACION'
    then raise exception 'Una cuenta ajena cambió una cotización'; end if;

  -- El equipo elimina cotizaciones; el número de la última eliminada no se reutiliza.
  delete from public.ao_quotes where id in(q1,q3,q4);
  get diagnostics affected=row_count;
  insert into public.ao_quotes(id,quote,customer,total_cents,quote_date,valid_until)
    values(gen_random_uuid(),base,'PRUEBA COTIZACION',330000,'2026-10-14','2026-10-21') returning number into n;
  if affected<>3 or exists(select 1 from public.ao_quotes where id in(q1,q3,q4)) or n<>last_number+1
    then raise exception 'Eliminación o numeración tras eliminar incorrectas: % después de %',n,last_number; end if;
end;
$$;
-- Sin sesión (anon) no hay acceso.
set local role anon;
do $$
declare rejected boolean:=false;
begin
  begin perform 1 from public.ao_quotes limit 1; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'anon puede leer cotizaciones'; end if;
  rejected:=false;
  begin insert into public.ao_quotes(id,quote,customer,total_cents,quote_date,valid_until)
      values(gen_random_uuid(),'{}','PRUEBA ANON',100,'2026-10-14','2026-10-21');
    exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'anon puede crear cotizaciones'; end if;
end;
$$;
rollback;
select true as quote_tests_passed;

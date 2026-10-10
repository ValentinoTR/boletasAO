import { createClient } from "@supabase/supabase-js";
import { BUSINESS_EMAIL, MAX_REQUEST_BYTES, MailError, validateJob, validateConfig, callBridge, digestJob, seal, unseal } from "./mail-core.ts";

const allowedOrigins = new Set(["https://valentinotr.github.io", ...(Deno.env.get("AO_ALLOWED_ORIGINS") || "").split(",").map(v => v.trim()).filter(Boolean)]);
function serverKey() {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) { const keys = JSON.parse(modern); if (typeof keys.default === "string") return keys.default; }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
const admin = () => createClient(Deno.env.get("SUPABASE_URL") || "", serverKey(), { auth: { persistSession: false, autoRefreshToken: false } });
async function hash(value: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,"0")).join(""); }
async function encryptionKey() { return Deno.env.get("AO_ENCRYPTION_KEY") || hash("AO_NEXUS_MAIL:" + serverKey()); }
async function readJSON(req: Request) {
  if (Number(req.headers.get("content-length")) > MAX_REQUEST_BYTES) throw new MailError("El archivo es demasiado grande.","too_large",413);
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new MailError("Solicitud inválida.");
  const reader = req.body?.getReader(); if (!reader) throw new MailError("Solicitud vacía.");
  let length = 0; const chunks: Uint8Array[] = [];
  while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > MAX_REQUEST_BYTES) { await reader.cancel(); throw new MailError("El archivo es demasiado grande.","too_large",413); } chunks.push(part.value); }
  const bytes = new Uint8Array(length); let offset=0; for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
  try { const data = JSON.parse(new TextDecoder().decode(bytes)); if (!data || typeof data !== "object" || Array.isArray(data)) throw Error(); return data; } catch { throw new MailError("Solicitud inválida."); }
}
function text(value: unknown, min: number, max: number) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new MailError("Revisa los datos ingresados."); return value.trim();
}
function password(value: unknown) { if (typeof value !== "string" || value.length < 12 || value.length > 128) throw new MailError("Usa una contraseña de entre 12 y 128 caracteres."); return value; }
function uuid(value: unknown) { const id=text(value,36,36); if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new MailError("Identificador inválido."); return id; }
async function rpc(db: ReturnType<typeof admin>, name: string, args: Record<string,unknown>) { const {data,error}=await db.rpc(name,args); if (error) throw new MailError("No se pudo completar la operación de datos.","database_error",503); return data; }
async function getState(db: ReturnType<typeof admin>, key: string) { return rpc(db,"ao_server_read",{config_key:key}); }
async function setState(db: ReturnType<typeof admin>, key: string, value: unknown) { return rpc(db,"ao_server_write",{config_key:key,config_value:value}); }
async function authorize(req: Request, db: ReturnType<typeof admin>) {
  const token=req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new MailError("Inicia sesión para continuar.","unauthorized",401);
  const {data,error}=await db.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) throw new MailError("Tu sesión no es válida. Ingresa nuevamente.","unauthorized",401);
  const {data:member,error:lookupError}=await db.from("ao_members").select("user_id,role,active").eq("user_id",data.user.id).maybeSingle();
  if (lookupError || !member?.active) throw new MailError("Tu cuenta no tiene acceso activo a AO Nexus.","forbidden",403);
  return {user:data.user,member};
}
async function activate(db: ReturnType<typeof admin>, input: Record<string,unknown>) {
  const token=text(input.token,40,100); if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new MailError("El enlace de activación no es válido.","forbidden",403);
  const name=text(input.name,1,80), secret=password(input.password), previous=await getState(db,"activation");
  const claimed=await rpc(db,"ao_server_claim_activation",{expected_hash:await hash(token)});
  if (!claimed) throw new MailError("El enlace ya fue utilizado o venció. Ingresa con tu cuenta si ya la activaste.","activation_unavailable",403);
  let createdId: string | null=null;
  try {
    const {data,error}=await db.auth.admin.createUser({email:BUSINESS_EMAIL,password:secret,email_confirm:true});
    if (error || !data.user) throw new MailError("No se pudo crear la cuenta administradora. Revisa si ese correo ya tiene una cuenta.","account_exists",409);
    createdId=data.user.id;
    await rpc(db,"ao_server_finish_activation",{owner_id:createdId,owner_name:name});
    return {activated:true,email:BUSINESS_EMAIL};
  } catch (error) {
    if (createdId) { const {error:deleteError}=await db.auth.admin.deleteUser(createdId); if (deleteError) { await setState(db,"activation",{state:"needs_review"}); throw new MailError("La activación requiere revisión del administrador del proyecto.","activation_incomplete",503); } }
    await setState(db,"activation",previous); throw error;
  }
}
async function mailConfig(db: ReturnType<typeof admin>) {
  const value=await getState(db,"sender");
  if (!value?.encrypted) return null;
  try { return await unseal(value.encrypted,await encryptionKey()); } catch { throw new MailError("El administrador debe volver a conectar el correo.","not_configured",503); }
}
async function send(db: ReturnType<typeof admin>, input: Record<string,unknown>, userId: string) {
  const receiptId=uuid(input.receiptId), job=validateJob(input.job), current=await mailConfig(db);
  if (!current) throw new MailError("El administrador debe activar el correo. Puedes seguir descargando el PDF.","not_configured",503);
  const {data:receipt,error:receiptError}=await db.from("ao_receipts").select("payload,total_cents").eq("id",receiptId).maybeSingle();
  if (receiptError || !receipt) throw new MailError("Primero guarda la boleta en la nube.","invalid_receipt",400);
  const r=receipt.payload, total="S/ "+(receipt.total_cents/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  if (job.to!==r.email || job.customer!==r.customer || job.series!==r.series || job.number!==r.number || job.date!==r.date || job.total!==total) throw new MailError("El envío no coincide con la boleta guardada.","conflict",409);
  const digest=await digestJob(job);
  const {error:claimError}=await db.from("ao_deliveries").insert({id:job.requestId,receipt_id:receiptId,digest,state:"pending",initiated_by:userId});
  if (claimError) {
    if (claimError.code!=="23505") throw new MailError("No se pudo registrar el envío.","database_error",503);
    const {data:prior,error:priorError}=await db.from("ao_deliveries").select("digest,state,receipt_id").eq("id",job.requestId).maybeSingle();
    if (priorError || !prior || prior.digest!==digest || prior.receipt_id!==receiptId) throw new MailError("Ese envío corresponde a otra boleta.","conflict",409);
    if (prior.state==="sent") return {sent:true,duplicate:true,sender:BUSINESS_EMAIL};
    if (prior.state!=="failed") throw new MailError("El resultado del envío está pendiente de confirmar. Comprueba la recepción antes de enviar otra vez.","delivery_unknown",409);
    const {data:retry,error:retryError}=await db.from("ao_deliveries").update({state:"pending",updated_at:new Date().toISOString()}).eq("id",job.requestId).eq("state","failed").select("id");
    if (retryError || retry?.length!==1) throw new MailError("El envío ya está en proceso.","delivery_unknown",409);
  }
  async function update(state: string) { const {error}=await db.from("ao_deliveries").update({state,updated_at:new Date().toISOString()}).eq("id",job.requestId); if(error) throw Error("Delivery state unavailable"); }
  try {
    const result=await callBridge(current,{action:"send",job});
    if (!result.ok) { const uncertain=result.code==="delivery_unknown"; await update(uncertain?"unknown":"failed"); throw new MailError(uncertain?"Google no pudo confirmar el envío. Comprueba la recepción antes de intentar de nuevo.":"Google no pudo enviar la boleta. Revisa la conexión o el límite diario del correo.",uncertain?"delivery_unknown":"rejected",uncertain?409:502); }
    if (result.sender!==BUSINESS_EMAIL) throw Error("Unexpected sender");
    await update("sent"); return {sent:true,duplicate:!!result.duplicate,sender:BUSINESS_EMAIL};
  } catch (error) {
    if (error instanceof MailError && ["rejected","delivery_unknown"].includes(error.code)) throw error;
    try { await update("unknown"); } catch { /* Se mantiene pending; ningún reintento automático. */ }
    throw new MailError("Se perdió la confirmación del envío. Comprueba la recepción antes de volver a exportar.","delivery_unknown",503);
  }
}

Deno.serve(async req => {
  const origin=req.headers.get("origin"), cors={...(origin&&allowedOrigins.has(origin)?{"Access-Control-Allow-Origin":origin}:{}),"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS",Vary:"Origin"};
  const json=(body: unknown,status=200)=>Response.json(body,{status,headers:{...cors,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  if (origin&&!allowedOrigins.has(origin)) return json({error:"Origen no autorizado.",code:"forbidden"},403);
  if (req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if (req.method!=="POST") return json({error:"Método no permitido."},405);
  try {
    const input=await readJSON(req),db=admin();
    if (input.action==="activate") return json(await activate(db,input));
    const actor=await authorize(req,db);
    if (input.action==="email-config") { const current=await mailConfig(db); return json({configured:!!current,sender:BUSINESS_EMAIL,admin:actor.member.role==="owner",token:"supabase"}); }
    if (input.action==="send") return json(await send(db,input,actor.user.id));
    if (actor.member.role!=="owner") throw new MailError("Solo el administrador puede realizar esta acción.","forbidden",403);
    if (input.action==="settings") {
      const next=validateConfig(input.settings),status=await callBridge(next,{action:"status"});
      if (!status.ok || status.sender!==BUSINESS_EMAIL) throw new MailError("Revisa la implementación de Google y la clave de conexión.","configuration_failed",400);
      await setState(db,"sender",{encrypted:await seal(next,await encryptionKey())}); return json({configured:true,sender:BUSINESS_EMAIL});
    }
    if (input.action==="disconnect") { await setState(db,"sender",{}); return json({configured:false}); }
    if (input.action==="create-member") {
      const name=text(input.name,1,80), email=text(input.email,3,254).toLowerCase(),initial=password(input.password);
      if (!/^[^\s<>@,;:]+@[^\s<>@,;:]+\.[^\s<>@,;:]+$/.test(email)) throw new MailError("Correo inválido.");
      const {data,error}=await db.auth.admin.createUser({email,password:initial,email_confirm:true});
      if (error || !data.user) throw new MailError("No se pudo crear el acceso. Ese correo podría tener una cuenta existente.","account_exists",409);
      const {error:memberError}=await db.from("ao_members").insert({user_id:data.user.id,display_name:name,role:"member"});
      if (memberError) { await db.auth.admin.deleteUser(data.user.id); throw new MailError("No se pudo guardar el acceso del equipo.","database_error",503); }
      return json({created:true});
    }
    if (input.action==="member-state") {
      const id=uuid(input.userId); if (typeof input.active!=="boolean") throw new MailError("Estado inválido.");
      const {data,error}=await db.from("ao_members").update({active:input.active}).eq("user_id",id).eq("role","member").select("user_id");
      if (error || data?.length!==1) throw new MailError("No se encontró ese acceso del equipo.","invalid_member",400);
      return json({updated:true});
    }
    if (input.action==="numbering") {
      const series=text(input.series,1,8).toUpperCase(),number=text(input.number,1,10); if (!/^[A-Z0-9]{1,8}$/.test(series)||!/^\d{1,10}$/.test(number)||Number(number)<1) throw new MailError("Numeración inválida.");
      const {error}=await db.rpc("ao_server_set_number",{series_name:series,next_value:Number(number)}); if (error) throw new MailError("El siguiente número debe ser mayor que los ya emitidos."); return json({saved:true});
    }
    throw new MailError("Acción inválida.");
  } catch (error) { const known=error instanceof MailError; return json({error:known?error.message:"No se pudo completar la operación.",code:known?error.code:"server_error"},known?error.status:500); }
});

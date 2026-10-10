export const BUSINESS_EMAIL = "aonexuspe@gmail.com";
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_BYTES = Math.ceil(MAX_PDF_BYTES * 4 / 3) + 8192;

export class MailError extends Error {
  public code: string;
  public status: number;
  constructor(message: string, code = "invalid_request", status = 400) {
    super(message); this.code = code; this.status = status;
  }
}
export type MailJob = {
  requestId: string; to: string; customer: string; series: string;
  number: string; date: string; total: string; filename: string; pdfBase64: string;
};
export type SenderConfig = { url: string; secret: string; sender: string };
export type BridgeResult = { ok: boolean; sender?: string; duplicate?: boolean; code?: string; error?: string };

function safeText(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new MailError("Revisa los datos de la boleta.");
  return value.trim();
}
export function validateJob(input: unknown): MailJob {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MailError("Solicitud inválida.");
  const v = input as Record<string, unknown>;
  const job: MailJob = {
    requestId: safeText(v.requestId, 36), to: safeText(v.to, 254),
    customer: safeText(v.customer, 300), series: safeText(v.series, 10),
    number: safeText(v.number, 10), date: safeText(v.date, 10),
    total: safeText(v.total, 80), filename: safeText(v.filename, 160),
    pdfBase64: typeof v.pdfBase64 === "string" ? v.pdfBase64 : "",
  };
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(job.requestId)) throw new MailError("Identificador de envío inválido.");
  if (!/^[^\s<>@,;:]+@[^\s<>@,;:]+\.[^\s<>@,;:]+$/.test(job.to)) throw new MailError("El correo del cliente no es válido.");
  if (!/^[A-Z0-9_-]{1,10}$/.test(job.series) || !/^\d{1,10}$/.test(job.number)) throw new MailError("Serie o número inválido.");
  const parsed = new Date(job.date + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(job.date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== job.date) throw new MailError("Fecha inválida.");
  if (!job.customer || !job.total || !/^[^/\\]+\.pdf$/i.test(job.filename)) throw new MailError("Datos de la boleta incompletos.");
  if (!job.pdfBase64 || job.pdfBase64.length % 4 || job.pdfBase64.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(job.pdfBase64)) throw new MailError("El PDF no es válido o excede 10 MB.");
  let bytes: string;
  try { bytes = atob(job.pdfBase64); } catch { throw new MailError("El PDF no es válido."); }
  if (bytes.length > MAX_PDF_BYTES || !bytes.startsWith("%PDF-")) throw new MailError("El archivo adjunto debe ser un PDF.");
  return job;
}
export function validateConfig(input: unknown): SenderConfig {
  if (!input || typeof input !== "object") throw new MailError("Configuración inválida.");
  const v = input as Record<string, unknown>;
  const url = safeText(v.url, 500), secret = safeText(v.secret, 128);
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) throw new MailError("Pega la URL de la implementación de Google terminada en /exec.");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret)) throw new MailError("La clave de conexión no es válida. Usa la generada por el proyecto de Google.");
  return { url, secret, sender: BUSINESS_EMAIL };
}
export async function digestJob(job: MailJob): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(job)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
function encryptionKey(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new MailError("Falta completar la configuración del servidor.", "server_unconfigured", 503);
  return Uint8Array.from(hex.match(/.{2}/g)!, h => parseInt(h, 16));
}
export async function seal(config: SenderConfig, hex: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encryptionKey(hex), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(config))));
  return btoa(String.fromCharCode(...iv)) + "." + btoa(String.fromCharCode(...encrypted));
}
export async function unseal(value: string, hex: string): Promise<SenderConfig> {
  const key = await crypto.subtle.importKey("raw", encryptionKey(hex), "AES-GCM", false, ["decrypt"]);
  const [iv, ciphertext] = value.split(".").map(s => Uint8Array.from(atob(s), c => c.charCodeAt(0)));
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return validateConfig(JSON.parse(new TextDecoder().decode(clear)));
}
// Credentials go only to the script endpoint. ContentService redirect reads
// never repeat the POST or secret and are restricted to Google's content host.
export async function callBridge(config: SenderConfig, payload: Record<string, unknown>, fetcher = fetch): Promise<BridgeResult> {
  const signal = AbortSignal.timeout(45000);
  let response = await fetcher(config.url, { method: "POST", redirect: "manual", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, secret: config.secret }) });
  for (let i = 0; response.status >= 300 && response.status < 400 && i < 3; i++) {
    const next = new URL(response.headers.get("location") || "", config.url);
    if (next.protocol !== "https:" || next.hostname !== "script.googleusercontent.com") throw new MailError("La conexión de Google necesita autorización del administrador.", "bridge_unavailable", 503);
    response = await fetcher(next.href, { method: "GET", redirect: "manual", signal });
  }
  if (!response.ok) throw new MailError("Google no respondió al servicio de correo.", "bridge_unavailable", 503);
  let result: BridgeResult;
  try { result = await response.json() as BridgeResult; }
  catch { throw new MailError("Revisa que la implementación de Google permita conexiones del servidor.", "bridge_unavailable", 503); }
  if (typeof result.ok !== "boolean") throw new MailError("Respuesta de correo inválida.", "bridge_unavailable", 503);
  return result;
}


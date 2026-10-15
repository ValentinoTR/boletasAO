"use strict";
// Cotizaciones: lista con estados y KPIs, puente con el editor (cotizacion.html) y paso a boleta.
// Una cotización nunca aparta ni descuenta stock: el stock baja recién al emitir la boleta que sale de ella.
(() => {
  const $ = id => document.getElementById(id);
  const COLUMNS = "id,number,quote,customer,document,phone,total_cents,quote_date,valid_until,receipt_id,created_at,updated_at";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ISO = /^\d{4}-\d{2}-\d{2}$/, MAX_CENTS = 99999999999;
  const DOCS = { DNI: "DNI", RUC: "RUC", CE: "C.E.", PAS: "Pasaporte" };
  // «Pendientes» incluye las que vencen pronto: siguen abiertas.
  const FILTERS = { all: () => true, pending: s => s.key === "pending" || s.key === "expiring", expiring: s => s.key === "expiring", converted: s => s.key === "converted", expired: s => s.key === "expired" };
  const EMPTY_FILTER = { pending: "No tienes cotizaciones pendientes.", expiring: "Ninguna cotización vence en los próximos 2 días.", converted: "Aún no conviertes cotizaciones en boletas.", expired: "No tienes cotizaciones vencidas." };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = cents => "S/ " + (Number(cents || 0) / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const label = number => { const n = Number(number); return Number.isSafeInteger(n) && n > 0 ? "COT-" + String(n).padStart(5, "0") : "COT"; };
  const fold = value => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const formatDate = iso => { const f = String(iso || "").slice(0, 10).split("-"); return f.length === 3 ? f[2] + "/" + f[1] + "/" + f[0] : ""; };
  const daysBetween = (from, to) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 864e5);
  function limaDate(value = new Date()) { const date = new Date(value); if (isNaN(date)) return ""; const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date), get = t => parts.find(p => p.type === t).value; return get("year") + "-" + get("month") + "-" + get("day"); }
  const errorText = error => error?.message || "No se pudo completar la operación. Revisa tu conexión.";
  // La tabla aún no existe: falta ejecutar database/quotes.sql en Supabase.
  const isMissing = error => ["PGRST205", "42P01"].includes(error?.code) || /could not find the table|does not exist/i.test(error?.message || "");
  const app = () => window.AOApp, message = text => app()?.globalMessage(text);
  // Al pasar a un editor (iframe) desde abajo de la lista, se empieza desde arriba.
  const goTo = async name => { await app()?.showView(name); window.scrollTo(0, 0); };
  let db = null, member = null, generation = 0, ticket = 0, rows = [], receipts = new Map(), state = "idle", loadError = "", filter = "all";
  let pendingOpen = null, editorReady = false, deleteState = null, convertState = null, toastTimer;
  function toast(text) { const box = $("suiteToast"); box.textContent = text; box.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => box.hidden = true, 6500); }

  // ---------- Estado (fecha de Lima) ----------
  function statusOf(row, now = limaDate()) {
    const receipt = row.receipt_id ? receipts.get(String(row.receipt_id)) : null;
    if (receipt) { const receiptLabel = receipt.series + "-" + receipt.number; return { key: "converted", text: "Convertida · " + receiptLabel, pill: "Boleta " + receiptLabel, receipt, receiptLabel }; }
    const left = daysBetween(now, row.valid_until);
    if (left < 0) return { key: "expired", text: "Vencida", pill: "Vencida" };
    if (left <= 2) { const text = left === 0 ? "Vence hoy" : left === 1 ? "Vence mañana" : "Vence en " + left + " días"; return { key: "expiring", text, pill: text }; }
    return { key: "pending", text: "Pendiente", pill: "Pendiente" };
  }
  // Fila para el editor (contrato QuoteRow de AOQuoteHost).
  function toRow(row) { const s = statusOf(row); return { id: row.id, number: Number(row.number), label: label(row.number), quote: structuredClone(row.quote), status: s.key, statusText: s.text, receiptId: s.key === "converted" ? row.receipt_id : null, receiptLabel: s.receiptLabel || null, updatedAt: row.updated_at || null }; }
  const convertedOn = x => String(x.status.receipt?.date || x.status.receipt?.payload?.date || limaDate(x.row.updated_at) || "");

  // ---------- Lista ----------
  async function load() {
    if (!db) return;
    const current = generation, client = db, mine = ++ticket, stale = () => current !== generation || mine !== ticket;
    if (state !== "ready") { state = "loading"; render(); }
    try {
      const { data, error } = await client.from("ao_quotes").select(COLUMNS).order("created_at", { ascending: false }).range(0, 499);
      if (stale()) return;
      if (error) { if (isMissing(error)) { rows = []; receipts = new Map(); state = "missing"; render(); return; } throw error; }
      const list = (Array.isArray(data) ? data : []).filter(r => r && typeof r.id === "string" && r.quote && typeof r.quote === "object");
      // Una cotización está convertida si su boleta existe y no fue eliminada.
      const ids = [...new Set(list.map(r => r.receipt_id).filter(Boolean).map(String))], found = new Map();
      for (let i = 0; i < ids.length; i += 100) {
        const { data: part, error: receiptError } = await client.from("ao_receipts").select("id,series,number,date,payload").in("id", ids.slice(i, i + 100)).is("deleted_at", null);
        if (stale()) return;
        if (receiptError) throw receiptError;
        for (const receipt of part || []) found.set(String(receipt.id), receipt);
      }
      rows = list; receipts = found; state = "ready"; loadError = ""; render();
    } catch (error) {
      if (stale()) return;
      loadError = errorText(error); if (state !== "ready") state = "error"; render(); throw error;
    }
  }
  function render() {
    const missing = state === "missing";
    $("quotesSetup").hidden = !missing; $("quotesContent").hidden = missing; $("newQuote").disabled = missing || !db;
    if (missing) {
      $("quotesSetup").innerHTML = member?.role === "owner"
        ? '<span class="quotes-setup-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6M5 11.5v6c0 1.4 3.1 2.5 7 2.5 1 0 1.9-.1 2.7-.2M19 11.5V14"/><path d="m16.5 18 1.6 1.6 3.4-3.4"/></svg></span><div><p><strong>Activa las cotizaciones (paso único):</strong> abre Supabase → SQL Editor, pega el contenido de <code>database/quotes.sql</code> y pulsa Run.</p><small>Cuando termines, pulsa «Actualizar». Tus boletas y tu stock no cambian.</small></div>'
        : '<span class="quotes-setup-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6M5 11.5v6c0 1.4 3.1 2.5 7 2.5 1 0 1.9-.1 2.7-.2M19 11.5V14"/><path d="m16.5 18 1.6 1.6 3.4-3.4"/></svg></span><div><p><strong>Las cotizaciones aún no están activas.</strong> Pídele al administrador que active las cotizaciones.</p><small>Tus boletas y tu stock no cambian.</small></div>';
      return;
    }
    const now = limaDate(), list = rows.map(row => ({ row, status: statusOf(row, now) })), first = !rows.length && state !== "ready";
    renderSummary(list, now, first);
    $("quotesToolbar").hidden = !rows.length;
    const counts = Object.fromEntries(Object.entries(FILTERS).map(([key, test]) => [key, list.filter(x => test(x.status)).length]));
    document.querySelectorAll("[data-quote-filter]").forEach(b => { const on = b.dataset.quoteFilter === filter; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
    document.querySelectorAll("[data-quote-count]").forEach(e => e.textContent = String(counts[e.dataset.quoteCount] ?? 0));
    // «COT-00012», «cot 12» o «cot12» buscan ese número exacto; lo demás, cada palabra en cliente, documento o teléfono.
    const term = fold($("quotesSearch").value.trim()), tokens = term.split(/\s+/).filter(Boolean), cot = term.match(/^cot[\s-]*0*(\d{1,12})$/);
    const visible = list.filter(x => FILTERS[filter](x.status) && (cot ? Number(x.row.number) === Number(cot[1]) : tokens.every(t => haystack(x.row).includes(t))));
    $("quotesRows").innerHTML = visible.map(rowHTML).join("");
    $("quotesRows").closest("table").hidden = !visible.length;
    const empty = $("quotesEmpty");
    empty.hidden = visible.length > 0;
    if (!visible.length) empty.innerHTML = first
      ? (state === "error"
        ? `<p class="quotes-empty-title">No se pudieron cargar tus cotizaciones</p><p>${esc(loadError)}</p><button type="button" class="secondary" data-quote-retry>Reintentar</button>`
        : '<p class="quotes-loading"><span class="convert-spinner" aria-hidden="true"></span>Cargando tus cotizaciones…</p>')
      : !rows.length
        ? `<span class="quotes-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="3.5" rx="1"/><path d="M9 11h6M9 14.5h6M9 18h3.5"/></svg></span><p class="quotes-empty-title">Aún no tienes cotizaciones</p><p>Arma una propuesta con productos de tu stock, descárgala en PDF y envíala por WhatsApp. No aparta ni descuenta stock.</p><button type="button" class="primary" data-quote-new>Crear mi primera cotización</button>`
        : `<p class="quotes-empty-title">${tokens.length ? "Ninguna cotización coincide con «" + esc($("quotesSearch").value.trim()) + "»" : esc(EMPTY_FILTER[filter] || "No hay cotizaciones.")}</p><p>${tokens.length ? "Busca por cliente, número (COT-00012), documento o teléfono." : "Cambia el filtro para ver las demás."}</p><button type="button" class="secondary" data-quote-clear>Ver todas las cotizaciones</button>`;
    $("quotesCount").textContent = rows.length ? (visible.length === rows.length ? plural(rows.length, "cotización", "cotizaciones") : "Mostrando " + visible.length + " de " + plural(rows.length, "cotización", "cotizaciones")) + (rows.length >= 500 ? " · se muestran las 500 más recientes" : "") : "";
  }
  function renderSummary(list, now, first) {
    const sum = items => items.reduce((n, x) => n + Number(x.row.total_cents || 0), 0);
    const open = list.filter(x => FILTERS.pending(x.status)), soon = list.filter(x => x.status.key === "expiring"), month = now.slice(0, 7);
    const closed = list.filter(x => x.status.key === "converted" && convertedOn(x).slice(0, 7) === month);
    const recent = list.filter(x => daysBetween(limaDate(x.row.created_at) || x.row.quote_date, now) < 90), won = recent.filter(x => x.status.key === "converted").length;
    const tiles = first ? [["pending", "Pendientes"], ["expiring", "Por vencer"], ["converted", "Convertidas este mes"], ["rate", "Tasa de cierre"]].map(([key, title]) => [key, title, "—", state === "error" ? "Sin datos" : "Cargando…"]) : [
      ["pending", "Pendientes", open.length, open.length ? money(sum(open)) + " por cerrar" : "Sin propuestas abiertas"],
      ["expiring", "Por vencer", soon.length, soon.length ? money(sum(soon)) + " · vencen en 2 días o menos" : "Ninguna vence en los próximos 2 días"],
      ["converted", "Convertidas este mes", closed.length, closed.length ? money(sum(closed)) + " en boletas" : "Aún ninguna este mes"],
      ["rate", "Tasa de cierre", recent.length ? Math.round(won * 100 / recent.length) + "%" : "—", recent.length ? won + " de " + plural(recent.length, "cotización", "cotizaciones") + " · últimos 90 días" : "Sin cotizaciones en 90 días"]];
    $("quotesSummary").innerHTML = tiles.map(([key, title, value, note]) => `<div class="quote-kpi ${key}"><span>${title}</span><strong>${value}</strong><small>${esc(note)}</small></div>`).join("");
  }
  const haystack = row => fold([label(row.number), row.customer, row.document, row.phone, String(row.phone || "").replace(/\D/g, ""), row.quote?.email].join(" "));
  function rowHTML({ row, status }) {
    const quote = row.quote || {}, name = label(row.number), converted = status.key === "converted", items = Array.isArray(quote.items) ? quote.items.length : 0;
    const contact = [row.document ? (DOCS[quote.docType] || "Doc.") + " " + row.document : "", row.phone].filter(Boolean).map(text => `<span>${esc(text)}</span>`).join(" · ");
    return `<tr data-id="${esc(row.id)}" data-status="${status.key}">`
      + `<td class="quote-number" data-label="Cotización"><button type="button" class="quote-link" data-quote-action="open" aria-label="Abrir la cotización ${name}">${name}</button><small class="quote-sub quote-sub-date">${formatDate(row.quote_date)}</small></td>`
      + `<td class="quote-date" data-label="Fecha">${formatDate(row.quote_date)}</td>`
      + `<td class="quote-client" data-label="Cliente"><button type="button" class="quote-link" data-quote-action="open" aria-label="Abrir la cotización ${name} de ${esc(row.customer)}">${esc(row.customer)}</button>${contact ? `<small>${contact}</small>` : ""}</td>`
      + `<td class="quote-valid" data-label="Válida hasta">${formatDate(row.valid_until)}</td>`
      + `<td class="quote-total num" data-label="Total"><strong>${money(row.total_cents)}</strong><small>${plural(items, "producto", "productos")}</small></td>`
      + `<td class="quote-status" data-label="Estado"><span class="pill quote-pill ${status.key}" title="${esc(status.text)}">${esc(status.pill)}</span><small class="quote-sub quote-sub-valid">Válida hasta ${formatDate(row.valid_until)}</small></td>`
      + `<td class="quote-actions"><div><button type="button" class="quiet" data-quote-action="open" aria-label="Abrir ${name}">Abrir</button>`
      + (converted ? `<button type="button" class="quiet quote-primary" data-quote-action="receipt" aria-label="Ver la boleta ${esc(status.receiptLabel)} de ${name}">Ver boleta</button>` : `<button type="button" class="quiet quote-primary" data-quote-action="convert" aria-label="Convertir ${name} en boleta">Convertir en boleta</button>`)
      + `<button type="button" class="quiet quote-icon" data-quote-action="duplicate" title="Duplicar" aria-label="Duplicar ${name}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/></svg></button><button type="button" class="quiet danger quote-icon" data-quote-action="delete" title="Eliminar" aria-label="Eliminar la cotización ${name}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/></svg></button></div></td></tr>`;
  }

  // ---------- Editor (iframe cotizacion.html) ----------
  const editorRow = row => row.valid_until !== undefined || row.quote_date !== undefined ? toRow(row) : structuredClone(row);
  async function openEditor(row = null, options = {}) {
    if (!db) return false;
    if (state === "missing") { await app()?.showView("quotes"); return false; }
    // Se guarda la orden hasta que el editor avise que está listo (frameReady).
    pendingOpen = { row: row ? editorRow(row) : null, options: { duplicate: options?.duplicate === true } };
    await goTo("quoteEditor");
    const frame = $("quoteFrame");
    if (!frame.getAttribute("src")) { editorReady = false; frame.src = "cotizacion.html"; } else flushEditor();
    return true;
  }
  function flushEditor() {
    if (!editorReady || !pendingOpen) return;
    const editor = $("quoteFrame").contentWindow;
    if (typeof editor?.openQuote !== "function") { editorReady = false; return; }
    const { row, options } = pendingOpen; pendingOpen = null;
    try { editor.openQuote(row, options); } catch (error) { message(errorText(error)); }
  }
  // Total en céntimos (mismas reglas que el editor); null si algún precio o cantidad no es válido.
  function quoteTotal(quote) {
    const items = Array.isArray(quote.items) ? quote.items : []; let total = 0;
    if (!items.length || items.length > 100) return null;
    for (const item of items) {
      const price = String(item?.price ?? "").trim(), quantity = String(item?.quantity ?? "").trim();
      if (!/^\d{1,9}([.,]\d{1,2})?$/.test(price) || !/^\d{1,4}$/.test(quantity) || Number(quantity) < 1) return null;
      const [whole, decimals = ""] = price.split(/[.,]/); total += (Number(whole) * 100 + Number(decimals.padEnd(2, "0"))) * Number(quantity);
    }
    return Number.isSafeInteger(total) && total <= MAX_CENTS ? total : null;
  }
  const setupText = () => member?.role === "owner" ? "Activa las cotizaciones: abre Supabase → SQL Editor, pega el contenido de database/quotes.sql y pulsa Run." : "Pídele al administrador que active las cotizaciones.";
  function saveError(error) {
    if (error?.code === "23514" || error?.code === "22007" || error?.code === "22008") return "La cotización tiene datos que no se pueden guardar (cliente, fechas o total). Revísalos e inténtalo otra vez.";
    if (error?.code === "42501" || /permission denied|row-level security/i.test(error?.message || "")) return "Tu cuenta no tiene permiso para guardar cotizaciones. Pídele acceso al administrador.";
    return errorText(error);
  }
  async function save(quote, id) {
    const client = db, current = generation;
    if (!client) throw Error("Tu sesión terminó. Vuelve a ingresar para guardar la cotización.");
    if (typeof id !== "string" || !UUID.test(id) || !quote || typeof quote !== "object" || Array.isArray(quote)) throw Error("No se pudo guardar la cotización: datos incompletos.");
    const existing = rows.find(r => r.id === id);
    if (existing && statusOf(existing).key === "converted") throw Error("Esta cotización ya se convirtió en boleta. Duplícala para cambiar precios.");
    const customer = String(quote.customer ?? "").replace(/\s+/g, " ").trim(), total = quoteTotal(quote);
    if (!customer || customer.length > 110) throw Error("Revisa el nombre del cliente.");
    if (total === null) throw Error("Revisa las cantidades y los precios de la cotización.");
    if (!ISO.test(String(quote.date)) || !ISO.test(String(quote.validUntil))) throw Error("Revisa la fecha y la validez de la cotización.");
    // Nunca se envían number, receipt_id ni created_*: los asigna la base.
    const record = { id, quote, customer, document: String(quote.document ?? "").trim().slice(0, 20), phone: String(quote.phone ?? "").trim().slice(0, 20), total_cents: total, quote_date: quote.date, valid_until: quote.validUntil };
    const { data, error } = await client.from("ao_quotes").upsert(record, { onConflict: "id" }).select(COLUMNS).single();
    if (current !== generation) throw Error("Tu sesión cambió. Vuelve a ingresar.");
    if (error) { if (isMissing(error)) { rows = []; receipts = new Map(); state = "missing"; render(); throw Error(setupText()); } throw Error(saveError(error)); }
    if (!data || data.id !== id) throw Error("El servidor no confirmó la cotización. Inténtalo otra vez.");
    const index = rows.findIndex(r => r.id === id); if (index >= 0) rows[index] = data; else rows.unshift(data);
    if (state !== "ready" && state !== "loading") state = "ready";
    render(); return toRow(data);
  }
  async function viewReceipt(id) {
    let row = rows.find(r => r.id === id), receipt = row && statusOf(row).receipt;
    if (!receipt) { await load(); row = rows.find(r => r.id === id); receipt = row && statusOf(row).receipt; }
    if (!receipt) throw Error("La boleta de esta cotización ya no existe. Revisa «Boletas emitidas».");
    const current = generation;
    await goTo("editor");
    const frame = await receiptWindow("loadCloudReceipt");
    if (current === generation) frame.loadCloudReceipt(receipt.payload, receipt.id);
  }
  // Espera a que el generador de boletas (iframe) termine de cargar.
  async function receiptWindow(name) {
    for (let i = 0; i < 100; i++) { const frame = $("receiptFrame").contentWindow; if (typeof frame?.[name] === "function") return frame; await new Promise(resolve => setTimeout(resolve, 120)); }
    throw Error("El generador de boletas se está cargando. Inténtalo en un momento.");
  }
  async function convertFromEditor(id) {
    await load();
    const row = rows.find(r => r.id === id);
    if (!row) throw Error(state === "missing" ? setupText() : "Guarda la cotización antes de convertirla en boleta.");
    if (statusOf(row).key === "converted") throw Error("Esta cotización ya se convirtió en boleta.");
    openConvert(row);
  }
  function createHost() {
    window.AOQuoteHost = Object.freeze({
      userId: String(member?.user_id || ""),
      pickProducts: (item, index) => window.AOSuite.pickInventory(item, index, { mode: "quote" }),
      quoteStock: parts => window.AOSuite.quoteStock(parts),
      clients: () => window.AOSuite.clientsList(),
      save, convert: convertFromEditor, viewReceipt, label,
      back: () => { message(""); app()?.showView("quotes"); },
      saved: () => render(),
      frameReady: () => { editorReady = true; flushEditor(); }
    });
  }

  // ---------- Convertir en boleta ----------
  function convertControls(disabled) { for (const id of ["convertQuoteCancel", "convertQuoteClose"]) $(id).disabled = disabled; }
  function closeConvert() { if (convertState?.busy) return; convertState = null; convertControls(false); if ($("convertQuoteDialog").open) $("convertQuoteDialog").close(); }
  function openConvert(row) {
    if (convertState?.busy || !db) return;
    if (statusOf(row).key === "converted") { viewReceipt(row.id).catch(error => message(errorText(error))); return; }
    const target = { row, generation, result: null, busy: false, checking: false };
    convertState = target; convertControls(false);
    $("convertQuoteSummary").innerHTML = `<strong>${label(row.number)}</strong> · ${esc(row.customer)} · <strong>${money(row.total_cents)}</strong>`;
    if (!$("convertQuoteDialog").open) $("convertQuoteDialog").showModal();
    check(target);
  }
  async function check(target) {
    target.checking = true; target.result = null;
    $("convertQuoteProgress").hidden = false; $("convertQuoteResult").replaceChildren(); $("convertQuoteMessage").textContent = "";
    $("convertQuoteConfirm").disabled = true; $("convertQuoteConfirm").textContent = "Abrir la boleta";
    try {
      // Elige unidades reales de tu stock para cada producto cotizado (no descuenta nada hasta emitir).
      const result = await window.AOSuite.prepareQuoteSale(structuredClone(target.row.quote?.items || []));
      if (convertState !== target) return;
      if (!result || !Array.isArray(result.items) || !result.items.length) throw Error("No se pudo preparar la boleta. Inténtalo otra vez.");
      target.result = result; renderResult(target);
    } catch (error) {
      if (convertState !== target) return;
      $("convertQuoteMessage").textContent = errorText(error); $("convertQuoteConfirm").textContent = "Volver a revisar";
    } finally {
      if (convertState === target) { target.checking = false; $("convertQuoteProgress").hidden = true; $("convertQuoteConfirm").disabled = false; $("convertQuoteConfirm").focus(); }
    }
  }
  function renderResult({ row, result }) {
    const notices = Array.isArray(result.notices) ? result.notices : [], changes = Array.isArray(result.changes) ? result.changes : [];
    const external = result.items.some(item => (item.inventory || []).some(part => part.source === "external"));
    const list = changes.length ? `<ul class="convert-changes">${changes.map(c => `<li><span>${esc(c.name)}</span><strong>${Number(c.before)} → ${Number(c.after)}</strong></li>`).join("")}</ul>` : "";
    let html = "";
    if (daysBetween(limaDate(), row.valid_until) < 0) html += `<div class="convert-box expired"><p>Esta cotización venció el ${formatDate(row.valid_until)}: revisa los precios antes de emitir.</p></div>`;
    if (result.ready && !notices.length) html += `<div class="convert-box ok"><p><strong>${changes.length ? "Todo está en tu stock." : "Todo está listo."}</strong> ${changes.length ? "Al emitir la boleta tu stock bajará:" : "Ningún producto sale de tu stock."}</p>${list}${external ? '<p class="convert-note">Los productos a pedido se venden sin descontar stock.</p>' : ""}</div>`;
    else html += `<div class="convert-box warn"><p><strong>Antes de emitir, completa esto en la boleta:</strong></p><ul class="convert-notices">${notices.map(n => `<li>${esc(n.text)}</li>`).join("")}</ul></div>` + (changes.length ? `<div class="convert-box"><p>Lo que sí está en tu stock bajará al emitir la boleta:</p>${list}</div>` : "");
    html += '<p class="hint convert-hint">Se abrirá un borrador de boleta con el cliente y los productos. Tu stock cambia recién cuando pulses «Emitir y descargar».</p>';
    $("convertQuoteResult").innerHTML = html;
  }
  async function confirmConvert() {
    const target = convertState; if (!target || target.busy || target.checking) return;
    if (!target.result) return check(target);
    const { row, result } = target, client = db, receiptId = crypto.randomUUID(), previous = row.receipt_id ?? null, name = label(row.number);
    target.busy = true; convertControls(true); $("convertQuoteConfirm").disabled = true; $("convertQuoteConfirm").textContent = "Abriendo la boleta…"; $("convertQuoteMessage").textContent = "";
    try {
      // La boleta se emitirá con este id: así la cotización se muestra «Convertida» cuando exista.
      const { data, error } = await client.from("ao_quotes").update({ receipt_id: receiptId }).eq("id", row.id).select("id,receipt_id").single();
      if (error) throw error.code === "PGRST116" ? Error("Esta cotización ya no existe. Pulsa «Actualizar».") : error;
      if (data?.receipt_id !== receiptId) throw Error("No se pudo vincular la cotización con su boleta. Inténtalo otra vez.");
    } catch (error) {
      target.busy = false;
      if (convertState === target) { convertControls(false); $("convertQuoteConfirm").disabled = false; $("convertQuoteConfirm").textContent = "Abrir la boleta"; $("convertQuoteMessage").textContent = errorText(error); }
      // Si otra persona ya emitió su boleta, la lista lo muestra al actualizarse (la base no permite una segunda boleta).
      if (target.generation === generation) load().catch(() => {});
      return;
    }
    target.busy = false;
    if (target.generation !== generation) return;
    row.receipt_id = receiptId;
    const quote = row.quote || {}, doc = String(quote.document ?? row.document ?? "").trim(), receipt = { customer: quote.customer ?? row.customer, docType: doc ? quote.docType : "NONE", document: doc, address: quote.address || "", email: quote.email || "", items: structuredClone(result.items) };
    if (convertState === target) closeConvert();
    await goTo("editor");
    let accepted;
    try { const frame = await receiptWindow("loadQuoteSale"); if (target.generation !== generation) return; accepted = frame.loadQuoteSale(receipt, receiptId, name); }
    catch (error) { unlink(row, receiptId, previous); message(errorText(error)); return; }
    if (accepted === false) unlink(row, receiptId, previous);
  }
  // La boleta no se abrió (se conservó el borrador anterior): la cotización vuelve a su vínculo anterior.
  function unlink(row, receiptId, previous) {
    if (row.receipt_id === receiptId) row.receipt_id = previous;
    if (db) Promise.resolve(db.from("ao_quotes").update({ receipt_id: previous }).eq("id", row.id).eq("receipt_id", receiptId)).catch(() => {});
  }

  // ---------- Eliminar ----------
  const DELETE_CONTROLS = ["deleteQuoteConfirm", "deleteQuoteCancel", "deleteQuoteClose"];
  function resetDelete() { for (const id of DELETE_CONTROLS) $(id).disabled = false; $("deleteQuoteConfirm").textContent = "Sí, eliminar cotización"; }
  function openDelete(row) {
    if (deleteState) return;
    deleteState = { row, generation, busy: false }; resetDelete();
    $("deleteQuoteSummary").textContent = label(row.number) + " · " + row.customer; $("deleteQuoteMessage").textContent = "";
    $("deleteQuoteDialog").showModal(); $("deleteQuoteCancel").focus();
  }
  function closeDelete() { if (deleteState?.busy) return; deleteState = null; resetDelete(); if ($("deleteQuoteDialog").open) $("deleteQuoteDialog").close(); }
  async function confirmDelete() {
    const target = deleteState; if (!target || target.busy || !db) return;
    const { row } = target;
    target.busy = true; for (const id of DELETE_CONTROLS) $(id).disabled = true; $("deleteQuoteConfirm").textContent = "Eliminando…"; $("deleteQuoteMessage").textContent = "";
    try {
      const { error } = await db.from("ao_quotes").delete().eq("id", row.id);
      if (error) throw error;
      target.busy = false;
      if (target.generation !== generation) return;
      rows = rows.filter(r => r.id !== row.id); render(); closeDelete();
      toast("Cotización " + label(row.number) + " eliminada.");
    } catch (error) {
      target.busy = false;
      if (deleteState === target) { resetDelete(); $("deleteQuoteMessage").textContent = errorText(error); }
    }
  }

  // ---------- Sesión ----------
  function initialize(client, person) { logout(); db = client; member = person; createHost(); render(); }
  async function show() { if (!db) return; render(); return load(); }
  function logout() {
    ++generation; ++ticket; db = null; member = null; rows = []; receipts = new Map(); state = "idle"; loadError = ""; filter = "all";
    pendingOpen = null; editorReady = false; deleteState = null; convertState = null; resetDelete(); convertControls(false);
    for (const id of ["deleteQuoteDialog", "convertQuoteDialog"]) if ($(id).open) $(id).close();
    const frame = $("quoteFrame");
    if (frame.getAttribute("src")) { frame.removeAttribute("src"); try { frame.contentWindow?.location.replace("about:blank"); } catch {} }
    delete window.AOQuoteHost; $("quotesSearch").value = ""; render();
  }

  $("newQuote").addEventListener("click", () => { message(""); openEditor(null); });
  $("refreshQuotes").addEventListener("click", async () => { const button = $("refreshQuotes"); button.disabled = true; message(""); try { await load(); } catch (error) { message(errorText(error)); } finally { button.disabled = false; } });
  $("quotesSearch").addEventListener("input", render);
  document.querySelectorAll("[data-quote-filter]").forEach(b => b.addEventListener("click", () => { filter = b.dataset.quoteFilter; render(); }));
  $("quotesRows").addEventListener("click", event => {
    const button = event.target.closest("[data-quote-action]"), row = button && rows.find(r => r.id === button.closest("tr")?.dataset.id);
    if (!row) return;
    message("");
    const action = button.dataset.quoteAction, fail = error => message(errorText(error));
    if (action === "open") openEditor(row).catch(fail);
    else if (action === "duplicate") openEditor(row, { duplicate: true }).catch(fail);
    else if (action === "convert") openConvert(row);
    else if (action === "receipt") viewReceipt(row.id).catch(fail);
    else if (action === "delete") openDelete(row);
  });
  $("quotesEmpty").addEventListener("click", event => {
    if (event.target.closest("[data-quote-new]")) openEditor(null);
    else if (event.target.closest("[data-quote-clear]")) { filter = "all"; $("quotesSearch").value = ""; render(); $("quotesSearch").focus(); }
    else if (event.target.closest("[data-quote-retry]")) $("refreshQuotes").click();
  });
  $("convertQuoteConfirm").addEventListener("click", confirmConvert);
  for (const id of ["convertQuoteCancel", "convertQuoteClose"]) $(id).addEventListener("click", closeConvert);
  $("convertQuoteDialog").addEventListener("cancel", event => { event.preventDefault(); closeConvert(); });
  $("deleteQuoteForm").addEventListener("submit", event => { event.preventDefault(); confirmDelete(); });
  for (const id of ["deleteQuoteCancel", "deleteQuoteClose"]) $(id).addEventListener("click", closeDelete);
  $("deleteQuoteDialog").addEventListener("cancel", event => { event.preventDefault(); closeDelete(); });
  $("quoteFrame").addEventListener("load", () => { if (!$("quoteFrame").getAttribute("src")) editorReady = false; });
  window.AOQuotes = { initialize, show, logout, openEditor };
})();

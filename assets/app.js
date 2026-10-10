"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const config = window.AO_CONFIG;
  if (!config || !window.supabase) { $("entryMessage").textContent = "No se pudo cargar la aplicación. Recarga la página."; return; }
  const client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "ao-nexus-auth-v1" } });
  let member = null, user = null, historyPage = 0, historyTotal = 0, historyTimer, initializing = false, authGeneration = 0;
  let activationToken = new URLSearchParams(location.hash.slice(1)).get("activar") || "";
  if (activationToken) { history.replaceState(null, "", location.pathname + location.search); $("loginForm").hidden = true; $("activationForm").hidden = false; $("entryTitle").textContent = "Activa AO Nexus"; $("entrySubtitle").textContent = "Configura tu acceso de administrador una sola vez."; }
  function message(id, text, success = false) { const e = $(id); e.textContent = text; e.classList.toggle("success", success); }
  function globalMessage(text) { $("globalMessage").textContent = text; $("globalMessage").hidden = !text; }
  function errorText(error) { return error?.message || "No se pudo completar la operación. Revisa tu conexión."; }
  async function api(action, payload = {}) {
    const { data: { session } } = await client.auth.getSession();
    const response = await fetch(config.supabaseUrl + "/functions/v1/" + config.functionName, { method: "POST", headers: { "Content-Type": "application/json", apikey: config.publishableKey, ...(session ? { Authorization: "Bearer " + session.access_token } : {}) }, body: JSON.stringify({ action, ...payload }), cache: "no-store" });
    let data; try { data = await response.json(); } catch { throw Error("El servidor no respondió. Revisa tu conexión."); }
    if (!response.ok) { const error = Error(data.error || "No se pudo completar la operación."); error.code = data.code; throw error; }
    return data;
  }
  async function rpc(name, args) { const { data, error } = await client.rpc(name, args); if (error) throw error; return data; }
  function showLogin() { ++authGeneration; member = null; user = null; delete window.AOCloud; $("appView").hidden = true; $("loginView").hidden = false; $("receiptFrame").removeAttribute("src"); $("accountingFrame").removeAttribute("src"); window.AOSuite?.logout(); document.querySelectorAll('input[type="password"]').forEach(e=>e.value=""); $("memberPassword").value=""; $("createdCredentialsText").textContent=""; $("createdCredentials").hidden=true; globalMessage(""); }
  async function enter() {
    if (initializing) return; initializing = true; const generation = ++authGeneration;
    try {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) { if (generation === authGeneration) showLogin(); return; }
      const nextUser = data.user;
      const { data: nextMember, error: lookupError } = await client.from("ao_members").select("user_id,display_name,role,active").eq("user_id", nextUser.id).single();
      if (lookupError || !nextMember?.active) { await client.auth.signOut(); showLogin(); message("entryMessage", "Tu cuenta no tiene acceso activo a AO Nexus. Contacta al administrador."); return; }
      if (generation !== authGeneration) return;
      user = nextUser; member = nextMember;
      window.AOCloud = { userId: user.id, api, inventorySelection: (item,index) => window.AOSuite.pickInventory(item,index), issue: (id, receipt) => rpc("ao_suite_issue_receipt", { request_id: id, receipt }), ensureReceiptAvailable: async id => {
        const { data, error } = await client.from("ao_receipts").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
        if (error) throw error;
        if (!data) throw Error("Esta boleta fue eliminada. Actualiza el historial y crea una nueva con los datos correctos.");
      }, nextNumber: series => rpc("ao_next_number", { series_name: series }), upload: async (id, bytes) => {
        const path = "receipts/" + id + ".pdf";
        const { error: uploadError } = await client.storage.from("ao-boletas").upload(path, bytes, { contentType: "application/pdf", upsert: true });
        if (uploadError) throw uploadError;
        const { error: updateError } = await client.from("ao_receipts").update({ pdf_path: path }).eq("id", id);
        if (updateError) throw updateError;
      }, saved: () => { historyPage = 0; window.AOSuite.refreshAfterMutation().catch(()=>{}); $("accountingFrame").contentWindow?.refreshFromSuite?.(); } };
      $("userName").textContent = member.display_name; $("accountEmail").textContent = user.email; $("teamNav").hidden = member.role !== "owner";
      $("loginView").hidden = true; $("appView").hidden = false; $("loginPassword").value = "";
      if (!$("receiptFrame").getAttribute("src")) $("receiptFrame").src = "boletas.html";
      await window.AOSuite.initialize(client,member); const initialView=new URLSearchParams(location.search).get("vista"); await showView(["catalog","compras","inventario","editor","clients","ventas"].includes(initialView)?initialView:"dashboard");
    } catch (error) { if (generation === authGeneration) message("entryMessage", errorText(error)); }
    finally { initializing = false; }
  }
  async function showView(name) {
    if (name === "team" && member?.role !== "owner") return;
    document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === name));
    const accounting = ["dashboard","compras","inventario","ventas"].includes(name); for (const view of ["editor", "history", "team", "account", "catalog", "clients", "connection", "accounting"]) $(view + "View").hidden = view === "accounting" ? !accounting : view !== name; window.AOSuite.navigate(name);
    try { if (name === "history") await loadHistory(); if (name === "team") { await loadTeam(); $("nextNumber").value = String(await rpc("ao_next_number", { series_name: $("numberSeries").value })); } }
    catch (error) { globalMessage(errorText(error)); }
  }
  document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => { globalMessage(""); showView(b.dataset.view); }));
  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault(); const button = $("loginButton"); button.disabled = true; message("entryMessage", "");
    try { const { error } = await client.auth.signInWithPassword({ email: $("loginEmail").value.trim(), password: $("loginPassword").value }); if (error) throw error; await enter(); }
    catch (error) { message("entryMessage", error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : errorText(error)); }
    finally { button.disabled = false; }
  });
  $("activationForm").addEventListener("submit", async e => {
    e.preventDefault(); const button = e.currentTarget.querySelector("button");
    if ($("ownerPassword").value !== $("ownerPasswordAgain").value) { message("entryMessage", "Las contraseñas no coinciden."); return; }
    button.disabled = true; message("entryMessage", "Activando tu acceso…");
    try {
      await api("activate", { token: activationToken, name: $("ownerName").value.trim(), password: $("ownerPassword").value }); activationToken = "";
      const { error } = await client.auth.signInWithPassword({ email: config.businessEmail, password: $("ownerPassword").value });
      $("ownerPassword").value = ""; $("ownerPasswordAgain").value = "";
      $("activationForm").hidden = true; $("loginForm").hidden = false; $("loginEmail").value = config.businessEmail;
      if (error) { message("entryMessage", "Tu cuenta ya está creada. Ingresa con la contraseña que acabas de elegir.", true); return; }
      await enter();
    } catch (error) { message("entryMessage", errorText(error)); }
    finally { button.disabled = false; }
  });
  $("logoutButton").addEventListener("click", async () => { const { error } = await client.auth.signOut(); if (error) globalMessage(errorText(error)); else showLogin(); });
  async function deleteReceipt(row, button) {
    if (button.disabled) return;
    const confirmed = confirm("¿Eliminar la boleta " + row.series + "-" + row.number + " de " + row.customer + "?\n\nSe quitará del historial y de las ventas. Las unidades vinculadas volverán al inventario y se actualizará la ganancia.\n\nEl número no se reutilizará. Los PDF descargados y correos ya enviados seguirán en poder de sus destinatarios.");
    if (!confirmed) return;
    button.disabled = true; globalMessage("");
    try {
      const result = await rpc("ao_suite_delete_receipt", { receipt_key: row.id });
      $("receiptFrame").contentWindow?.resetDeletedReceipt?.(row.id);
      historyPage = Math.min(historyPage, Math.max(0, Math.ceil((historyTotal - 1) / 50) - 1));
      const updates = await Promise.allSettled([loadHistory(), window.AOSuite.refreshAfterMutation(), $("accountingFrame").contentWindow?.refreshFromSuite?.()]);
      const restored = Number(result.restored_units || 0);
      globalMessage("Boleta " + row.series + "-" + row.number + " eliminada." + (restored ? " " + restored + (restored === 1 ? " unidad volvió" : " unidades volvieron") + " al inventario." : "") + (updates.some(r => r.status === "rejected") ? " Pulsa Actualizar para recargar los datos." : ""));
    } catch (error) { globalMessage(errorText(error)); }
    finally { button.disabled = false; }
  }
  async function loadHistory() {
    $("historyRows").replaceChildren(); $("historyEmpty").hidden = true; $("historyCount").textContent = "Cargando…";
    let query = client.from("ao_receipts").select("id,series,number,date,customer,total_cents,pdf_path,payload,ao_deliveries(state)", { count: "exact" }).is("deleted_at", null).order("created_at", { ascending: false }).range(historyPage * 50, historyPage * 50 + 49);
    const term = $("historySearch").value.trim().replace(/[^\p{L}\p{N}\s-]/gu, "").slice(0, 80);
    if (term) query = query.or("customer.ilike.*" + term + "*,number.ilike.*" + term + "*");
    const { data, error, count } = await query; if (error) throw error;
    historyTotal = count || 0; $("historyCount").textContent = historyTotal + (historyTotal === 1 ? " boleta" : " boletas"); $("historyEmpty").hidden = data.length > 0;
    for (const row of data) {
      const tr = document.createElement("tr");
      for (const value of [row.series + "-" + row.number, row.date.split("-").reverse().join("/"), row.customer, "S/ " + (row.total_cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })]) { const td = document.createElement("td"); td.textContent = value; tr.append(td); }
      const tdStatus = document.createElement("td"), pill = document.createElement("span"); const states = row.ao_deliveries || []; const sent = states.some(d => d.state === "sent");
      pill.className = "pill" + (sent ? " sent" : ""); pill.textContent = sent ? "Enviado" : states.some(d => ["pending", "unknown"].includes(d.state)) ? "Por confirmar" : states.length ? "Pendiente" : "Sin envío"; tdStatus.append(pill); tr.append(tdStatus);
      const actions = document.createElement("td"); const open = document.createElement("button"); open.type = "button"; open.className = "quiet"; open.textContent = "Ver boleta";
      open.addEventListener("click", async () => { await showView("editor"); const frame = $("receiptFrame").contentWindow; if (typeof frame?.loadCloudReceipt !== "function") { globalMessage("El generador se está cargando. Inténtalo en un momento."); return; } frame.loadCloudReceipt(row.payload, row.id); }); actions.append(open);
      if (row.pdf_path) { const pdf = document.createElement("button"); pdf.className = "quiet"; pdf.textContent = "PDF"; pdf.addEventListener("click", async () => {
        pdf.disabled = true; try { const { data: file, error: downloadError } = await client.storage.from("ao-boletas").download(row.pdf_path); if (downloadError) throw downloadError; const url = URL.createObjectURL(file), a = document.createElement("a"); a.href = url; a.download = "Boleta-" + row.series + "-" + row.number + ".pdf"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); } catch (error) { globalMessage(errorText(error)); } finally { pdf.disabled = false; }
      }); actions.append(pdf); }
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "quiet danger"; remove.textContent = "Eliminar";
      remove.setAttribute("aria-label", "Eliminar boleta " + row.series + "-" + row.number);
      remove.addEventListener("click", () => deleteReceipt(row, remove)); actions.append(remove);
      tr.append(actions); $("historyRows").append(tr);
    }
    $("previousHistory").disabled = historyPage === 0; $("nextHistory").disabled = (historyPage + 1) * 50 >= historyTotal; $("historyPage").textContent = "Página " + (historyPage + 1) + " de " + Math.max(1, Math.ceil(historyTotal / 50));
  }
  const reloadHistory = () => loadHistory().catch(error => { $("historyCount").textContent = ""; globalMessage(errorText(error)); });
  $("refreshHistory").addEventListener("click", reloadHistory);
  $("historySearch").addEventListener("input", () => { historyPage = 0; clearTimeout(historyTimer); historyTimer = setTimeout(reloadHistory, 300); });
  $("previousHistory").addEventListener("click", () => { if (historyPage > 0) { historyPage--; reloadHistory(); } });
  $("nextHistory").addEventListener("click", () => { if ((historyPage + 1) * 50 < historyTotal) { historyPage++; reloadHistory(); } });
  async function loadTeam() {
    const { data, error } = await client.from("ao_members").select("user_id,display_name,role,active").order("created_at"); if (error) throw error;
    $("memberList").replaceChildren();
    for (const person of data) {
      const item = document.createElement("div"); item.className = "member"; const info = document.createElement("div"), name = document.createElement("strong"), details = document.createElement("small");
      name.textContent = person.display_name; details.textContent = person.role === "owner" ? "Administrador" : person.active ? "Acceso activo" : "Acceso desactivado"; info.append(name, details); item.append(info);
      if (person.role !== "owner") { const toggle = document.createElement("button"); toggle.className = "secondary"; toggle.textContent = person.active ? "Desactivar" : "Activar"; toggle.addEventListener("click", async () => { toggle.disabled = true; try { await api("member-state", { userId: person.user_id, active: !person.active }); await loadTeam(); } catch (error) { message("memberMessage", errorText(error)); toggle.disabled = false; } }); item.append(toggle); }
      $("memberList").append(item);
    }
  }
  $("generatePassword").addEventListener("click", () => { const chars="abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!"; const bytes = crypto.getRandomValues(new Uint8Array(18)); $("memberPassword").value = Array.from(bytes, n => chars[n % chars.length]).join(""); $("memberPassword").type = "text"; });
  $("memberForm").addEventListener("submit", async e => {
    e.preventDefault(); const button = e.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; message("memberMessage", "Creando acceso…");
    try { const email=$("memberEmail").value.trim(), password=$("memberPassword").value; await api("create-member", { name: $("memberName").value.trim(), email, password }); $("createdCredentialsText").textContent="AO Nexus Boletas\n"+location.origin+location.pathname+"\nCorreo: "+email+"\nContraseña inicial: "+password; $("createdCredentials").hidden=false; $("memberForm").reset(); $("memberPassword").type = "password"; message("memberMessage", "Acceso creado. Tu socio ya puede ingresar.", true); await loadTeam(); }
    catch (error) { message("memberMessage", errorText(error)); } finally { button.disabled = false; }
  });
  $("copyCredentials").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("createdCredentialsText").textContent);message("memberMessage","Acceso copiado.",true);}catch{message("memberMessage","Selecciona y copia los datos del acceso.");}});
  $("clearCredentials").addEventListener("click",()=>{$("createdCredentialsText").textContent="";$("createdCredentials").hidden=true;});
  $("numberSeries").addEventListener("change", async () => { try { $("nextNumber").value = String(await rpc("ao_next_number", { series_name: $("numberSeries").value.toUpperCase() })); } catch (error) { message("numberingMessage", errorText(error)); } });
  $("numberingForm").addEventListener("submit", async e => { e.preventDefault(); const button = e.currentTarget.querySelector("button"); button.disabled = true; try { await api("numbering", { series: $("numberSeries").value.toUpperCase(), number: $("nextNumber").value }); message("numberingMessage", "Numeración guardada para todo el equipo.", true); } catch (error) { message("numberingMessage", errorText(error)); } finally { button.disabled = false; } });
  $("passwordForm").addEventListener("submit", async e => {
    e.preventDefault(); if ($("newPassword").value !== $("newPasswordAgain").value) { message("passwordMessage", "Las contraseñas no coinciden."); return; }
    const button = e.currentTarget.querySelector("button"); button.disabled = true;
    try { const { error } = await client.auth.updateUser({ password: $("newPassword").value, currentPassword: $("currentPassword").value }); if (error) throw error; $("passwordForm").reset(); message("passwordMessage", "Contraseña actualizada.", true); } catch (error) { message("passwordMessage", errorText(error)); } finally { button.disabled = false; }
  });
  client.auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") showLogin(); });
  if (!activationToken) enter();
})();

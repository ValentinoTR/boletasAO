// Escanear stock: el código de barras o QR de la caja identifica el producto y abre «Reponer» con 1 unidad.
// Lee con la cámara (lector del navegador o, si no lo tiene, ZXing) o con un lector USB, que escribe el código como un teclado.
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const plural = (n, one, many) => n === 1 ? one : many;
  const units = n => `${n} ${plural(n, "unidad", "unidades")}`;
  const core = window.AOSuiteCore, suite = () => window.AOSuite?.scan;
  const ZXING = "assets/zxing-0.21.3.min.js";
  const FORMATS = ["ean_13","ean_8","upc_a","upc_e","code_128","code_39","code_93","itf","codabar","qr_code","data_matrix"];
  const normal = text => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");
  let filter = "available", camera = null, cameraRun = 0, pendingCode = "", zxingLoading = null;

  // ---------- Lista de tu stock ----------
  function render() {
    const api = suite();
    if (!api || !api.ready()) {
      $("scanSummary").textContent = "";
      $("scanList").innerHTML = `<p class="empty">${esc(api?.error() || "Cargando tu stock…")}</p>`;
      return;
    }
    const all = api.products(), term = normal($("scanSearch").value.trim());
    document.querySelectorAll("[data-scan-filter]").forEach(b => { const on = b.dataset.scanFilter === filter; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
    const inStock = all.filter(p => p.stock > 0);
    $("scanSummary").innerHTML = [["Productos con stock", inStock.length], ["Unidades disponibles", inStock.reduce((n, p) => n + p.stock, 0)], ["Con código vinculado", all.filter(p => p.barcodes.length).length]]
      .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
    const list = (filter === "available" ? inStock : all)
      .filter(p => !term || normal(p.name + " " + p.brand + " " + p.barcodes.join(" ")).includes(term))
      .sort((a, b) => b.stock - a.stock || a.name.localeCompare(b.name, "es"));
    $("scanList").innerHTML = list.length ? list.map(p => `<article class="scan-row"><div class="scan-row-copy"><strong>${esc(p.name)}</strong><span>${esc([p.brand, p.barcodes.length ? plural(p.barcodes.length, "1 código", p.barcodes.length + " códigos") : "Sin código"].filter(Boolean).join(" · "))}</span></div><span class="pill ${p.stock ? "sent" : "replenish-pill"}">${p.stock ? units(p.stock) : "Sin stock"}</span><button type="button" class="secondary" data-scan-add="${esc(p.id)}" aria-label="Sumar unidades de ${esc(p.name)}">Sumar</button></article>`).join("")
      : `<p class="empty">${filter === "available" && !term ? "Aún no tienes productos en stock. Escanea una caja o pulsa «Todos»." : "Ningún producto coincide con tu búsqueda."}</p>`;
  }

  // ---------- Qué hacer con un código ----------
  function result(html, kind = "") { const box = $("scanResult"); box.className = "scan-result" + (kind ? " " + kind : ""); box.innerHTML = html; box.hidden = !html; }
  async function handleCode(raw) {
    const code = core.barcodeKey(raw), api = suite();
    $("scanCode").value = "";
    if (!code) { result("<p>No se leyó un código válido. Vuelve a intentarlo.</p>", "problem"); return; }
    if (!api) return;
    if (!api.ready()) { result("<p>Cargando tu stock…</p>"); try { await api.refresh(); } catch { result(`<p>${esc(api.error() || "No se pudo cargar tu stock. Revisa tu conexión.")}</p>`, "problem"); return; } }
    const found = api.find(code);
    if (found) { restock(found.id, code); return; }
    pendingCode = code; showUnknown("");
  }
  function restock(productId, code) {
    const api = suite(), product = api.products().find(p => String(p.id) === String(productId));
    if (!product) { result("<p>Ese producto ya no existe. Actualiza la lista.</p>", "problem"); return; }
    pendingCode = "";
    let opened = false;
    try { opened = api.restock(product.id, saved => showSaved(product.name, saved.quantity)); } catch (error) { result(`<p>${esc(error.message)}</p>`, "problem"); return; }
    if (opened) result(`<p><strong>${esc(product.name)}</strong>${code ? ` · código ${esc(code)}` : ""}</p><p>Tienes ${units(product.stock)}. Indica cuántas llegaron y pulsa Guardar.</p>`);
  }
  function showSaved(name, quantity) {
    result(`<p><strong>Listo: ${esc(name)} ahora tiene ${units(quantity)}.</strong></p><div class="suite-actions"><button type="button" class="primary" data-scan-again>Escanear otro</button></div>`, "success");
    render(); focusCode();
  }
  function showUnknown(term) {
    const api = suite(), words = normal(term).split(/\s+/).filter(Boolean);
    const matches = api.products().filter(p => words.every(w => normal(p.name + " " + p.brand).includes(w))).sort((a, b) => a.name.localeCompare(b.name, "es")).slice(0, 8);
    const listHTML = matches.length ? matches.map(p => `<li><span>${esc(p.name)}<small>${esc(p.brand)}${p.barcodes.length ? " · ya tiene otro código" : ""}</small></span><button type="button" class="secondary" data-scan-link="${esc(p.id)}">Es este</button></li>`).join("") : "<li class=\"muted\">Ningún producto coincide. Puedes crearlo como nuevo.</li>";
    if (!$("scanPick")) {
      result(`<p><strong>El código ${esc(pendingCode)} todavía no está vinculado.</strong> Elige qué producto es: la próxima vez se reconocerá solo.</p><label for="scanPick">Buscar el producto</label><input id="scanPick" type="search" placeholder="Ej.: B850, Ryzen 7, Kingston 32GB" autocomplete="off"><ul id="scanMatches" class="scan-matches"></ul><div class="suite-actions"><button type="button" class="secondary" data-scan-new>Es un producto nuevo</button><button type="button" class="quiet" data-scan-cancel>Cancelar</button></div>`, "pending");
      $("scanPick").addEventListener("input", () => showUnknown($("scanPick").value));
      $("scanPick").focus();
    }
    $("scanMatches").innerHTML = listHTML;
  }
  function focusCode() { if (matchMedia("(pointer:fine)").matches) $("scanCode").focus(); }

  // ---------- Cámara ----------
  function cameraError(error) {
    const name = error?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError") return "No se dio permiso para usar la cámara. Permítelo en el candado junto a la dirección de la página y vuelve a intentarlo.";
    if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "No se encontró una cámara en este equipo. Escribe el código o usa un lector de códigos USB.";
    if (name === "NotReadableError" || name === "TrackStartError") return "La cámara está ocupada por otra aplicación. Ciérrala y vuelve a intentarlo.";
    return "No se pudo abrir la cámara. Escribe el código o usa un lector de códigos USB.";
  }
  function loadZXing() {
    if (window.ZXing?.BrowserMultiFormatReader) return Promise.resolve();
    return zxingLoading ||= new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = ZXING; script.async = true;
      script.onload = () => window.ZXing?.BrowserMultiFormatReader ? resolve() : reject(Error("lector"));
      script.onerror = () => { zxingLoading = null; reject(Error("lector")); };
      document.head.append(script);
    });
  }
  async function nativeFormats() {
    if (!("BarcodeDetector" in window)) return [];
    try { const supported = await window.BarcodeDetector.getSupportedFormats(); return FORMATS.filter(f => supported.includes(f)); } catch { return []; }
  }
  const constraints = { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
  async function startCamera() {
    if (camera) return;
    const run = ++cameraRun, video = $("scanVideo");
    $("scanPanel").hidden = false; $("scanStart").disabled = true; $("scanStatus").textContent = "Abriendo la cámara…";
    if (!navigator.mediaDevices?.getUserMedia) { stopCamera("Este navegador no permite usar la cámara aquí. Escribe el código o usa un lector de códigos USB."); return; }
    const found = code => { if (run !== cameraRun) return; navigator.vibrate?.(60); stopCamera(); handleCode(code); };
    try {
      const formats = await nativeFormats();
      if (run !== cameraRun) return;
      if (formats.length) {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (run !== cameraRun) { stream.getTracks().forEach(t => t.stop()); return; }
        const detector = new window.BarcodeDetector({ formats });
        let timer = 0;
        camera = { stop: () => { clearTimeout(timer); stream.getTracks().forEach(t => t.stop()); video.srcObject = null; } };
        video.srcObject = stream; video.play().catch(() => {});
        const tick = async () => {
          if (run !== cameraRun) return;
          try { const codes = video.readyState >= 2 ? await detector.detect(video) : []; const code = codes.find(c => core.barcodeKey(c.rawValue)); if (code) { found(code.rawValue); return; } } catch {}
          timer = setTimeout(tick, 180);
        };
        tick();
      } else {
        await loadZXing();
        if (run !== cameraRun) return;
        const reader = new window.ZXing.BrowserMultiFormatReader();
        camera = { stop: () => { try { reader.reset(); } catch {} video.srcObject = null; } };
        await reader.decodeFromConstraints(constraints, video, value => { if (value) found(value.getText()); });
      }
      if (run === cameraRun) $("scanStatus").textContent = "Apunta al código de barras o QR de la caja. Se lee solo.";
    } catch (error) {
      if (run === cameraRun) stopCamera(error?.message === "lector" ? "No se pudo cargar el lector de códigos. Revisa tu conexión, o escribe el código." : cameraError(error));
    }
  }
  function stopCamera(message = "") {
    ++cameraRun; const current = camera; camera = null; current?.stop();
    $("scanStart").disabled = false;
    if (message) { $("scanStatus").textContent = message; $("scanPanel").hidden = false; $("scanVideo").hidden = true; $("scanStop").textContent = "Cerrar"; }
    else { $("scanPanel").hidden = true; $("scanVideo").hidden = false; $("scanStop").textContent = "Detener cámara"; }
  }

  // ---------- Eventos ----------
  $("scanStart").addEventListener("click", () => { result(""); pendingCode = ""; $("scanVideo").hidden = false; $("scanStop").textContent = "Detener cámara"; startCamera(); });
  $("scanStop").addEventListener("click", () => stopCamera());
  $("scanCodeForm").addEventListener("submit", e => { e.preventDefault(); stopCamera(); handleCode($("scanCode").value); });
  $("scanSearch").addEventListener("input", render);
  document.querySelectorAll("[data-scan-filter]").forEach(b => b.addEventListener("click", () => { filter = b.dataset.scanFilter; render(); }));
  $("scanList").addEventListener("click", e => { const add = e.target.closest("[data-scan-add]"); if (add) { stopCamera(); restock(add.dataset.scanAdd, ""); } });
  $("scanResult").addEventListener("click", async e => {
    const link = e.target.closest("[data-scan-link]");
    if (link) {
      const code = pendingCode; link.disabled = true;
      try { const product = await suite().link(link.dataset.scanLink, code); restock(product.id, code); }
      catch (error) { link.disabled = false; result(`<p>${esc(error.message || "No se pudo vincular el código.")}</p><div class="suite-actions"><button type="button" class="secondary" data-scan-again>Volver a escanear</button></div>`, "problem"); }
      return;
    }
    if (e.target.closest("[data-scan-new]")) { suite().newProduct(pendingCode); pendingCode = ""; result(`<p>Completa el producto nuevo: su código ya quedó escrito en «Códigos de barras».</p>`); return; }
    if (e.target.closest("[data-scan-cancel]")) { pendingCode = ""; result(""); focusCode(); return; }
    if (e.target.closest("[data-scan-again]")) { result(""); $("scanStart").click(); }
  });
  // Al salir de la vista o de la página, la cámara se apaga.
  document.addEventListener("visibilitychange", () => { if (document.hidden && camera) stopCamera(); });
  window.AOScan = { render, handleCode, enter: () => { render(); focusCode(); }, leave: () => { if (camera || !$("scanPanel").hidden) stopCamera(); } };
})();

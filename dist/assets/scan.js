// Ingresar mercadería: el código de barras o QR de la caja identifica el producto y se registra la compra completa
// (unidades, costo en soles o dólares, tipo de cambio, proveedor y fecha), igual que «Nueva compra» en Compras.
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
  const soles = n => "S/ " + Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dollars = n => "US$ " + Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fine = () => matchMedia("(pointer:fine)").matches;
  // La categoría de Compras que corresponde a la de tu web (Compras no tiene una para tarjetas de video).
  const CATEGORY = { amd:"Procesador", intel:"Procesador", "placa-am5":"Placa madre", "placa-am4":"Placa madre", "placa-lga1851":"Placa madre", "placa-lga1700":"Placa madre", ddr5:"RAM", ddr4:"RAM", almacenamiento:"Almacenamiento", fuente:"Fuente de poder", "refrigeracion-liquida":"Refrigeración", "refrigeracion-aire":"Refrigeración", gabinete:"Gabinete", gpu:"Otros" };
  const MEMORY = "ao-nexus-ingreso-v1";
  const remember = () => { try { return JSON.parse(localStorage.getItem(MEMORY)) || {}; } catch { return {}; } };
  const keep = value => { try { localStorage.setItem(MEMORY, JSON.stringify({ ...remember(), ...value })); } catch {} };
  const today = () => { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const get = t => parts.find(p => p.type === t).value; return `${get("year")}-${get("month")}-${get("day")}`; };
  // Como el texto bajo el código de barras de la caja: 4 711387 912345.
  const showCode = code => /^\d{13}$/.test(code) ? `${code[0]} ${code.slice(1, 7)} ${code.slice(7)}` : /^\d{8}$/.test(code) ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
  // El código de barras EAN-13 de la caja, dibujado con sus barras reales.
  const EAN_L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
  const EAN_G = EAN_L.map(p => [...p].reverse().map(b => b === "1" ? "0" : "1").join("")), EAN_R = EAN_L.map(p => [...p].map(b => b === "1" ? "0" : "1").join(""));
  const EAN_PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
  function eanSVG(code) {
    if (!/^\d{13}$/.test(code)) return "";
    const d = [...code].map(Number), bits = "101" + d.slice(1, 7).map((n, i) => (EAN_PARITY[d[0]][i] === "L" ? EAN_L : EAN_G)[n]).join("") + "01010" + d.slice(7).map(n => EAN_R[n]).join("") + "101";
    const guard = i => i < 3 || (i >= 45 && i < 50) || i >= 92;
    let bars = ""; for (let i = 0; i < bits.length; i++) if (bits[i] === "1") bars += `<rect x="${i}" width="1" height="${guard(i) ? 40 : 35}"/>`;
    return `<svg viewBox="0 0 95 40" preserveAspectRatio="none" aria-hidden="true" fill="currentColor">${bars}</svg>`;
  }
  let filter = "available", camera = null, cameraRun = 0, pendingCode = "", zxingLoading = null, current = null, saving = false, lastSupplier = "";
  const log = [];

  // ---------- Tu stock ----------
  function render() {
    const api = suite();
    if (!api || !api.ready()) {
      $("scanSummary").textContent = "";
      $("scanList").innerHTML = `<li class="receive-empty">${esc(api?.error() || "Cargando tu stock…")}</li>`;
      return;
    }
    const all = api.products(), term = normal($("scanSearch").value.trim());
    document.querySelectorAll("[data-scan-filter]").forEach(b => { const on = b.dataset.scanFilter === filter; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
    const inStock = all.filter(p => p.stock > 0), total = inStock.reduce((n, p) => n + p.stock, 0);
    $("scanSummary").textContent = `${inStock.length} ${plural(inStock.length, "producto", "productos")} con ${units(total)}`;
    const list = (filter === "available" ? inStock : all)
      .filter(p => !term || normal(p.name + " " + p.brand + " " + p.barcodes.join(" ")).includes(term))
      .sort((a, b) => b.stock - a.stock || a.name.localeCompare(b.name, "es"));
    $("scanList").innerHTML = list.length ? list.map(p => `<li class="stock-row"><div class="stock-row-copy"><strong>${esc(p.name)}</strong><span>${esc(p.brand || "Sin marca")}${p.barcodes.length ? "" : ", sin código vinculado"}</span></div><span class="stock-count${p.stock ? "" : " out"}">${p.stock ? units(p.stock) : "Agotado"}</span><button type="button" class="secondary" data-scan-add="${esc(p.id)}" aria-label="Ingresar mercadería de ${esc(p.name)}">Ingresar</button></li>`).join("")
      : `<li class="receive-empty">${filter === "available" && !term ? "Aún no tienes productos en stock. Escanea una caja o pulsa «Todos»." : "Ningún producto coincide con tu búsqueda."}</li>`;
    if (current) syncTicket();
  }
  function renderLog() {
    $("receiveLogEmpty").hidden = log.length > 0;
    $("receiveLog").innerHTML = log.map(e => `<li class="log-row"><div><strong>${esc(e.name)}</strong><span>${units(e.quantity)}, ${e.cost ? soles(e.soles) : "sin costo"}</span>${e.currency === "USD" && e.cost ? `<span class="log-detail">${dollars(e.cost)} con tipo de cambio ${e.rate}</span>` : ""}</div><time datetime="${e.at.toISOString()}">${e.at.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</time></li>`).join("");
  }

  // ---------- La compra de lo que llegó ----------
  function result(html, kind = "") { const box = $("scanResult"); box.className = "receive-result" + (kind ? " " + kind : ""); box.innerHTML = html; box.hidden = !html; }
  const currency = () => document.querySelector('input[name="receiveCurrency"]:checked').value;
  function openReceive(productId, code) {
    const api = suite(), product = api.products().find(p => String(p.id) === String(productId));
    if (!product) { result("<p>Ese producto ya no existe. Actualiza la lista.</p>", "problem"); return; }
    stopCamera(); pendingCode = ""; result("");
    const memory = remember();
    current = { id: product.id, code: core.barcodeKey(code) || product.barcodes[0] || "", request: crypto.randomUUID() };
    $("receiveName").textContent = product.name;
    $("receiveBrand").textContent = product.brand;
    $("receiveBrand").hidden = !product.brand;
    $("receiveCode").innerHTML = current.code ? `${eanSVG(current.code)}<span>${esc(showCode(current.code))}</span>` : "Sin código vinculado";
    $("receiveCode").setAttribute("aria-label", current.code ? "Código de la caja " + current.code : "Sin código vinculado");
    $("receiveCode").classList.toggle("none", !current.code);
    $("receiveQty").value = "1"; $("receiveCost").value = "";
    document.querySelector(`input[name="receiveCurrency"][value="${memory.currency === "USD" ? "USD" : "PEN"}"]`).checked = true;
    $("receiveRate").value = memory.rate || api.lastRate() || "";
    $("receiveSupplier").value = lastSupplier;
    $("receiveSuppliers").innerHTML = api.suppliers().map(s => `<option value="${esc(s)}"></option>`).join("");
    $("receiveDate").value = today(); $("receiveDate").max = today();
    $("receiveCategory").value = CATEGORY[product.category] || "";
    $("receiveMessage").textContent = "";
    $("receiveForm").hidden = false;
    syncTicket();
    $("receiveForm").scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth" });
    if (fine()) $("receiveCost").focus({ preventScroll: true });
  }
  function closeReceive() { current = null; $("receiveForm").hidden = true; $("receiveMessage").textContent = ""; }
  const quantity = () => { const text = $("receiveQty").value.trim(); return /^\d{1,4}$/.test(text) ? Number(text) : NaN; };
  const costValue = () => { const text = $("receiveCost").value.trim().replace(",", "."); if (!text) return 0; try { const c = core.cents(text); return c <= 99999999999 ? c / 100 : NaN; } catch { return NaN; } };
  const rateValue = () => { const text = $("receiveRate").value.trim().replace(",", "."); return /^\d{1,3}(\.\d{1,4})?$/.test(text) && Number(text) > 0 ? Number(text) : NaN; };
  function syncTicket() {
    const api = suite(), product = current && api.products().find(p => String(p.id) === String(current.id));
    if (!product) return;
    const qty = quantity(), usd = currency() === "USD", cost = costValue(), rate = rateValue();
    $("receiveRateField").hidden = !usd;
    $("receiveCostAffix").textContent = usd ? "US$" : "S/";
    $("receiveCostLabel").textContent = qty > 1 ? `Costo total de las ${qty} unidades` : "Costo total";
    $("receiveStock").innerHTML = `<span>Tienes ${units(product.stock)} en stock</span><strong>${Number.isInteger(qty) && qty > 0 ? `Quedarán ${units(product.stock + qty)}` : "Indica cuántas llegaron"}</strong>`;
    let total;
    if (!Number.isFinite(cost)) total = "Revisa el costo: usa solo números y hasta 2 decimales.";
    else if (!cost) total = "Sin costo por ahora: quedará en S/ 0.00 y lo completas cuando quieras en Compras.";
    else if (usd && !Number.isFinite(rate)) total = `${dollars(cost)}. Falta el tipo de cambio para pasarlo a soles.`;
    else { const s = usd ? cost * rate : cost; total = `Costo en soles: ${soles(s)}${qty > 1 ? `, ${soles(s / qty)} por unidad` : ""}.`; }
    $("receiveTotal").textContent = total;
  }
  async function saveReceive(event) {
    event.preventDefault();
    if (!current || saving) return;
    const qty = quantity(), cost = costValue(), usd = currency() === "USD", rate = rateValue(), fail = (id, text) => { $("receiveMessage").textContent = text; $(id).focus(); };
    if (!(qty >= 1 && qty <= 1000)) return fail("receiveQty", "Indica entre 1 y 1000 unidades.");
    if (!Number.isFinite(cost)) return fail("receiveCost", "Revisa el costo: usa solo números, sin separadores de miles y con hasta 2 decimales.");
    if (usd && !Number.isFinite(rate)) return fail("receiveRate", "Indica el tipo de cambio de la compra en dólares (por ejemplo, 3.75).");
    if (!$("receiveDate").value) return fail("receiveDate", "Indica la fecha de compra.");
    const api = suite(), product = api.products().find(p => String(p.id) === String(current.id)), entry = { ...current };
    saving = true; $("receiveSave").disabled = true; $("receiveSave").textContent = "Registrando…"; $("receiveMessage").textContent = "";
    try {
      const supplier = $("receiveSupplier").value.trim();
      const saved = await api.receive({ productId: entry.id, quantity: qty, cost, currency: usd ? "USD" : "PEN", rate: usd ? rate : 0, supplier, date: $("receiveDate").value, category: $("receiveCategory").value, request: entry.request });
      keep({ currency: usd ? "USD" : "PEN", ...(usd ? { rate: String(rate) } : {}) }); lastSupplier = supplier;
      log.unshift({ name: product?.name || "Producto", quantity: qty, cost, currency: usd ? "USD" : "PEN", rate, soles: usd ? cost * rate : cost, at: new Date() });
      closeReceive(); renderLog(); render();
      result(`<p><strong>${esc(product?.name || "Producto")} ahora tiene ${units(saved.stock)} en stock.</strong> La compra quedó registrada en Compras.</p><div class="suite-actions"><button type="button" class="primary" data-scan-again>Escanear otra caja</button></div>`, "success");
      if (fine()) $("scanCode").focus();
    } catch (error) { $("receiveMessage").textContent = error?.message || "No se pudo registrar la compra. Revisa tu conexión e inténtalo otra vez."; }
    finally { saving = false; $("receiveSave").disabled = false; $("receiveSave").textContent = "Registrar compra"; }
  }

  // ---------- Qué hacer con un código ----------
  async function handleCode(raw) {
    const code = core.barcodeKey(raw), api = suite();
    $("scanCode").value = "";
    if (!code) { result("<p>No se leyó un código válido. Vuelve a intentarlo.</p>", "problem"); return; }
    if (!api) return;
    if (!api.ready()) { result("<p>Cargando tu stock…</p>"); try { await api.refresh(); } catch { result(`<p>${esc(api.error() || "No se pudo cargar tu stock. Revisa tu conexión.")}</p>`, "problem"); return; } }
    if (current && !saving) closeReceive();
    const found = api.find(code);
    if (found) { openReceive(found.id, code); return; }
    pendingCode = code; showUnknown("");
  }
  function showUnknown(term) {
    const api = suite(), words = normal(term).split(/\s+/).filter(Boolean);
    const matches = api.products().filter(p => words.every(w => normal(p.name + " " + p.brand).includes(w))).sort((a, b) => a.name.localeCompare(b.name, "es")).slice(0, 8);
    const listHTML = matches.length ? matches.map(p => `<li><span>${esc(p.name)}<small>${esc(p.brand || "Sin marca")}${p.barcodes.length ? ", ya tiene otro código" : ""}</small></span><button type="button" class="secondary" data-scan-link="${esc(p.id)}">Es este</button></li>`).join("") : "<li class=\"receive-empty\">Ningún producto coincide. Puedes crearlo como nuevo.</li>";
    if (!$("scanPick")) {
      const amazon = /^X00[0-9A-Z]{7}$/.test(pendingCode);
      result(`<p><strong>${amazon ? `El código ${esc(pendingCode)} es la etiqueta de Amazon de esta caja.` : `El código ${esc(showCode(pendingCode))} todavía no está en tu web.`}</strong> ${amazon ? "No dice qué producto es: elígelo una vez y desde entonces se reconocerá solo." : "Dinos qué producto es: la próxima vez se reconocerá solo."}</p><label for="scanPick">Buscar el producto</label><input id="scanPick" type="search" placeholder="Por ejemplo: B850, Ryzen 7, Kingston 32GB" autocomplete="off"><ul id="scanMatches" class="scan-matches"></ul><div class="suite-actions"><button type="button" class="secondary" data-scan-new>Es un producto nuevo</button><button type="button" class="quiet" data-scan-cancel>Cancelar</button></div>`, "pending");
      $("scanPick").addEventListener("input", () => showUnknown($("scanPick").value));
      $("scanPick").focus();
    }
    $("scanMatches").innerHTML = listHTML;
  }
  function focusCode() { if (fine()) $("scanCode").focus(); }

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
  // Sin «try harder», ZXing solo revisa una franja del centro: un código arriba o abajo del cuadro no se encontraba.
  const hardHints = () => new Map([[window.ZXing.DecodeHintType.TRY_HARDER, true]]);
  // Una foto tomada con la cámara del celular (enfoca mejor de cerca): primero el lector del navegador y luego ZXing,
  // derecha y girada (por si el código está vertical), a un tamaño que no la haga lenta.
  async function readPhoto(file) {
    if (!file) return;
    stopCamera(); result("<p>Leyendo la foto…</p>");
    let image;
    try { image = await createImageBitmap(file); }
    catch { result("<p>No se pudo abrir esa imagen. Usa una foto JPG o PNG.</p>", "problem"); return; }
    try {
      const formats = await nativeFormats();
      if (formats.length) { try { const code = (await new window.BarcodeDetector({ formats }).detect(image)).find(c => core.barcodeKey(c.rawValue)); if (code) { handleCode(code.rawValue); return; } } catch {} }
      await loadZXing();
      const reader = new window.ZXing.MultiFormatReader(), hints = hardHints();
      for (const size of [1600, 2600]) for (const turn of [0, 90]) {
        const scale = Math.min(1, size / Math.max(image.width, image.height)), w = Math.round(image.width * scale), h = Math.round(image.height * scale);
        const canvas = document.createElement("canvas"), g = canvas.getContext("2d");
        canvas.width = turn ? h : w; canvas.height = turn ? w : h;
        if (turn) { g.translate(h, 0); g.rotate(Math.PI / 2); }
        g.drawImage(image, 0, 0, w, h);
        try { const found = reader.decode(new window.ZXing.BinaryBitmap(new window.ZXing.HybridBinarizer(new window.ZXing.HTMLCanvasElementLuminanceSource(canvas))), hints); handleCode(found.getText()); return; } catch {}
        if (scale === 1) break;
      }
      result("<p>No se encontró un código de barras en la foto. Tómala más cerca, con el código entero, derecho y bien iluminado.</p>", "problem");
    } catch { result("<p>No se pudo cargar el lector de códigos. Revisa tu conexión, o escribe el código.</p>", "problem"); }
    finally { image.close?.(); }
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
        // ZXing con su propio bucle: cada cuadro se lee en una imagen nueva (el bucle de la librería reutiliza la suya y,
        // con «try harder», un cuadro fallido la deja girada y ya no lee nada). Una pasada rápida por el centro y, cada
        // tercer cuadro, una completa: así se encuentra el código aunque no esté al medio sin volverla lenta.
        await loadZXing();
        if (run !== cameraRun) return;
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (run !== cameraRun) { stream.getTracks().forEach(t => t.stop()); return; }
        const Z = window.ZXing, quick = new Z.MultiFormatReader(), thorough = new Z.MultiFormatReader();
        quick.setHints(null); thorough.setHints(hardHints());
        const canvas = document.createElement("canvas"), g = canvas.getContext("2d", { willReadFrequently: true });
        let timer = 0, frame = 0;
        camera = { stop: () => { clearTimeout(timer); stream.getTracks().forEach(t => t.stop()); video.srcObject = null; } };
        video.srcObject = stream; video.play().catch(() => {});
        const read = () => {
          if (run !== cameraRun) return;
          if (video.readyState >= 2 && video.videoWidth) {
            const scale = Math.min(1, 1280 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
            g.drawImage(video, 0, 0, canvas.width, canvas.height);
            const reader = ++frame % 3 === 0 ? thorough : quick;
            try { const value = reader.decodeWithState(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)))); if (core.barcodeKey(value.getText())) { found(value.getText()); return; } } catch {}
          }
          timer = setTimeout(read, 120);
        };
        read();
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
  $("scanPhoto").addEventListener("click", () => $("scanPhotoFile").click());
  $("scanPhotoFile").addEventListener("change", e => { const file = e.target.files[0]; e.target.value = ""; readPhoto(file); });
  $("scanCodeForm").addEventListener("submit", e => { e.preventDefault(); stopCamera(); handleCode($("scanCode").value); });
  $("scanSearch").addEventListener("input", render);
  document.querySelectorAll("[data-scan-filter]").forEach(b => b.addEventListener("click", () => { filter = b.dataset.scanFilter; render(); }));
  $("scanList").addEventListener("click", e => { const add = e.target.closest("[data-scan-add]"); if (add) openReceive(add.dataset.scanAdd, ""); });
  $("receiveForm").addEventListener("submit", saveReceive);
  $("receiveForm").addEventListener("input", syncTicket);
  $("receiveForm").addEventListener("change", e => { if (e.target.name === "receiveCurrency") { syncTicket(); if (currency() === "USD" && !$("receiveRate").value) $("receiveRate").focus(); } });
  $("receiveForm").addEventListener("click", e => { const step = e.target.closest("[data-step]"); if (!step) return; const now = Number.isFinite(quantity()) ? quantity() : 1; $("receiveQty").value = String(Math.min(1000, Math.max(1, now + Number(step.dataset.step)))); syncTicket(); });
  $("receiveCancel").addEventListener("click", () => { closeReceive(); focusCode(); });
  $("scanResult").addEventListener("click", async e => {
    const link = e.target.closest("[data-scan-link]");
    if (link) {
      const code = pendingCode; link.disabled = true;
      try { const product = await suite().link(link.dataset.scanLink, code); openReceive(product.id, code); }
      catch (error) { link.disabled = false; result(`<p>${esc(error.message || "No se pudo vincular el código.")}</p><div class="suite-actions"><button type="button" class="secondary" data-scan-again>Volver a escanear</button></div>`, "problem"); }
      return;
    }
    if (e.target.closest("[data-scan-new]")) { const code = pendingCode; suite().newProduct(code, id => openReceive(id, code)); result(`<p>Completa el producto nuevo para tu web: su código ya quedó escrito. Al guardarlo, registras la compra aquí.</p>`); return; }
    if (e.target.closest("[data-scan-cancel]")) { pendingCode = ""; result(""); focusCode(); return; }
    if (e.target.closest("[data-scan-again]")) { result(""); $("scanStart").click(); }
  });
  // Al salir de la vista o de la página, la cámara se apaga.
  document.addEventListener("visibilitychange", () => { if (document.hidden && camera) stopCamera(); });
  renderLog();
  window.AOScan = { render, handleCode, enter: () => { render(); if (!current) focusCode(); }, leave: () => { if (camera || !$("scanPanel").hidden) stopCamera(); } };
})();

/** AO Nexus: deploy as the business account. Secrets belong in Script Properties. */
var AO_SENDER = 'aonexuspe@gmail.com';
var AO_MAX_PDF = 10 * 1024 * 1024;

function inicializarAO() {
  if (Session.getEffectiveUser().getEmail().toLowerCase() !== AO_SENDER) {
    throw new Error('Abre este proyecto con aonexuspe@gmail.com.');
  }
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('AO_SECRET')) {
    props.setProperty('AO_SECRET', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  }
  // Verifies the account's permission without sending a test email.
  MailApp.getRemainingDailyQuota();
  return 'Listo. Copia AO_SECRET desde Configuración del proyecto > Propiedades de la secuencia de comandos.';
}

function doGet() { return aoJson({ ok: false, error: 'Servicio privado de AO Nexus.' }); }

function doPost(e) {
  var props = PropertiesService.getScriptProperties(), input;
  try {
    if (!e || !e.postData || e.postData.contents.length > Math.ceil(AO_MAX_PDF * 4 / 3) + 8192) return aoJson({ ok: false, code: 'invalid_request' });
    input = JSON.parse(e.postData.contents);
    var secret = props.getProperty('AO_SECRET');
    if (!secret || !aoEqual(secret, input.secret)) return aoJson({ ok: false, code: 'unauthorized' });
    if (Session.getEffectiveUser().getEmail().toLowerCase() !== AO_SENDER) return aoJson({ ok: false, code: 'unauthorized' });
    if (input.action === 'status') {
      MailApp.getRemainingDailyQuota();
      return aoJson({ ok: true, sender: AO_SENDER });
    }
    if (input.action !== 'send') return aoJson({ ok: false, code: 'invalid_request' });
    return aoSend(input.job, props);
  } catch (_) { return aoJson({ ok: false, code: 'rejected' }); }
}

function aoSend(job, props) {
  var bytes;
  try {
    if (!job || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(job.requestId)) throw new Error();
    aoText(job.to, 254); aoText(job.customer, 300); aoText(job.series, 10);
    aoText(job.number, 10); aoText(job.date, 10); aoText(job.total, 80); aoText(job.filename, 160);
    if (!/^[^\s<>@,;:]+@[^\s<>@,;:]+\.[^\s<>@,;:]+$/.test(job.to)) throw new Error();
    if (!/^[A-Z0-9_-]{1,10}$/.test(job.series) || !/^\d{1,10}$/.test(job.number)) throw new Error();
    var date = new Date(job.date + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(job.date) || !isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== job.date) throw new Error();
    if (!job.customer || !job.total || !/^[^/\\]+\.pdf$/i.test(job.filename)) throw new Error();
    if (typeof job.pdfBase64 !== 'string' || job.pdfBase64.length % 4 || job.pdfBase64.length > Math.ceil(AO_MAX_PDF / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(job.pdfBase64)) throw new Error();
    bytes = Utilities.base64Decode(job.pdfBase64);
    if (bytes.length > AO_MAX_PDF || bytes.slice(0, 5).map(function(b) { return String.fromCharCode(b); }).join('') !== '%PDF-') throw new Error();
  } catch (_) { return aoJson({ ok: false, code: 'invalid_request' }); }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return aoJson({ ok: false, code: 'rejected' });
  try {
    var digest = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(job), Utilities.Charset.UTF_8));
    var key = 'delivery_' + job.requestId, prior = props.getProperty(key);
    if (prior) {
      var saved = JSON.parse(prior);
      if (saved.digest !== digest) return aoJson({ ok: false, code: 'invalid_request' });
      if (saved.state === 'sent') return aoJson({ ok: true, sender: AO_SENDER, duplicate: true });
      return aoJson({ ok: false, code: 'delivery_unknown' });
    }
    if (MailApp.getRemainingDailyQuota() < 1) return aoJson({ ok: false, code: 'quota' });
    var all = props.getProperties();
    if (Object.keys(all).filter(function(k) { return k.indexOf('delivery_') === 0; }).length >= 1500) {
      return aoJson({ ok: false, code: 'storage_full' });
    }
    props.setProperty(key, JSON.stringify({ digest: digest, state: 'pending', updatedAt: Date.now() }));
    try {
      MailApp.sendEmail({
        to: job.to, name: 'AO Nexus', replyTo: AO_SENDER,
        subject: 'Boleta ' + job.series + '-' + job.number + ' · AO Nexus',
        body: 'Hola ' + job.customer + ',\n\nTe enviamos tu boleta ' + job.series + '-' + job.number +
          ', de fecha ' + job.date + ', por ' + job.total + '.\n\nEl PDF está adjunto.\nGracias por tu compra.\nAO Nexus',
        attachments: [Utilities.newBlob(bytes, 'application/pdf', job.filename)]
      });
      props.setProperty(key, JSON.stringify({ digest: digest, state: 'sent', updatedAt: Date.now() }));
      return aoJson({ ok: true, sender: AO_SENDER });
    } catch (_) {
      // Never resend when Google might have accepted a previous attempt.
      try { props.setProperty(key, JSON.stringify({ digest: digest, state: 'unknown', updatedAt: Date.now() })); } catch (_) {}
      return aoJson({ ok: false, code: 'delivery_unknown' });
    }
  } finally { lock.releaseLock(); }
}

function aoText(value, max) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error();
}
function aoEqual(a, b) {
  if (typeof b !== 'string' || a.length !== b.length) return false;
  var different = 0;
  for (var i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
function aoJson(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }

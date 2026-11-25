// معالج الطلبات — Apps Script (OracleBackend.gs) بيبعت POST {key, action, ...}
//   dump   {tables:[...]}           ← كل صفوف الجداول دي
//   upsert {table, rows:[...]}      ← إضافة/تعديل
//   delete {table, ids:[...]}       ← حذف
//   health {}                       ← عدد الوثائق
const crypto = require('crypto');

const MAX_BODY = 8 * 1024 * 1024;

function sameKey(a, b) {
  const x = crypto.createHash('sha256').update(String(a || '')).digest();
  const y = crypto.createHash('sha256').update(String(b || '')).digest();
  return !!b && crypto.timingSafeEqual(x, y);
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function makeHandler(store, key, log = console) {
  return async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Al Omniyat DMS (Oracle) — OK');
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' });
    let raw = '';
    let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_BODY) return send(res, 413, { ok: false, error: 'too large' }); raw += c; }
    let out;
    try {
      const body = JSON.parse(raw || '{}');
      if (!sameKey(body.key, key)) out = { ok: false, error: 'unauthorized' };
      else if (body.action === 'dump') out = { ok: true, data: await store.dump([].concat(body.tables || [])) };
      else if (body.action === 'upsert') out = { ok: true, count: await store.upsert(body.table, body.rows) };
      else if (body.action === 'delete') out = { ok: true, count: await store.remove(body.table, body.ids) };
      else if (body.action === 'health') out = { ok: true, documents: await store.ping() };
      else out = { ok: false, error: 'unknown action' };
    } catch (e) {
      log.error(new Date().toISOString(), 'error:', e.message);
      out = { ok: false, error: e.client ? e.message : 'server error: ' + String(e.message).split('\n')[0] };
    }
    send(res, 200, out);
  };
}

module.exports = { makeHandler, sameKey };

// اختبار من غير Oracle: بيتأكد إن التشفير بيطابق Code.gs وإن السيرفر بيرفض أي مفتاح غلط
const assert = require('assert');
const http = require('http');
const { hash, protectUser } = require('./hash');
const { makeHandler } = require('./app');

// 1) hash_ في Code.gs: نفس النتيجة لنفس salt/password
const h = hash('abc', 'pw123');
assert.strictEqual(h.length, 64);
assert.strictEqual(h, hash('abc', 'pw123'));
const u = protectUser({ UserID: 'U1', Password: ' pw123 ' });
assert.strictEqual(u.Password, '');
assert.strictEqual(u.PasswordHash, hash(u.Salt, 'pw123'));
assert.deepStrictEqual(protectUser({ UserID: 'U2', Password: '', PasswordHash: 'x' }).PasswordHash, 'x');

// 2) السيرفر
const calls = [];
const fake = {
  dump: async (t) => { calls.push(['dump', t]); return { Documents: [{ DocID: 'D1' }] }; },
  upsert: async (t, rows) => { calls.push(['upsert', t, rows.length]); return rows.length; },
  remove: async (t, ids) => { calls.push(['delete', t, ids]); return ids.length; },
  ping: async () => 5,
};
const KEY = 'k'.repeat(40);
const srv = http.createServer(makeHandler(fake, KEY, { error() {} })).listen(0, async () => {
  const port = srv.address().port;
  const post = (b) => fetch(`http://127.0.0.1:${port}`, { method: 'POST', body: JSON.stringify(b) }).then((r) => r.json());
  try {
    assert.deepStrictEqual(await post({ key: 'wrong', action: 'health' }), { ok: false, error: 'unauthorized' });
    assert.deepStrictEqual(await post({ action: 'health' }), { ok: false, error: 'unauthorized' });
    assert.deepStrictEqual(await post({ key: KEY, action: 'health' }), { ok: true, documents: 5 });
    assert.deepStrictEqual((await post({ key: KEY, action: 'dump', tables: ['Documents'] })).data.Documents[0].DocID, 'D1');
    assert.deepStrictEqual(await post({ key: KEY, action: 'upsert', table: 'Documents', rows: [{}, {}] }), { ok: true, count: 2 });
    assert.deepStrictEqual(await post({ key: KEY, action: 'delete', table: 'Documents', ids: ['D1'] }), { ok: true, count: 1 });
    assert.strictEqual((await post({ key: KEY, action: 'drop' })).error, 'unknown action');
    console.log('✅ كل الاختبارات نجحت');
  } catch (e) { console.error('❌', e.message); process.exitCode = 1; }
  srv.close();
});

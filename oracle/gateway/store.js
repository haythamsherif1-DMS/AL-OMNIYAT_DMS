// قراءة وكتابة جداول DMS_* — أسماء الجداول والأعمدة جاية من dms-map.json بس (مفيش SQL من برة)
const { oracledb, getPool } = require('./db');
const MAP = require('./dms-map.json');
const { protectUser } = require('./hash');

const BIND = { D: oracledb.DB_TYPE_TIMESTAMP, N: oracledb.DB_TYPE_NUMBER, C: oracledb.DB_TYPE_CLOB, S: oracledb.DB_TYPE_VARCHAR };

function table(name) {
  const m = MAP[name];
  if (!m) throw Object.assign(new Error('unknown table ' + name), { client: true });
  return m;
}

// قيمة جاية من Apps Script ← قيمة Oracle
function toDb(type, v) {
  if (v === '' || v === null || v === undefined) return null;
  if (type === 'D') { const d = new Date(v); return isNaN(d) ? null : d; }
  if (type === 'N') { const n = Number(String(v).replace(/,/g, '')); return isFinite(n) ? n : null; }
  return typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v));
}
// قيمة Oracle ← JSON لـ Apps Script (التاريخ بيروح ISO)
function fromDb(type, v) {
  if (v === null || v === undefined) return '';
  if (type === 'D') return v instanceof Date ? v.toISOString() : String(v);
  return v;
}

/** بيرجّع كل صفوف الجداول المطلوبة: { Documents: [ {DocID:..., Title:...}, ... ], ... } */
async function dump(names) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    const out = {};
    for (const name of names) {
      const m = table(name);
      const r = await conn.execute(
        `SELECT ${m.cols.map((c) => c[1]).join(', ')} FROM ${m.table} ORDER BY SHEET_ROW NULLS LAST, MIGRATED_AT, ${m.cols[0][1]}`,
        [], { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 0 });
      out[name] = r.rows.map((row) => Object.fromEntries(m.cols.map(([c, , t], i) => [c, fromDb(t, row[i])])));
    }
    return out;
  } finally { await conn.close(); }
}

/** إضافة أو تعديل (MERGE على رقم التعريف) */
async function upsert(name, rows) {
  const m = table(name);
  if (!Array.isArray(rows) || !rows.length) return 0;
  const cols = m.cols;
  const pk = cols[0][1];
  const sel = cols.map(([, col], i) => `:${i + 1} AS ${col}`).join(', ');
  const sql = `MERGE INTO ${m.table} t USING (SELECT ${sel} FROM dual) s ON (t.${pk} = s.${pk})
    WHEN MATCHED THEN UPDATE SET ${cols.slice(1).map(([, c]) => `t.${c} = s.${c}`).join(', ')}, t.MIGRATED_AT = SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (${cols.map((c) => c[1]).join(', ')}) VALUES (${cols.map(([, c]) => 's.' + c).join(', ')})`;
  const binds = rows.map((o) => {
    if (name === 'Users') o = protectUser(o);
    const id = String(o[cols[0][0]] === undefined || o[cols[0][0]] === null ? '' : o[cols[0][0]]).trim();
    if (!id) throw Object.assign(new Error('صف من غير رقم تعريف في ' + name), { client: true });
    return cols.map(([c, , t], i) => (i === 0 ? id : toDb(t, o[c])));
  });
  const bindDefs = cols.map(([, , t]) => ({ type: BIND[t], maxSize: t === 'S' ? 8000 : undefined }));
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.executeMany(sql, binds, { bindDefs, autoCommit: true });
    return binds.length;
  } finally { await conn.close(); }
}

/** حذف بأرقام التعريف */
async function remove(name, ids) {
  const m = table(name);
  if (!Array.isArray(ids) || !ids.length) return 0;
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    const r = await conn.executeMany(`DELETE FROM ${m.table} WHERE ${m.cols[0][1]} = :1`, ids.map((x) => [String(x)]),
      { bindDefs: [{ type: oracledb.DB_TYPE_VARCHAR, maxSize: 400 }], autoCommit: true, dmlRowCounts: true });
    return (r.dmlRowCounts || []).reduce((a, b) => a + b, 0);
  } finally { await conn.close(); }
}

async function ping() {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    const r = await conn.execute('SELECT COUNT(*) FROM DMS_DOCUMENTS', [], { outFormat: oracledb.OUT_FORMAT_ARRAY });
    return r.rows[0][0];
  } finally { await conn.close(); }
}

module.exports = { dump, upsert, remove, ping, MAP };

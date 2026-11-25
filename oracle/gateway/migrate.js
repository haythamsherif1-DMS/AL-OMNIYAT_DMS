// نقل بيانات الشيت (ملف Excel) لجداول DMS_* — بيفضّي جداول DMS_* بس ويعيد ملاها، فينفع يتعاد أي عدد مرات
const { connect, oracledb } = require('./db');
const { readWorkbook, MAP } = require('./sheet');
const { protectUser } = require('./hash');

const BIND = { D: oracledb.DB_TYPE_TIMESTAMP, N: oracledb.DB_TYPE_NUMBER, C: oracledb.DB_TYPE_CLOB, S: oracledb.DB_TYPE_VARCHAR };

function convert(type, v, issues, where) {
  if (v === '' || v === null || v === undefined) return null;
  if (type === 'D') {
    const d = v instanceof Date ? v : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? v + 'T00:00:00+03:00' : v);
    if (isNaN(d)) { issues.push(`${where}: تاريخ مش مفهوم «${v}» اتحفظ فاضي`); return null; }
    return d;
  }
  if (type === 'N') {
    const n = Number(String(v).replace(/,/g, ''));
    if (isNaN(n)) { issues.push(`${where}: رقم مش مفهوم «${v}» اتحفظ فاضي`); return null; }
    return n;
  }
  return v instanceof Date ? v.toISOString() : String(v);
}

(async () => {
  const file = process.env.XLSX_FILE || './DMS_Database.xlsx';
  console.log('بنقرا ' + file + ' ...');
  const data = await readWorkbook(file);
  const conn = await connect();
  const issues = [];
  for (const [name, m] of Object.entries(MAP)) {
    const rows = data[name];
    if (rows === null) { issues.push(`الورقة ${name} مش موجودة في الملف`); continue; }
    const keep = m.cols.map((c, i) => i);
    const seen = new Set(), binds = [];
    for (const r of rows) {
      const id = String(r.vals[0]).trim(), where = `${name} صف ${r.row}`;
      if (!id) { issues.push(`${where}: من غير رقم تعريف — اتساب`); continue; }
      if (seen.has(id)) { issues.push(`${where}: رقم مكرر ${id} — اتساب`); continue; }
      seen.add(id);
      if (name === 'Users') {   // كلمة السر بتتخزن متشفرة (نفس طريقة Code.gs) مش نص
        const o = protectUser(Object.fromEntries(m.cols.map(([c], i) => [c, r.vals[i]])));
        r.vals = m.cols.map(([c]) => o[c]);
      }
      const b = keep.map(i => convert(m.cols[i][2], r.vals[i], issues, where));
      b.push(r.row);
      binds.push(b);
    }
    const sql = `INSERT INTO ${m.table} (${keep.map(i => m.cols[i][1]).join(', ')}, SHEET_ROW) VALUES (${keep.map((_, j) => ':' + (j + 1)).join(', ')}, :${keep.length + 1})`;
    const bindDefs = keep.map(i => ({ type: BIND[m.cols[i][2]], maxSize: m.cols[i][2] === 'S' ? 8000 : undefined }));
    bindDefs.push({ type: oracledb.DB_TYPE_NUMBER });
    try {
      await conn.execute(`DELETE FROM ${m.table}`);
      for (let i = 0; i < binds.length; i += 500) {
        await conn.executeMany(sql, binds.slice(i, i + 500), { bindDefs, autoCommit: false });
      }
      await conn.commit();
      console.log(`✅ ${name} → ${m.table} (${binds.length} صف)`);
    } catch (e) {
      await conn.rollback();
      console.error(`❌ ${name}: ${e.message.split('\n')[0]} — الجدول ده رجع زي ما كان`);
      if (/ORA-00942/.test(e.message)) console.error('   الجدول مش موجود — شغّلي npm.cmd run create-tables الأول');
    }
  }
  if (issues.length) { console.log(`\nملاحظات (${issues.length}):`); issues.slice(0, 200).forEach(x => console.log(' - ' + x)); }
  console.log('\nخلصنا. شغّلي npm.cmd run verify للمقارنة.');
  await conn.close();
})();

// 4) مقارنة عدد الصفوف بين ملف الشيت والقاعدة
const { connect } = require('./db');
const { readWorkbook, MAP } = require('./sheet');

(async () => {
  const data = await readWorkbook(process.env.XLSX_FILE || './DMS_Database.xlsx');
  const conn = await connect();
  let ok = true;
  for (const [name, m] of Object.entries(MAP)) {
    const ids = new Set((data[name] || []).map(r => String(r.vals[0]).trim()).filter(Boolean));
    let db = '—';
    try { db = (await conn.execute(`SELECT COUNT(*) FROM ${m.table}`)).rows[0][0]; } catch (e) { db = 'مش موجود'; }
    const same = ids.size === db;
    if (!same) ok = false;
    console.log(`${same ? '✅' : '⚠️'} ${name}: الشيت ${ids.size} | Oracle ${db}`);
  }
  console.log(ok ? '\nكل الجداول متطابقة 👍' : '\nفيه فرق — راجعي الملاحظات في نتيجة npm run migrate');
  await conn.close();
})();

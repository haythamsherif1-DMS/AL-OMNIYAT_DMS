// 1) اختبار الاتصال — قراءة فقط، مفيش أي تعديل في القاعدة
const { connect } = require('./db');

(async () => {
  const t0 = Date.now();
  const conn = await connect();
  console.log(`✅ اتصلنا في ${Date.now() - t0}ms`);
  try {
    const v = await conn.execute(`SELECT banner FROM v$version WHERE ROWNUM = 1`);
    console.log('النسخة: ' + (v.rows[0] ? v.rows[0][0] : 'غير معروفة'));
  } catch (e) { console.log('النسخة: مقدرناش نقراها (' + e.message.split('\n')[0] + ')'); }

  const cs = await conn.execute(`SELECT value FROM nls_database_parameters WHERE parameter = 'NLS_CHARACTERSET'`);
  const charset = cs.rows[0] ? cs.rows[0][0] : '?';
  console.log('ترميز الحروف: ' + charset + (/UTF8/.test(charset) ? ' ✅ العربي هيتحفظ صح' : ' ⚠️ العربي ممكن يبوظ — كلّمي مسؤول القاعدة قبل النقل'));

  const ar = await conn.execute(`SELECT 'نظام الوثائق' AS t FROM dual`);
  console.log('تجربة عربي: ' + ar.rows[0][0]);

  try {
    const p = await conn.execute(`SELECT COUNT(*) FROM EMMCSYS.PROJECTS`);
    console.log(`EMMCSYS.PROJECTS فيها ${p.rows[0][0]} صف`);
    const first = await conn.execute(`SELECT * FROM EMMCSYS.PROJECTS FETCH FIRST 3 ROWS ONLY`);
    console.log('أول 3 صفوف:');
    console.table(first.rows.map(r => Object.fromEntries(first.metaData.map((m, i) => [m.name, r[i]]))));
  } catch (e) { console.log('ملحوظة: مقدرناش نقرا EMMCSYS.PROJECTS: ' + e.message.split('\n')[0]); }

  const t = await conn.execute(`SELECT table_name FROM user_tables WHERE table_name LIKE 'DMS\\_%' ESCAPE '\\' ORDER BY 1`);
  console.log(t.rows.length ? 'جداول DMS موجودة: ' + t.rows.map(r => r[0]).join(', ') : 'لسه مفيش جداول DMS_ (شغّلي npm.cmd run create-tables لما تحبي)');
  await conn.close();
})();

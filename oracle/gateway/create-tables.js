// 2) إنشاء جداول DMS_* — لو الجدول موجود بيسيبه زي ما هو
const { connect } = require('./db');
const MAP = require('./dms-map.json');
const SQLTYPE = { D: 'TIMESTAMP', N: 'NUMBER', C: 'CLOB', S: 'VARCHAR2(2000 CHAR)' };

(async () => {
  const conn = await connect();
  const made = [], had = [];
  for (const m of Object.values(MAP)) {
    const r = await conn.execute(`SELECT COUNT(*) FROM user_tables WHERE table_name = :t`, [m.table]);
    if (r.rows[0][0] > 0) { had.push(m.table); continue; }
    const defs = m.cols.map(([, col, type], i) => `${col} ${i === 0 ? 'VARCHAR2(100 CHAR) NOT NULL' : SQLTYPE[type]}`);
    defs.push('SHEET_ROW NUMBER', 'MIGRATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP', `CONSTRAINT PK_${m.table} PRIMARY KEY (${m.cols[0][1]})`);
    await conn.execute(`CREATE TABLE ${m.table} (${defs.join(', ')})`);
    made.push(m.table);
  }
  for (const [name, on] of [['IX_DMS_DOCS_COMPANY', 'DMS_DOCUMENTS (COMPANY_ID, PROJECT_ID)'], ['IX_DMS_DOCS_EXPIRY', 'DMS_DOCUMENTS (EXPIRY_DATE)'],
                            ['IX_DMS_VER_DOC', 'DMS_DOCUMENT_VERSIONS (DOC_ID)'], ['IX_DMS_AUDIT_TIME', 'DMS_AUDIT_LOG (LOG_TIME)']]) {
    try { await conn.execute(`CREATE INDEX ${name} ON ${on}`); } catch (e) { /* موجود */ }
  }
  console.log('اتعمل: ' + (made.join(', ') || 'ولا جدول'));
  console.log('موجود قبل كدا: ' + (had.join(', ') || 'ولا جدول'));
  await conn.close();
})();

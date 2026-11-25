// بيولّد schema.sql و ords/dms_api.sql من gateway/dms-map.json
//   node oracle/tools/gen-sql.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const MAP = require(path.join(root, 'gateway', 'dms-map.json'));
const SQLTYPE = { D: 'TIMESTAMP', N: 'NUMBER', C: 'CLOB', S: 'VARCHAR2(2000 CHAR)' };
const TS = `'YYYY-MM-DD"T"HH24:MI:SS'`;

// ------------------------------------------------------------ الجداول
let ddl = `-- جداول نظام الوثائق DMS على Oracle — متولدة من gateway/dms-map.json (node oracle/tools/gen-sql.js)
-- بتتعمل في الـ schema اللي بتشغّلي منه السكريبت. كل جدول اسمه بيبدأ بـ DMS_ عشان ميتلخبطش مع باقي الجداول.
-- SHEET_ROW = رقم الصف في الشيت (للترتيب)، MIGRATED_AT = آخر وقت اتكتب فيه الصف.
-- كلمات السر بتتخزن متشفرة في PASSWORD_HASH و SALT (نفس hash_ في Code.gs)، وعمود PASSWORD بيفضل فاضي.\n\n`;
for (const m of Object.values(MAP)) {
  ddl += `CREATE TABLE ${m.table} (\n` +
    m.cols.map(([, col, t], i) => `  ${col.padEnd(22)} ${i === 0 ? 'VARCHAR2(100 CHAR) NOT NULL' : SQLTYPE[t]}`).join(',\n') +
    `,\n  ${'SHEET_ROW'.padEnd(22)} NUMBER,\n  ${'MIGRATED_AT'.padEnd(22)} TIMESTAMP DEFAULT SYSTIMESTAMP,\n  CONSTRAINT PK_${m.table} PRIMARY KEY (${m.cols[0][1]})\n);\n\n`;
}
ddl += `CREATE INDEX IX_DMS_DOCS_COMPANY ON DMS_DOCUMENTS (COMPANY_ID, PROJECT_ID);
CREATE INDEX IX_DMS_DOCS_EXPIRY  ON DMS_DOCUMENTS (EXPIRY_DATE);
CREATE INDEX IX_DMS_VER_DOC      ON DMS_DOCUMENT_VERSIONS (DOC_ID);
CREATE INDEX IX_DMS_AUDIT_TIME   ON DMS_AUDIT_LOG (LOG_TIME);

-- مفتاح الـ API: Apps Script لازم يبعته مع كل طلب (ORACLE_API_KEY في Script Properties)
CREATE TABLE DMS_API_KEYS (
  API_KEY     VARCHAR2(200) NOT NULL,
  NOTE        VARCHAR2(200),
  CREATED_AT  TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT PK_DMS_API_KEYS PRIMARY KEY (API_KEY)
);
`;
fs.writeFileSync(path.join(root, 'schema.sql'), ddl);

// ------------------------------------------------------------ الباكدج
const q = (s) => `'${s.replace(/'/g, "''")}'`;
function dumpFn(name, m) {
  const pairs = m.cols.map(([c, col, t]) => `${q(c)} VALUE ${t === 'D' ? `TO_CHAR(${col}, ${TS})` : col}`).join(',\n        ');
  return `  FUNCTION dump_${m.table}_ RETURN CLOB IS
    l CLOB;
  BEGIN
    SELECT JSON_ARRAYAGG(
      JSON_OBJECT(
        ${pairs}
        NULL ON NULL RETURNING CLOB)
      ORDER BY SHEET_ROW NULLS LAST, MIGRATED_AT, ${m.cols[0][1]} RETURNING CLOB)
      INTO l FROM ${m.table};
    RETURN NVL(l, TO_CLOB('[]'));
  END;\n`;
}
function upsertFn(name, m) {
  const pk = m.cols[0][1];
  const jcols = m.cols.map(([c, col, t], i) =>
    `${col} ${i === 0 ? 'VARCHAR2(100 CHAR)' : t === 'N' ? 'NUMBER' : t === 'D' ? 'VARCHAR2(40)' : 'CLOB'} PATH '$.${c}'`).join(',\n          ');
  const val = ([, col, t]) => (t === 'D' ? `TO_TIMESTAMP(SUBSTR(s.${col}, 1, 19) DEFAULT NULL ON CONVERSION ERROR, ${TS})` : `s.${col}`);
  return `  FUNCTION upsert_${m.table}_(p_body CLOB) RETURN NUMBER IS
  BEGIN
    MERGE INTO ${m.table} t
    USING (
      SELECT * FROM JSON_TABLE(p_body, '$.rows[*]' COLUMNS (
          ${jcols},
          SHEET_ROW NUMBER PATH '$._row'))
      WHERE ${pk} IS NOT NULL
    ) s
    ON (t.${pk} = s.${pk})
    WHEN MATCHED THEN UPDATE SET
      ${m.cols.slice(1).map((c) => `t.${c[1]} = ${val(c)}`).join(',\n      ')},
      t.SHEET_ROW = NVL(s.SHEET_ROW, t.SHEET_ROW),
      t.MIGRATED_AT = SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (${m.cols.map((c) => c[1]).join(', ')}, SHEET_ROW)
      VALUES (${m.cols.map(val).join(', ')}, s.SHEET_ROW);
    RETURN SQL%ROWCOUNT;
  END;\n`;
}
const names = Object.keys(MAP);
let pkg = `-- ============================================================
--  DMS_API — الـ API بتاع نظام الوثائق على Oracle (ORDS)
--  متولد من gateway/dms-map.json (node oracle/tools/gen-sql.js) — متعدلوش بإيدك
--
--  Apps Script بيبعت POST على  <baseUrl>dms/api  بالشكل ده:
--    {"key":"...", "action":"health"}
--    {"key":"...", "action":"dump",   "tables":["Documents","Users"]}
--    {"key":"...", "action":"upsert", "table":"Documents", "rows":[{...}]}
--    {"key":"...", "action":"delete", "table":"Documents", "ids":["D000001"]}
--  والتواريخ رايحة جاية بتوقيت بغداد بالشكل  2025-05-20T14:30:00
--  أسماء الجداول والأعمدة ثابتة هنا؛ مفيش SQL بيتبعت من برة.
-- ============================================================

CREATE OR REPLACE PACKAGE DMS_API AS
  FUNCTION handle(p_body CLOB) RETURN CLOB;
END DMS_API;
/

CREATE OR REPLACE PACKAGE BODY DMS_API AS

  FUNCTION err_(p_msg VARCHAR2) RETURN CLOB IS
    l CLOB;
  BEGIN
    SELECT JSON_OBJECT('ok' VALUE 'false' FORMAT JSON, 'error' VALUE SUBSTR(p_msg, 1, 1000) RETURNING CLOB) INTO l FROM dual;
    RETURN l;
  END;

${names.map((n) => dumpFn(n, MAP[n])).join('\n')}
${names.map((n) => upsertFn(n, MAP[n])).join('\n')}
  FUNCTION dump_one_(p_name VARCHAR2) RETURN CLOB IS
  BEGIN
    CASE p_name
${names.map((n) => `      WHEN ${q(n)} THEN RETURN dump_${MAP[n].table}_;`).join('\n')}
      ELSE RAISE_APPLICATION_ERROR(-20001, 'unknown table ' || p_name);
    END CASE;
  END;

  FUNCTION upsert_(p_name VARCHAR2, p_body CLOB) RETURN NUMBER IS
  BEGIN
    CASE p_name
${names.map((n) => `      WHEN ${q(n)} THEN RETURN upsert_${MAP[n].table}_(p_body);`).join('\n')}
      ELSE RAISE_APPLICATION_ERROR(-20001, 'unknown table ' || p_name);
    END CASE;
  END;

  FUNCTION delete_(p_name VARCHAR2, p_body CLOB) RETURN NUMBER IS
  BEGIN
    CASE p_name
${names.map((n) => `      WHEN ${q(n)} THEN
        DELETE FROM ${MAP[n].table} WHERE ${MAP[n].cols[0][1]} IN
          (SELECT id FROM JSON_TABLE(p_body, '$.ids[*]' COLUMNS (id VARCHAR2(400 CHAR) PATH '$')));`).join('\n')}
      ELSE RAISE_APPLICATION_ERROR(-20001, 'unknown table ' || p_name);
    END CASE;
    RETURN SQL%ROWCOUNT;
  END;

  FUNCTION handle(p_body CLOB) RETURN CLOB IS
    l_action VARCHAR2(30);
    l_table  VARCHAR2(60);
    l_key    VARCHAR2(200);
    l_n      NUMBER;
    l_out    CLOB;
    l_first  BOOLEAN := TRUE;
  BEGIN
    IF p_body IS NULL OR p_body NOT LIKE '{%' THEN RETURN err_('bad request'); END IF;
    l_action := JSON_VALUE(p_body, '$.action');
    l_table  := JSON_VALUE(p_body, '$.table');
    l_key    := JSON_VALUE(p_body, '$.key');
    SELECT COUNT(*) INTO l_n FROM DMS_API_KEYS WHERE API_KEY = l_key AND l_key IS NOT NULL;
    IF l_n = 0 THEN RETURN err_('unauthorized'); END IF;

    IF l_action = 'health' THEN
      SELECT COUNT(*) INTO l_n FROM DMS_DOCUMENTS;
      RETURN '{"ok":true,"documents":' || l_n || '}';

    ELSIF l_action = 'dump' THEN
      DBMS_LOB.CREATETEMPORARY(l_out, TRUE);
      DBMS_LOB.APPEND(l_out, TO_CLOB('{"ok":true,"data":{'));
      FOR t IN (SELECT name FROM JSON_TABLE(p_body, '$.tables[*]' COLUMNS (name VARCHAR2(60) PATH '$'))) LOOP
        IF NOT l_first THEN DBMS_LOB.APPEND(l_out, TO_CLOB(',')); END IF;
        l_first := FALSE;
        DBMS_LOB.APPEND(l_out, TO_CLOB('"' || t.name || '":'));
        DBMS_LOB.APPEND(l_out, dump_one_(t.name));
      END LOOP;
      DBMS_LOB.APPEND(l_out, TO_CLOB('}}'));
      RETURN l_out;

    ELSIF l_action = 'upsert' THEN
      l_n := upsert_(l_table, p_body);
      COMMIT;
      RETURN '{"ok":true,"count":' || l_n || '}';

    ELSIF l_action = 'delete' THEN
      l_n := delete_(l_table, p_body);
      COMMIT;
      RETURN '{"ok":true,"count":' || l_n || '}';
    END IF;
    RETURN err_('unknown action');
  EXCEPTION
    WHEN OTHERS THEN
      ROLLBACK;
      RETURN err_(SQLERRM);
  END handle;

END DMS_API;
/
`;
fs.writeFileSync(path.join(root, 'ords', 'dms_api.sql'), pkg);

// ------------------------------------------------------------ مسار ORDS
const handler = `DECLARE
  l_out CLOB;
  l_pos PLS_INTEGER := 1;
  l_len PLS_INTEGER;
BEGIN
  l_out := DMS_API.handle(:body_text);
  owa_util.mime_header('application/json', TRUE, 'UTF-8');
  l_len := DBMS_LOB.GETLENGTH(l_out);
  WHILE l_pos <= l_len LOOP
    htp.prn(DBMS_LOB.SUBSTR(l_out, 4000, l_pos));
    l_pos := l_pos + 4000;
  END LOOP;
END;`;
const ords = `-- ============================================================
--  مسار ORDS للـ API:  POST <baseUrl>dms/api
--  شغّليه من نفس الـ schema اللي فيه appscript-test (اللي الـ alias بتاعه iraq)،
--  بعد schema.sql و dms_api.sql.
-- ============================================================
BEGIN
  ORDS.DEFINE_MODULE(
    p_module_name    => 'dms',
    p_base_path      => '/dms/',
    p_items_per_page => 0,
    p_status         => 'PUBLISHED',
    p_comments       => 'Al Omniyat DMS — Apps Script backend');

  ORDS.DEFINE_TEMPLATE(
    p_module_name => 'dms',
    p_pattern     => 'api');

  ORDS.DEFINE_HANDLER(
    p_module_name    => 'dms',
    p_pattern        => 'api',
    p_method         => 'POST',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_source         => ${q(handler)});
  COMMIT;
END;
/

-- مفتاح الـ API (غيّري القيمة لنص عشوائي طويل، ونفس القيمة تتحط في Script Properties باسم ORACLE_API_KEY):
-- INSERT INTO DMS_API_KEYS (API_KEY, NOTE) VALUES ('ضعي-هنا-مفتاح-طويل-عشوائي', 'Apps Script DMS copy');
-- COMMIT;

-- مهم: ضيفي الموديول dms لنفس الـ Privilege اللي حامي appscript-test
-- (SQL Workshop ← RESTful Services ← Privileges)، عشان محدش يوصله من غير الدخول.
`;
fs.writeFileSync(path.join(root, 'ords', 'dms_ords_module.sql'), ords);
console.log('done');

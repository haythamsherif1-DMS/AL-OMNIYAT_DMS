-- ============================================================
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
    p_source         => 'DECLARE
  l_out CLOB;
  l_pos PLS_INTEGER := 1;
  l_len PLS_INTEGER;
BEGIN
  l_out := DMS_API.handle(:body_text);
  owa_util.mime_header(''application/json'', TRUE, ''UTF-8'');
  l_len := DBMS_LOB.GETLENGTH(l_out);
  WHILE l_pos <= l_len LOOP
    htp.prn(DBMS_LOB.SUBSTR(l_out, 4000, l_pos));
    l_pos := l_pos + 4000;
  END LOOP;
END;');
  COMMIT;
END;
/

-- مفتاح الـ API (غيّري القيمة لنص عشوائي طويل، ونفس القيمة تتحط في Script Properties باسم ORACLE_API_KEY):
-- INSERT INTO DMS_API_KEYS (API_KEY, NOTE) VALUES ('ضعي-هنا-مفتاح-طويل-عشوائي', 'Apps Script DMS copy');
-- COMMIT;

-- مهم: ضيفي الموديول dms لنفس الـ Privilege اللي حامي appscript-test
-- (SQL Workshop ← RESTful Services ← Privileges)، عشان محدش يوصله من غير الدخول.

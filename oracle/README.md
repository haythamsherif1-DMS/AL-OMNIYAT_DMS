# نظام الوثائق DMS على Oracle (تجربة)

الواجهة (`index.html` في الريبو) بتفتح نظام Apps Script. الـ backend الحقيقي (البيانات) في Apps Script على Google Sheets.
الفولدر ده بيخلي **نسخة** من Apps Script تقرا وتكتب في Oracle بدل الشيت، من غير ما نغيّر الشاشات أو النظام الشغال.

## الطريقة الأساسية: Oracle REST (ORDS) على app.alomniyat.net

```
المتصفح ← Apps Script (نسخة DMS + Database.gs + OracleBackend.gs) ← oracleRequest('dms/api') ← ORDS ← باكدج DMS_API ← جداول DMS_*
```

| الملف | فيه إيه |
|---|---|
| `schema.sql` | الـ 17 جدول `DMS_*` + جدول `DMS_API_KEYS` |
| `ords/dms_api.sql` | باكدج `DMS_API` (قراءة/إضافة/تعديل/حذف) — أسماء الجداول والأعمدة ثابتة جواه |
| `ords/dms_ords_module.sql` | بيعمل مسار `POST .../dms/api` على ORDS |
| `apps-script/OracleBackend.gs` | بيتلزق **آخر ملف** في نسخة مشروع DMS (بعد Database.gs و PortalSSO.gs) |

### الخطوات
1. في Oracle، من نفس الـ schema اللي فيه `appscript-test` (SQL Workshop أو SQL Developer)، شغّلي بالترتيب:
   `schema.sql` ← `ords/dms_api.sql` ← `ords/dms_ords_module.sql`
2. ضيفي مفتاح طويل عشوائي:  `INSERT INTO DMS_API_KEYS (API_KEY) VALUES ('...'); COMMIT;`
3. ضيفي الموديول `dms` لنفس الـ Privilege اللي حامي `appscript-test` (RESTful Services ← Privileges).
4. في نسخة Apps Script: ضيفي `OracleBackend.gs` آخر ملف، وفي Script Properties: `ORACLE_API_KEY` = نفس المفتاح.
5. من المحرر بالترتيب: `oracleCheck` ← `oracleMigrateFromSheet` ← `oracleVerify`.
6. Deploy للنسخة دي بلينك تجربة وجرّبي.

متطلبات: Oracle 19c أو أحدث (JSON_TABLE بأعمدة CLOB)، و ORDS بيدعم `:body_text`.

## طريقة بديلة: سيرفر صغير على جهاز الشركة (`gateway/`)
لو ORDS مش متاح: `gateway/` سيرفر Node بيكلم Oracle مباشرة، ويتوصل لـ Apps Script بلينك cloudflared.
(الخطوات القديمة تحت.)

### خطوات الـ gateway (على جهاز الشركة — ويندوز)

1. Node.js 22 أو أحدث، وبعدين جوه `oracle/gateway`:  `npm.cmd install`
2. انسخي `.env.example` باسم `.env` واكتبي كلمة سر القاعدة و `GATEWAY_KEY`.
3. `npm.cmd run test-db` ← اختبار اتصال بس (قراءة فقط).
4. `npm.cmd run create-tables` ← بيعمل جداول `DMS_*` بس (مش بيلمس `PROJECTS` ولا جداول `PORTAL_*`).
5. نزّلي شيت الوثائق: File ← Download ← Microsoft Excel، وسميه `DMS_Database.xlsx` في فولدر `gateway`.
   `npm.cmd run migrate` ثم `npm.cmd run verify`.
   (كلمات السر بتتخزن متشفرة بنفس طريقة Code.gs، فكل واحد بيدخل بنفس كلمة السر.)
6. `npm.cmd start` وسيبي الشباك مفتوح. في شباك تاني: `cloudflared tunnel --url http://localhost:8788` وخدي اللينك.
7. في Apps Script: اعملي **نسخة** من مشروع الوثائق (أو من الشيت كله)، ضيفي `OracleBackend.gs` آخر ملف،
   وفي Script Properties حطي `ORACLE_API_URL` (اللينك) و `ORACLE_API_KEY` (نفس `GATEWAY_KEY`).
   شغّلي `oracleCheck` من المحرر، وبعدين Deploy للنسخة دي بلينك تجربة.

## الأمان
- ORDS: أي طلب من غير مفتاح موجود في `DMS_API_KEYS` بيترفض، وفوقها حماية الـ Privilege.
- الـ gateway: بيسمع على `127.0.0.1` بس، وأي طلب من غير `GATEWAY_KEY` بيترفض.
- أسماء الجداول والأعمدة ثابتة (`gateway/dms-map.json` ← `node tools/gen-sql.js` بيولّد الـ SQL)؛ مفيش SQL بيتبعت من برة.
- ملف `.env` و ملف الـ Excel مش بيترفعوا على GitHub (`.gitignore`).
- في النسخة التجريبية: الإيميل والواتساب متقفولين، والملفات بتترفع على فولدر تجربة لوحده، ومفيش حذف لملفات النظام الأصلي.

## اختبار من غير Oracle
`npm.cmd run selftest`

# نظام الوثائق DMS على Oracle (تجربة)

الواجهة (`index.html` في الريبو) بتفتح نظام Apps Script. الـ backend الحقيقي (البيانات) في Apps Script على Google Sheets.
الفولدر ده بيخلي **نسخة** من Apps Script تقرا وتكتب في Oracle بدل الشيت، من غير ما نغيّر الشاشات أو النظام الشغال.

```
المتصفح ← Apps Script (نسخة DMS + OracleBackend.gs) ← لينك cloudflared ← gateway على جهاز الشركة ← Oracle (10.176.0.162)
```

ليه سيرفر في النص؟ Oracle على عنوان داخلي (`10.176.0.162`)، وسيرفرات جوجل مش بتوصل للعناوين الداخلية.

| الفولدر | فيه إيه |
|---|---|
| `gateway/` | سيرفر Node صغير بيتشغّل على جهاز جوه الشركة (نفس فكرة سيرفر البوابة، بس على بورت 8788) |
| `apps-script/OracleBackend.gs` | بيتلزق آخر ملف في **نسخة** من مشروع DMS في Apps Script |
| `schema.sql` | الـ 17 جدول `DMS_*` (نفس اللي بيعمله `npm run create-tables`) |

## الخطوات (على جهاز الشركة — ويندوز)

1. Node.js 22 أو أحدث، وبعدين جوه `oracle/gateway`:  `npm.cmd install`
2. انسخي `.env.example` باسم `.env` واكتبي كلمة سر القاعدة و `GATEWAY_KEY`.
3. `npm.cmd run test-db` ← اختبار اتصال بس (قراءة فقط).
4. `npm.cmd run create-tables` ← بيعمل جداول `DMS_*` بس (مش بيلمس `PROJECTS` ولا جداول `PORTAL_*`).
5. نزّلي شيت الوثائق: File ← Download ← Microsoft Excel، وسميه `DMS_Database.xlsx` في فولدر `gateway`.
   `npm.cmd run migrate` ثم `npm.cmd run verify`.
   (كلمات السر بتتخزن متشفرة بنفس طريقة Code.gs، فكل واحد بيدخل بنفس كلمة السر.)
6. `npm.cmd start` وسيبي الشباك مفتوح. في شباك تاني: `cloudflared tunnel --url http://localhost:8788` وخدي اللينك.
7. في Apps Script: اعملي **نسخة** من مشروع الوثائق (أو من الشيت كله)، ضيفي `OracleBackend.gs` آخر ملف،
   وفي Script Properties حطي `ORACLE_GATEWAY_URL` (اللينك) و `ORACLE_GATEWAY_KEY` (نفس `GATEWAY_KEY`).
   شغّلي `oracleCheck` من المحرر، وبعدين Deploy للنسخة دي بلينك تجربة.

## الأمان
- السيرفر بيسمع على `127.0.0.1` بس، وأي طلب من غير `GATEWAY_KEY` بيترفض.
- أسماء الجداول والأعمدة ثابتة في `dms-map.json`؛ مفيش SQL بيتبعت من برة.
- ملف `.env` و ملف الـ Excel مش بيترفعوا على GitHub (`.gitignore`).
- في النسخة التجريبية: الإيميل والواتساب متقفولين، والملفات بتترفع على فولدر تجربة لوحده، ومفيش حذف لملفات النظام الأصلي.

## اختبار من غير Oracle
`npm.cmd run selftest`

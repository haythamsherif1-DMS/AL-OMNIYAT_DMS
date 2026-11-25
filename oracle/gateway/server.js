// تشغيل السيرفر:  npm.cmd start   (على ويندوز)  — لازم الجهاز على شبكة الشركة
const http = require('http');
const { makeHandler } = require('./app');
const store = require('./store');
const { explain } = require('./db');

const key = process.env.GATEWAY_KEY || '';
if (key.length < 32) {
  console.error('❌ GATEWAY_KEY في ملف .env لازم يكون 32 حرف على الأقل (شوفي الشرح في .env.example)');
  process.exit(1);
}
const PORT = Number(process.env.PORT || 8788);

store.ping()
  .then((n) => {
    http.createServer(makeHandler(store, key)).listen(PORT, '127.0.0.1', () => {
      console.log(`✅ متصل بـ Oracle — ${n} وثيقة في DMS_DOCUMENTS`);
      console.log(`✅ السيرفر شغال على http://localhost:${PORT}  (سيبي الشباك ده مفتوح)`);
    });
  })
  .catch((e) => { console.error('❌ ' + e.message); const x = explain(e); if (x) console.error(x); process.exit(1); });

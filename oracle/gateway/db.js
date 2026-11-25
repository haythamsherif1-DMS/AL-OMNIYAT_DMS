// اتصال Oracle مشترك (Thin mode — من غير Oracle Client). البيانات من ملف .env بس.
// التواريخ بتتحفظ بتوقيت بغداد (زي الشيت) مهما كان توقيت الجهاز.
process.env.TZ = process.env.TZ || 'Asia/Baghdad';
const oracledb = require('oracledb');
oracledb.fetchAsString = [oracledb.CLOB];

function cfg() {
  const { ORA_USER, ORA_PASSWORD, ORA_CONNECT } = process.env;
  if (!ORA_USER || !ORA_PASSWORD || !ORA_CONNECT) {
    console.error('❌ ناقص ORA_USER أو ORA_PASSWORD أو ORA_CONNECT في ملف .env');
    process.exit(1);
  }
  return { user: ORA_USER, password: ORA_PASSWORD, connectString: ORA_CONNECT };
}

function explain(e) {
  const m = String(e && e.message);
  if (/NJS-138|NJS-116|NJS-533/.test(m)) return 'القاعدة محتاجة Oracle Instant Client (Thick mode). ابعتي الرسالة لـ Claude.';
  if (/ETIMEDOUT|ECONNREFUSED|NJS-503|NJS-511|ENOTFOUND|EHOSTUNREACH/.test(m)) return 'الجهاز مش واصل للسيرفر. اتأكدي إنك على شبكة الشركة أو الـ VPN وإن البورت 1521 مفتوح.';
  if (/ORA-01017/.test(m)) return 'اسم المستخدم أو كلمة السر غلط.';
  if (/ORA-12514/.test(m)) return 'اسم الخدمة (dorradeve) مش متعرف على السيرفر — اتأكدي من الاسم مع مسؤول القاعدة.';
  if (/ORA-01031/.test(m)) return 'المستخدم معندوش صلاحية CREATE TABLE — اطلبيها من مسؤول القاعدة.';
  if (/ORA-00942/.test(m)) return 'الجداول لسه متعملتش: شغّلي npm.cmd run create-tables';
  return '';
}

async function connect() {
  try { return await oracledb.getConnection(cfg()); }
  catch (e) { console.error('❌ فشل الاتصال: ' + e.message); const x = explain(e); if (x) console.error(x); process.exit(1); }
}

let pool;
async function getPool() {
  if (!pool) pool = await oracledb.createPool({ ...cfg(), poolMin: 1, poolMax: 8, poolIncrement: 1, poolPingInterval: 30 });
  return pool;
}

module.exports = { oracledb, connect, getPool, explain };

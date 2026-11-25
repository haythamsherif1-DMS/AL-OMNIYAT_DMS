/**
 * ============================================================
 *  PortalSSO.gs — الدخول الموحد من «بوابة الأمنيات» (نسخة Oracle)
 *  إصدار: oracle-1 (2026-11-25)
 *
 *  لما النظام يتفتح من البوابة، البوابة بتبعت تذكرة موقّعة (?sso=...) صالحة دقيقتين،
 *  والنظام بيدخّل المستخدم على طول من غير شاشة الدخول.
 *
 *  الفرق عن نسخة الشيت:
 *   - مفيش أي قراءة من Google Sheets ولا Drive هنا: المستخدمين بيتقروا من rows_('Users')،
 *     واللي بيجيبها من Oracle (OracleBackend.gs / OracleData.gs).
 *   - الذاكرة المؤقتة بتاعة الشيت (portalFast) اتشالت، لأنها كانت مبنية على وقت تعديل ملف الشيت.
 *   - المفتاح السري مش مكتوب في الكود: بيتقري من Script Properties باسم PORTAL_SSO_SECRET
 *     (نفس قيمة SSO_SECRET في Vercel).
 *
 *  ترتيب الملفات: Code.gs … ثم PortalSSO.gs ثم ملف Oracle (OracleBackend.gs أو OracleData.gs) آخر واحد.
 * ============================================================
 */

function portalSsoSecret_() {
  var s = PropertiesService.getScriptProperties().getProperty('PORTAL_SSO_SECRET') || '';
  if (!s) throw new Error('الدخول من البوابة مش متظبط: ضيف PORTAL_SSO_SECRET في Script Properties');
  return s;
}

/** يتحقق من تذكرة البوابة: توقيع صحيح + لم تنتهِ (دقيقتين) + لم تُستخدم قبل كده + للنظام ده */
function portalSsoVerify_(token, systemId) {
  token = String(token || '');
  if (token.indexOf('.') < 0) return null;
  var parts = token.split('.'), body = parts[0], sig = parts[1];
  var expected = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(body, portalSsoSecret_())).replace(/=+$/, '');
  if (expected !== sig) return null;
  var padded = body + '==='.slice((body.length + 3) % 4);
  var data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString('UTF-8'));
  if (!data.exp || Date.now() / 1000 > data.exp) return null;
  if (systemId && data.s !== systemId) return null;
  var cache = CacheService.getScriptCache();
  if (data.nonce) {
    if (cache.get('portal_sso_' + data.nonce)) return null;
    cache.put('portal_sso_' + data.nonce, '1', 600);
  }
  return data; // { u: مستخدم البوابة, n: الاسم, acc: حسابه في النظام ده, email, s, exp }
}

/** يُستدعى من الواجهة: google.script.run.portalSso(token) */
function portalSso(ssoToken) {
  _tables = {}; _settings = null;
  var d = portalSsoVerify_(ssoToken, 'documents');
  if (!d) throw new Error('رابط الدخول من البوابة انتهى — ارجع للبوابة وافتح النظام تاني');
  // الربط: حسابه في البوابة (acc) ← اسم المستخدم أو البريد هنا، وبعدين اسم مستخدم البوابة نفسه
  var u = findLoginUser_(d.acc) || findLoginUser_(d.u) || (!d.acc ? findLoginUser_(d.email) : null);
  if (!u || u.Active === NO || u.Role === 'Contact') throw new Error('حسابك في البوابة مش مربوط بحساب نشط في النظام ده — سجّل دخول عادي أو كلّم مدير النظام');
  audit_(u, 'LOGIN', 'User', u.UserID, 'دخول من بوابة الأمنيات');
  return { token: newSession_(u) };
}

/* ============================================================
 *  الدخول باسم المستخدم
 *  عمود Username في جدول المستخدمين (USERNAME في DMS_USERS): الدخول باسم المستخدم أو البريد،
 *  والدخول الموحد من البوابة بيطابق حساب البوابة على اسم المستخدم هنا.
 * ============================================================ */
if (typeof SCHEMA !== 'undefined' && SCHEMA.Users && SCHEMA.Users.indexOf('Username') < 0) SCHEMA.Users.push('Username');

/** في Oracle العمود موجود من الأول — مفيش حاجة تتعمل في الشيت */
function ensureUsernameCol_() { if (SCHEMA.Users.indexOf('Username') < 0) SCHEMA.Users.push('Username'); }

/** يلاقي المستخدم باسم المستخدم الأول، وبعدين بالبريد. */
function findLoginUser_(id) {
  id = lc_(id);
  if (!id) return null;
  ensureUsernameCol_();
  var all = rows_('Users');
  return all.filter(function (x) { return lc_(x.Username) === id; })[0] ||
         all.filter(function (x) { return lc_(x.Email) === id; })[0] || null;
}

/* ============================================================
 *  التسريع القديم (ذاكرة الشيت) — اتشال في نسخة Oracle.
 *  الدوال دي فاضلة بس عشان لو فيه مؤقت (trigger) قديم بيناديها ميطلعش خطأ.
 *  شغّل stopWarmup مرة واحدة من المحرر عشان تمسح المؤقت القديم.
 * ============================================================ */
function portalWarm() { return 'التسريع بتاع الشيت مش مستخدم في نسخة Oracle'; }
function portalWarmTrigger() { stopWarmup(); }
function setupWarmup() { stopWarmup(); return portalWarm(); }
function stopWarmup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'portalWarmTrigger') ScriptApp.deleteTrigger(t);
  });
}

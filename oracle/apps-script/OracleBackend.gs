/* ============================================================
 *  OracleBackend.gs — نظام الوثائق DMS على قاعدة Oracle
 *  إصدار: oracle-trial-2 (2026-11-25) — بيكلم Oracle REST (ORDS) عن طريق oracleRequest
 *
 *  الملف ده بيتلزق في «نسخة» من مشروع Apps Script بتاع الوثائق بس (مش المشروع الشغال)،
 *  ولازم يبقى **آخر ملف** في قائمة الملفات.
 *
 *  اللي بيعمله:
 *   1) كل قراءة وكتابة للبيانات بتروح لـ Oracle عن طريق الـ API (POST dms/api على ORDS)،
 *      باستخدام oracleRequest اللي في Database.gs. نفس الكود ونفس الشاشات — التخزين بس اللي اتغير.
 *   2) كلمات السر بتتخزن في Oracle متشفرة (نفس hash_ اللي في Code.gs)، مش نص.
 *   4) oracleMigrateFromSheet بينقل بيانات الشيت الأصلي لـ Oracle (قراءة بس من الشيت)، و oracleVerify بيقارن.
 *   3) حماية: ممنوع يشتغل على الشيت الأصلي، والتنبيهات (واتساب/إيميل) متقفولة،
 *      ورفع الملفات بيروح على فولدر تجربة لوحده، ومفيش نقل أو حذف لملفات النظام الأصلي.
 *
 *  الإعداد (Project Settings ← Script Properties):
 *      ORACLE_API_KEY  = نفس المفتاح اللي اتحط في جدول DMS_API_KEYS
 *      ORACLE_API_PATH = (اختياري) مسار الـ API بعد baseUrl — الافتراضي dms/api
 *      ORACLE_API_URL  = (اختياري) لينك كامل، لو مفيش oracleRequest في المشروع
 *  وبعدين من المحرر بالترتيب: oracleCheck ← oracleMigrateFromSheet ← oracleVerify
 * ============================================================ */

var ORA_TRIAL = {
  liveSheetId: '1-AWUPjMrvBbzBUR9pEs5elZxSrq3ij7nuHmQQHsSQNs',   // شيت النظام الأصلي — ممنوع
  trialFolderName: 'DMS — نسخة Oracle تجريبية',
  lazy: { AuditLog: 1, Alerts: 1 },                               // جداول كبيرة بتتقرا لما تتطلب بس
  tables: ['Sectors', 'Companies', 'CompanySectors', 'Projects', 'DocCategories', 'DocTypes', 'Documents',
           'DocumentVersions', 'Users', 'Departments', 'DeptAccess', 'Favorites', 'AccessRules', 'Alerts',
           'AuditLog', 'Settings', 'Serials']
};
var ORA_NUM = { SortOrder: 1, CurrentVersion: 1, VersionNo: 1, SizeKB: 1, Seq: 1, Amount: 1, Year: 1, DaysLeft: 1 };

function oraProps_() {
  var p = PropertiesService.getScriptProperties();
  return {
    key: p.getProperty('ORACLE_API_KEY') || '',
    path: p.getProperty('ORACLE_API_PATH') || 'dms/api',
    url: p.getProperty('ORACLE_API_URL') || ''
  };
}
function oraOn_() {
  var c = oraProps_();
  return !!(c.key && (typeof oracleRequest === 'function' || c.url));
}
function oraHas_(name) { return ORA_TRIAL.tables.indexOf(name) >= 0; }
function oraIsDate_(c) { return c === 'Timestamp' || /At$/.test(c) || /Date$/.test(c); }

/** نداء الـ API على Oracle */
function oraCall_(action, body) {
  var c = oraProps_();
  var payload = Object.assign({ key: c.key, action: action }, body || {});
  var out;
  try {
    if (typeof oracleRequest === 'function' && !c.url) {
      out = oracleRequest(c.path, payload);              // Database.gs (نفس الدخول اللي شغال مع appscript-test)
    } else {
      var res = UrlFetchApp.fetch(c.url, {
        method: 'post', contentType: 'application/json; charset=UTF-8', muteHttpExceptions: true,
        payload: JSON.stringify(payload)
      });
      if (res.getResponseCode() >= 300) throw new Error('HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
      out = JSON.parse(res.getContentText() || '{}');
    }
  } catch (e) {
    throw new Error('Oracle API مش راضي يرد (' + action + '): ' + e.message);
  }
  if (typeof out === 'string') out = JSON.parse(out);
  if (!out || !out.ok) throw new Error('Oracle: ' + ((out && out.error) || 'رد فاضي'));
  return out;
}

// التواريخ رايحة جاية بتوقيت بغداد من غير منطقة زمنية:  2025-05-20T14:30:00
var ORA_TZ = 'Asia/Baghdad';
function oraDateOut_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var d = v instanceof Date ? v : null;
  if (!d) {
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00';
    d = new Date(s);
  }
  return isNaN(d) ? '' : Utilities.formatDate(d, ORA_TZ, "yyyy-MM-dd'T'HH:mm:ss");
}
function oraDateIn_(s) {
  s = String(s || '').trim();
  if (!s) return '';
  var d = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s) ? s + '+03:00' : s);
  return isNaN(d) ? '' : d;
}
/** كلمة السر: بتتبعت لـ Oracle متشفرة بنفس hash_ اللي في Code.gs */
function oraProtectUser_(r) {
  var pw = String(r.Password === null || r.Password === undefined ? '' : r.Password).trim();
  if (!pw) return r;
  var salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  r.Password = ''; r.Salt = salt; r.PasswordHash = hash_(salt, pw);
  return r;
}

// ---------------------------------------------------------------- تحويل القيم
function oraFromDb_(name, rec) {
  var o = {};
  SCHEMA[name].forEach(function (c) {
    var v = rec[c];
    if (v === null || v === undefined) v = '';
    else if (oraIsDate_(c)) v = oraDateIn_(v);
    else if (ORA_NUM[c] && v !== '') v = Number(v);
    o[c] = (typeof v === 'string') ? v.trim() : v;
  });
  return o;
}
function oraToDb_(name, o) {
  var r = {};
  SCHEMA[name].forEach(function (c) {
    var v = o.hasOwnProperty(c) ? o[c] : '';
    if (v === null || v === undefined || v === '') r[c] = '';
    else if (oraIsDate_(c)) r[c] = oraDateOut_(v);
    else if (v instanceof Date) r[c] = isNaN(v) ? '' : fmtDateTime_(v);
    else r[c] = (typeof v === 'number') ? v : String(v);
  });
  if (o._sheetRow) r._row = o._sheetRow;
  return name === 'Users' ? oraProtectUser_(r) : r;
}

// ---------------------------------------------------------------- طبقة البيانات على Oracle
var _oraLoaded = false;
function oraFakeSheet_(t) {
  return {
    deleteRow: function (rowNum) {
      var key = SCHEMA[t.name][0];
      var o = t.rows.filter(function (x) { return x._row === rowNum; })[0];
      if (!o) return;
      oraCall_('delete', { table: t.name, ids: [String(o[key])] });
      t.rows.splice(t.rows.indexOf(o), 1);
    },
    getRange: function () { throw new Error('العملية دي خاصة بالشيت ومش متاحة في نسخة Oracle'); },
    appendRow: function () { throw new Error('العملية دي خاصة بالشيت ومش متاحة في نسخة Oracle'); },
    getLastRow: function () { return t.rows.length + 1; },
    getLastColumn: function () { return t.headers.length; },
    getName: function () { return t.name; }
  };
}
function oraMakeTable_(name, recs) {
  var t = { name: name, headers: SCHEMA[name].slice(), rows: [], oracle: true, nextRow: 2 };
  (recs || []).forEach(function (rec) { var o = oraFromDb_(name, rec); o._row = t.nextRow++; t.rows.push(o); });
  t.sheet = oraFakeSheet_(t);
  return t;
}
function oraLoad_(names) {
  var want = names.filter(function (n) { return oraHas_(n) && !_tables[n]; });
  if (!want.length) return;
  var data = oraCall_('dump', { tables: want }).data || {};
  want.forEach(function (n) { _tables[n] = oraMakeTable_(n, data[n]); });
}
function oraTable_(name) {
  if (_tables[name]) return _tables[name];
  if (!_oraLoaded) {   // أول قراءة في الطلب: نجيب كل الجداول الصغيرة مرة واحدة
    _oraLoaded = true;
    oraLoad_(ORA_TRIAL.tables.filter(function (n) { return !ORA_TRIAL.lazy[n] || n === name; }));
  }
  if (!_tables[name]) oraLoad_([name]);
  return _tables[name];
}
function oraSave_(name, objs) {
  for (var i = 0; i < objs.length; i += 200) {
    oraCall_('upsert', { table: name, rows: objs.slice(i, i + 200).map(function (o) { return oraToDb_(name, o); }) });
  }
}

/** فحص سريع من المحرر: الاتصال وعدد الصفوف */
function oracleCheck() {
  var h = oraCall_('health');
  _tables = {}; _settings = null; _oraLoaded = false;
  var lines = ORA_TRIAL.tables.map(function (n) { return n + ': ' + table_(n).rows.length; });
  var msg = 'الاتصال بـ Oracle شغال ✓ (' + h.documents + ' وثيقة)\n\n' + lines.join('\n');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
  return msg;
}


// ---------------------------------------------------------------- نقل البيانات من الشيت الأصلي (قراءة فقط)
function oraReadLive_(name) {
  var sh = SpreadsheetApp.openById(ORA_TRIAL.liveSheetId).getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var cols = SCHEMA[name], key = cols[0], out = [], seen = {};
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (r.join('') === '') continue;
    var o = { _sheetRow: i + 1 };
    cols.forEach(function (c) { var j = headers.indexOf(c); var v = j >= 0 ? r[j] : ''; o[c] = typeof v === 'string' ? v.trim() : v; });
    var id = String(o[key]).trim();
    if (!id || seen[id]) continue;               // صف من غير رقم أو رقم مكرر
    seen[id] = 1;
    out.push(o);
  }
  return out;
}

/** بينقل كل أوراق الشيت الأصلي لـ Oracle — ينفع يتعاد، وبيكمل لوحده لو الوقت خلص */
function oracleMigrateFromSheet() {
  var t0 = Date.now(), props = PropertiesService.getScriptProperties();
  var st = JSON.parse(props.getProperty('ORA_MIGRATION') || '{"done":{},"table":"","offset":0}');
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'oracleMigrateFromSheet') ScriptApp.deleteTrigger(tr); });
  for (var t = 0; t < ORA_TRIAL.tables.length; t++) {
    var name = ORA_TRIAL.tables[t];
    if (st.done[name] !== undefined) continue;
    var rows = oraReadLive_(name);
    var from = st.table === name ? st.offset : 0;
    for (var i = from; i < rows.length; i += 200) {
      oraSave_(name, rows.slice(i, i + 200));
      st.table = name; st.offset = Math.min(i + 200, rows.length);
      props.setProperty('ORA_MIGRATION', JSON.stringify(st));
      if (Date.now() - t0 > 4.5 * 60 * 1000 && st.offset < rows.length) {
        ScriptApp.newTrigger('oracleMigrateFromSheet').timeBased().after(60 * 1000).create();
        console.log('⏸ الوقت قرب يخلص — وقفنا عند ' + name + ' صف ' + st.offset + ' وهنكمل لوحدنا بعد دقيقة');
        return;
      }
    }
    st.done[name] = rows.length; st.table = ''; st.offset = 0;
    props.setProperty('ORA_MIGRATION', JSON.stringify(st));
    console.log('✅ ' + name + ': ' + rows.length + ' صف');
  }
  props.deleteProperty('ORA_MIGRATION');
  console.log('🎉 النقل خلص — شغّل oracleVerify');
}

/** بيقارن عدد الصفوف بين الشيت الأصلي و Oracle */
function oracleVerify() {
  var data = oraCall_('dump', { tables: ORA_TRIAL.tables }).data || {}, ok = true, lines = [];
  ORA_TRIAL.tables.forEach(function (n) {
    var a = oraReadLive_(n).length, b = (data[n] || []).length;
    if (a !== b) ok = false;
    lines.push((a === b ? '✅ ' : '⚠️ ') + n + ': الشيت ' + a + ' | Oracle ' + b);
  });
  var msg = lines.join('\n') + (ok ? '\n\nكل الجداول متطابقة 👍' : '\n\nفيه فرق — شغّل oracleMigrateFromSheet تاني');
  console.log(msg);
  return msg;
}

// ---------------------------------------------------------------- التركيب فوق دوال الكود الأصلي
var ORA_BACKEND_ORIG = {};
(function () {
  var g = typeof globalThis !== 'undefined' ? globalThis : (function () { return this; })();
  ['table_', 'insert_', 'insertMany_', 'update_', 'deleteById_', 'deleteWhere_',
   'ss_', 'rootFolder_', 'pathKey_', 'storeFile_', 'trashFile_', 'relocateTypeFiles_', 'reorganizeDriveFiles', 'sendAlertEmail_', 'sendWhatsApp_',
   'bulkScan', 'bulkImport', 'bulkAuto', 'bulkAutoOn', 'onOpen'].forEach(function (fn) { if (typeof g[fn] === 'function') ORA_BACKEND_ORIG[fn] = g[fn]; });
  var O = ORA_BACKEND_ORIG;

  // ===== حماية الشيت الأصلي (شغالة دايماً)
  g.ss_ = function () {
    var s = O.ss_();
    if (s && s.getId() === ORA_TRIAL.liveSheetId) {
      throw new Error('حماية: النسخة دي متوصلة بالشيت الأصلي! امسح SPREADSHEET_ID من Project Settings ← Script properties.');
    }
    return s;
  };

  // ===== قائمة في الشيت
  g.onOpen = function (e) {
    try { if (O.onOpen) O.onOpen(e); } catch (x) {}
    try { SpreadsheetApp.getUi().createMenu('Oracle تجربة').addItem('فحص الاتصال وعدد الصفوف', 'oracleCheck').addToUi(); } catch (x) {}
  };

  if (!oraOn_()) return;

  // ===== عمود Username (PortalSSO.gs) موجود في جدول DMS_USERS من الأول
  if (typeof g.ensureUsernameCol_ === 'function') g.ensureUsernameCol_ = function () {
    if (SCHEMA.Users.indexOf('Username') < 0) SCHEMA.Users.push('Username');
  };

  // ===== البيانات
  g.table_ = function (name) { return oraHas_(name) ? oraTable_(name) : O.table_(name); };
  g.insert_ = function (name, obj) {
    if (!oraHas_(name)) return O.insert_(name, obj);
    var t = _tables[name] || (ORA_TRIAL.lazy[name] ? null : oraTable_(name)), o = {};
    SCHEMA[name].forEach(function (c) { o[c] = obj.hasOwnProperty(c) ? obj[c] : ''; });
    oraSave_(name, [o]);
    if (t) { o._row = t.nextRow++; t.rows.push(o); }
    return o;
  };
  g.insertMany_ = function (name, objs) {
    if (!oraHas_(name)) return O.insertMany_(name, objs);
    if (!objs.length) return;
    var t = _tables[name] || (ORA_TRIAL.lazy[name] ? null : oraTable_(name));
    var full = objs.map(function (obj) { var o = {}; SCHEMA[name].forEach(function (c) { o[c] = obj.hasOwnProperty(c) ? obj[c] : ''; }); return o; });
    oraSave_(name, full);
    if (t) full.forEach(function (o) { o._row = t.nextRow++; t.rows.push(o); });
  };
  g.update_ = function (name, id, patch) {
    if (!oraHas_(name)) return O.update_(name, id, patch);
    var o = findById_(name, id);
    if (!o) throw new Error('السجل غير موجود: ' + id);
    Object.keys(patch).forEach(function (k) { if (SCHEMA[name].indexOf(k) >= 0) o[k] = patch[k]; });
    oraSave_(name, [o]);
    return o;
  };
  g.deleteById_ = function (name, id) {
    if (!oraHas_(name)) return O.deleteById_(name, id);
    oraCall_('delete', { table: name, ids: [String(id)] });
    delete _tables[name];
  };
  g.deleteWhere_ = function (name, pred) {
    if (!oraHas_(name)) return O.deleteWhere_(name, pred);
    var t = oraTable_(name), key = SCHEMA[name][0];
    var ids = t.rows.filter(pred).map(function (r) { return String(r[key]); });
    if (ids.length) oraCall_('delete', { table: name, ids: ids });
    delete _tables[name];
    return ids.length;
  };

  // ===== Drive: فولدر تجربة لوحده، ومفيش نقل أو حذف لملفات النظام الأصلي
  g.rootFolder_ = function () {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('ORA_TRIAL_ROOT_ID');
    if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
    var nf = DriveApp.createFolder(ORA_TRIAL.trialFolderName);
    props.setProperty('ORA_TRIAL_ROOT_ID', nf.getId());
    return nf;
  };
  if (O.pathKey_) g.pathKey_ = function (names) { return 'oratrial_' + O.pathKey_(names); };
  if (O.storeFile_) g.storeFile_ = function (doc, file, versionNo) {
    var out = O.storeFile_(doc, file, versionNo);
    try { var f = DriveApp.getFileById(out.FileID); f.setDescription((f.getDescription() || '') + ' [ORACLE-TRIAL]'); } catch (e) {}
    return out;
  };
  g.trashFile_ = function (fileId) {
    try {
      var f = DriveApp.getFileById(fileId);
      if (String(f.getDescription() || '').indexOf('[ORACLE-TRIAL]') < 0) { console.log('تجربة: الملف ده من النظام الأصلي ومش هيتمسح ' + fileId); return false; }
      f.setTrashed(true); return true;
    } catch (e) { return false; }
  };
  g.relocateTypeFiles_ = function () { return 0; };
  g.reorganizeDriveFiles = function () {
    var msg = 'في النسخة التجريبية ترتيب ملفات Drive متقفل (علشان ما نحركش ملفات النظام الأصلي).';
    try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
    return msg;
  };

  // ===== التنبيهات متقفولة (علشان محدش من الموظفين يوصله واتساب أو إيميل من التجربة)
  g.sendAlertEmail_ = function () { return { ok: false, error: 'نسخة تجربة: الإيميل متقفل' }; };
  g.sendWhatsApp_ = function () { return { ok: false, error: 'نسخة تجربة: الواتساب متقفل' }; };

  // ===== الرفع الجماعي بيقرا من فولدر النظام الأصلي ← متقفل في التجربة
  ['bulkScan', 'bulkImport', 'bulkAuto', 'bulkAutoOn'].forEach(function (fn) {
    if (O[fn]) g[fn] = function () { throw new Error('الرفع الجماعي متقفل في النسخة التجريبية'); };
  });
})();

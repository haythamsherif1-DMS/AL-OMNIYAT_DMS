// قراءة ملف الشيت (.xlsx) — قراءة فقط
const ExcelJS = require('exceljs');
const MAP = require('./dms-map.json');

function cellValue(v) {
  if (v === null || v === undefined) return '';
  // إكسيل بيحفظ الوقت زي ما هو مكتوب (توقيت بغداد) — بنحافظ عليه زي ما هو من غير ما يتزحزح
  if (v instanceof Date) return new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds());
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);          // معادلة
    if (v.richText) return v.richText.map(t => t.text).join('');
    if ('text' in v) return v.text;                          // لينك
    if (v.error) return '';
  }
  return v;
}

async function readWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out = {};
  for (const [name, m] of Object.entries(MAP)) {
    const ws = wb.getWorksheet(name);
    if (!ws) { out[name] = null; continue; }
    const headers = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i] = String(cellValue(c.value)).trim(); });
    const idx = m.cols.map(([c]) => headers.indexOf(c));
    const rows = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const vals = idx.map(i => (i >= 0 ? cellValue(row.getCell(i).value) : ''));
      if (vals.every(v => v === '' )) continue;
      rows.push({ row: r, vals: vals.map(v => (typeof v === 'string' ? v.trim() : v)) });
    }
    out[name] = rows;
  }
  return out;
}

module.exports = { readWorkbook, MAP };

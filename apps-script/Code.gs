/**
 * 統計量化問卷後端（Google Apps Script，容器繫結版）
 * 對照 AHP 的 apps-script/Code.gs：同一套安裝流程，同一套刪除保護。
 *
 * 安裝步驟：
 *  1. 在 Google Drive 新建一個試算表（這就是資料庫，研究者自己擁有）。
 *  2. 在試算表裡點「擴充功能 → Apps Script」，把這支檔案整份貼上，存檔。
 *  3. （刪除保護用，可不設，但不設就不能從後台刪 Sheet 資料）
 *     左邊齒輪「專案設定 → 指令碼屬性」新增 ADMIN_CODE，值與網站
 *     config.js 的 adminCode 相同。
 *  4. 右上「部署 → 新增部署 → 類型：網頁應用程式」：
 *     執行身分選「我」，存取權選「任何人」，按「部署」，複製網頁應用程式網址。
 *  5. 把網址貼到網站 config.js 或各研究題目檔的 Apps Script 網址，重新推上 GitHub 即完成。
 *
 * 資料表：
 *  - 「填答原始資料」：一列一筆，含編號、時間、分組、背景、各題 Likert 分數，
 *    最後一欄 responses_json 是完整填答 JSON，後台讀回時靠它重算構面分數。
 *  - 「構面分數」：一列一筆：各構面平均分數、題數、Cronbach's α 計算用的原始題分
 *    由前端算好送來，本腳本不重算（若研究者在 Sheet 上手改原始值，請回網站用匯入／重算流程）。
 */
function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'list') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('填答原始資料');
    if (!sh) return out({ ok: true, records: [] });
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return out({ ok: true, records: [] });
    var jsonCol = values[0].length - 1;
    var records = [];
    for (var i = 1; i < values.length; i++) {
      try {
        var rec = JSON.parse(values[i][jsonCol]);
        if (rec && rec.responses) records.push(rec);
      } catch (err) { /* 這列沒有完整 JSON，跳過（人工新增的列請補 responses_json） */ }
    }
    return out({ ok: true, records: records });
  }
  return out({ ok: true, message: 'Stats questionnaire Apps Script is running. Use action=list.' });
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (payload.action === 'submit') {
      var raw = getOrCreateSheet(ss, '填答原始資料');
      if (raw.getLastRow() === 0) raw.appendRow(payload.rawHeaders);
      // rawRow 最後一欄已是完整填答 JSON（responses_json），後台讀回時靠它重算；勿刪此欄。
      raw.appendRow(payload.rawRow);

      var w = getOrCreateSheet(ss, '構面分數');
      if (w.getLastRow() === 0) w.appendRow(payload.scoreHeaders);
      w.appendRow(payload.scoreRow);
      return out({ ok: true, id: payload.record.id });
    }

    if (payload.action === 'delete') {
      var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_CODE');
      if (!expected || payload.adminCode !== expected) {
        return out({ ok: false, error: 'admin code mismatch or not set' });
      }
      var sh2 = ss.getSheetByName('填答原始資料');
      var w2 = ss.getSheetByName('構面分數');
      if (sh2) {
        var vals = sh2.getDataRange().getValues();
        for (var i = vals.length - 1; i >= 1; i--) {
          if (String(vals[i][0]) === String(payload.id)) sh2.deleteRow(i + 1);
        }
      }
      if (w2) {
        var vals2 = w2.getDataRange().getValues();
        for (var j = vals2.length - 1; j >= 1; j--) {
          if (String(vals2[j][0]) === String(payload.id)) w2.deleteRow(j + 1);
        }
      }
      return out({ ok: true });
    }

    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

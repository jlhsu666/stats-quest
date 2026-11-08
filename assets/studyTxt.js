// 統計量化問卷 — 研究題目純文字檔（.txt）解析器
// 對照 AHP 的 assets/studyTxt.js：同一套習慣。
//   # 開頭為註解行；空白行忽略；全形與半形標點（：/：、，/，）都可混用。
//   頂層鍵值行：研究標題、研究副標題、後台密碼、Apps Script 網址、
//     主要分組、分組選項、量表點數、量表標籤。
//   [背景欄位]：每行「欄位名稱：選項1，選項2」，代碼自動編為 bg1、bg2……
//     （收案後不要中途調整欄位順序，否則舊資料的欄位會對不上）。
//   [構面] 名稱：其後「定義：……」為構面定義，其餘每行「題目：說明」
//     （說明可省略，只寫題目亦可）。構面分數 = 該構面各題平均。
//   [問卷說明]：其後所有文字原樣保留為問卷開頭的說明（空行分段）。
//   [分析設定]：每行一種分析，寫法見 studies/template.txt：
//     卡方：A × B
//     平均數檢定：分組 → 構面1，構面2
//     共變異數：分組 → 依變項，控制 共變項
//     迴歸：依變項 ← 預測1，預測2
//     關聯：A × B
// 回傳 { ok, config, errors: [{line, message}], warnings: [{line, message}] }。
// config 形狀與 config.js 的單一研究設定相同，可直接取代 window.STATS_CONFIG。
(function () {
  'use strict';

  var TOP_KEYS = {
    '研究標題': 'studyTitle', 'studyTitle': 'studyTitle',
    '研究副標題': 'studySubtitle', 'studySubtitle': 'studySubtitle',
    '後台密碼': 'adminCode', 'adminCode': 'adminCode',
    'Apps Script 網址': 'appsScriptUrl', 'appsScriptUrl': 'appsScriptUrl',
    '主要分組': 'groupLabel', 'groupLabel': 'groupLabel',
    '分組選項': 'groupOptions', 'groupOptions': 'groupOptions',
    '量表點數': 'scalePoints', 'scalePoints': 'scalePoints',
    '量表標籤': 'scaleLabels', 'scaleLabels': 'scaleLabels'
  };
  var DEFAULT_PASSWORD = '123456';
  // 各點數的預設選項文字（由最不同意到最同意）；沒寫「量表標籤」時就用這組，
  // 選項只顯示文字，不顯示數字。
  var DEFAULT_LABELS = {
    2: ['不同意', '同意'],
    3: ['不同意', '普通', '同意'],
    4: ['非常不同意', '不同意', '同意', '非常同意'],
    5: ['非常不同意', '不同意', '普通', '同意', '非常同意'],
    6: ['非常不同意', '不同意', '有點不同意', '有點同意', '同意', '非常同意'],
    7: ['非常不同意', '不同意', '有點不同意', '普通', '有點同意', '同意', '非常同意']
  };

  function splitList(s) {
    return String(s).split(/[,，、]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function splitKV(line) {
    var i1 = line.indexOf('：'), i2 = line.indexOf(':');
    var i = -1;
    if (i1 >= 0 && i2 >= 0) i = Math.min(i1, i2); else i = Math.max(i1, i2);
    if (i < 0) return null;
    return { key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
  }
  function splitPair(s) {
    // A × B / A x B / A X B
    var parts = String(s).split(/×|x|X|\*/);
    if (parts.length !== 2) return null;
    return [parts[0].trim(), parts[1].trim()];
  }

  function parse(text) {
    var errors = [], warnings = [];
    var cfg = {
      studyTitle: '', studySubtitle: '統計量化問卷（Likert 五點量表）',
      appsScriptUrl: '', adminCode: '',
      groupLabel: '', groupOptions: [],
      scalePoints: 5, scaleLabels: DEFAULT_LABELS[5].slice(),
      backgroundFields: [], dimensions: [], intro: '',
      analysis: { chiSquare: [], meanTests: [], ancova: [], regression: [], correlation: [] }
    };
    var lines = String(text == null ? '' : text).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    var section = 'top'; // top | bg | dim | intro | analysis
    var curDim = null;
    var introLines = [];
    var seenTopKeys = {};
    var bgCount = 0;
    var scaleLabelsGiven = false;

    function isGroupLabel(l) { return cfg.groupLabel && l === cfg.groupLabel; }
    function isBackgroundLabel(l) { return cfg.backgroundFields.some(function (f) { return f.label === l; }); }
    function isDimName(l) { return cfg.dimensions.some(function (d) { return d.name === l; }); }
    function isCatVar(l) { return isGroupLabel(l) || isBackgroundLabel(l); }

    lines.forEach(function (raw, idx) {
      var ln = idx + 1;
      var line = raw.trim();
      var m = line.match(/^\[(.+?)\]\s*(.*)$/);
      if (m) {
        var head = m[1].trim(), rest = (m[2] || '').trim();
        if (head === '背景欄位') { section = 'bg'; curDim = null; }
        else if (head === '構面') {
          if (!rest) { errors.push({ line: ln, message: '「[構面]」後面要寫構面名稱，例如「[構面] AI 工具態度」。' }); section = 'top'; return; }
          section = 'dim';
          curDim = { name: rest, desc: '', items: [], itemDescs: [] };
          cfg.dimensions.push(curDim);
        }
        else if (head === '問卷說明') { section = 'intro'; curDim = null; }
        else if (head === '分析設定') { section = 'analysis'; curDim = null; }
        else errors.push({ line: ln, message: '不認識的區段「[' + head + ']」，可用區段：[背景欄位]、[構面]、[問卷說明]、[分析設定]。' });
        return;
      }
      if (section === 'intro') {
        if (line.charAt(0) === '#') return;
        introLines.push(raw.replace(/\s+$/, ''));
        return;
      }
      if (!line || line.charAt(0) === '#') return;

      if (section === 'top') {
        var kv = splitKV(line);
        if (!kv) { errors.push({ line: ln, message: '這一行看不懂，請寫成「鍵：值」的形式，例如「研究標題：……」。' }); return; }
        var field = TOP_KEYS[kv.key];
        if (!field) {
          errors.push({ line: ln, message: '不認識的設定鍵「' + kv.key + '」，可用鍵：研究標題、研究副標題、後台密碼、Apps Script 網址、主要分組、分組選項、量表點數、量表標籤。' });
          return;
        }
        if (seenTopKeys[field]) { errors.push({ line: ln, message: '「' + kv.key + '」重複出現，請只寫一次。' }); return; }
        seenTopKeys[field] = true;
        if (field === 'groupOptions') cfg.groupOptions = splitList(kv.value);
        else if (field === 'scalePoints') {
          var n = parseInt(kv.value, 10);
          if (!n || n < 2 || n > 7) { errors.push({ line: ln, message: '量表點數請填 2~7 的整數，例如 5。' }); return; }
          cfg.scalePoints = n;
        }
        else if (field === 'scaleLabels') { cfg.scaleLabels = splitList(kv.value); scaleLabelsGiven = true; }
        else cfg[field] = kv.value;
        return;
      }

      if (section === 'bg') {
        var bkv = splitKV(line);
        if (!bkv || !bkv.key) { errors.push({ line: ln, message: '背景欄位請寫成「欄位名稱：選項1，選項2」，例如「性別：男，女」。' }); return; }
        var opts = splitList(bkv.value);
        if (!opts.length) { errors.push({ line: ln, message: '背景欄位「' + bkv.key + '」至少要有一個選項。' }); return; }
        bgCount++;
        cfg.backgroundFields.push({ key: 'bg' + bgCount, label: bkv.key, options: opts });
        return;
      }

      if (section === 'dim') {
        if (!curDim) { errors.push({ line: ln, message: '構面內容前要先寫「[構面] 名稱」。' }); return; }
        var dkv = splitKV(line);
        if (dkv && dkv.key === '定義') {
          if (curDim.desc) { errors.push({ line: ln, message: '構面「' + curDim.name + '」的定義重複出現，請只寫一次。' }); return; }
          curDim.desc = dkv.value;
          return;
        }
        var itemName = dkv ? dkv.key : line;
        var itemDesc = dkv ? dkv.value : '';
        if (!itemName) { errors.push({ line: ln, message: '題目名稱不可為空。' }); return; }
        curDim.items.push(itemName);
        curDim.itemDescs.push(itemDesc);
        return;
      }

      if (section === 'analysis') {
        var akv = splitKV(line);
        if (!akv) { errors.push({ line: ln, message: '分析設定請寫成「方法：內容」，例如「卡方：性別 × 年齡」。' }); return; }
        var kind = akv.key, val = akv.value;
        if (kind === '卡方' || kind === '卡方檢定') {
          var p = splitPair(val);
          if (!p || !p[0] || !p[1]) { errors.push({ line: ln, message: '卡方請寫成「卡方：A × B」，A、B 須是背景欄位或主要分組。' }); return; }
          if (!isCatVar(p[0])) { errors.push({ line: ln, message: '卡方的「' + p[0] + '」不是背景欄位或主要分組，卡方只吃類別變項。' }); return; }
          if (!isCatVar(p[1])) { errors.push({ line: ln, message: '卡方的「' + p[1] + '」不是背景欄位或主要分組，卡方只吃類別變項。' }); return; }
          cfg.analysis.chiSquare.push([p[0], p[1]]);
          return;
        }
        if (kind === '平均數檢定' || kind === '平均數') {
          // 分組 → 構面1，構面2
          var arrow = val.match(/→|->|=>/);
          if (!arrow) { errors.push({ line: ln, message: '平均數檢定請寫成「平均數檢定：分組 → 構面1，構面2」。' }); return; }
          var grp = val.slice(0, arrow.index).trim();
          var outs = splitList(val.slice(arrow.index + arrow[0].length));
          if (!isCatVar(grp)) { errors.push({ line: ln, message: '平均數檢定的分組「' + grp + '」不是背景欄位或主要分組。' }); return; }
          var badOut = outs.filter(function (o) { return !isDimName(o); });
          if (!outs.length || badOut.length) { errors.push({ line: ln, message: '平均數檢定的依變項「' + (badOut[0] || '') + '」不是構面名稱，請確認與上方 [構面] 完全相同。' }); return; }
          cfg.analysis.meanTests.push({ group: grp, outcomes: outs });
          return;
        }
        if (kind === '共變異數' || kind === '共變異數檢定' || kind === 'ANCOVA') {
          // 分組 → 依變項，控制 共變項
          var a2 = val.match(/→|->|=>/);
          if (!a2) { errors.push({ line: ln, message: '共變異數請寫成「共變異數：分組 → 依變項，控制 共變項」。' }); return; }
          var g2 = val.slice(0, a2.index).trim();
          var rest2 = val.slice(a2.index + a2[0].length).trim();
          var ctrlM = rest2.match(/[,，]\s*控制\s*[:：]?\s*(.+)$/);
          if (!ctrlM) { errors.push({ line: ln, message: '共變異數要寫「，控制 共變項」，例如「共變異數：任教年段 → 備課成效感受，控制 AI 工具態度」。' }); return; }
          var out2 = rest2.slice(0, ctrlM.index).trim();
          var cov = ctrlM[1].trim();
          if (!isCatVar(g2)) { errors.push({ line: ln, message: '共變異數的分組「' + g2 + '」不是背景欄位或主要分組。' }); return; }
          if (!isDimName(out2)) { errors.push({ line: ln, message: '共變異數的依變項「' + out2 + '」不是構面名稱。' }); return; }
          if (!isDimName(cov)) { errors.push({ line: ln, message: '共變異數的共變項「' + cov + '」不是構面名稱（共變項須是連續分數，例如另一構面分數）。' }); return; }
          cfg.analysis.ancova.push({ group: g2, outcome: out2, covariate: cov });
          return;
        }
        if (kind === '迴歸' || kind === '線性迴歸' || kind === '迴歸分析') {
          // 依變項 ← 預測1，預測2
          var a3 = val.match(/←|<-|<=/);
          if (!a3) { errors.push({ line: ln, message: '迴歸請寫成「迴歸：依變項 ← 預測1，預測2」。' }); return; }
          var y = val.slice(0, a3.index).trim();
          var preds = splitList(val.slice(a3.index + a3[0].length));
          if (!isDimName(y)) { errors.push({ line: ln, message: '迴歸的依變項「' + y + '」不是構面名稱。' }); return; }
          var badP = preds.filter(function (o) { return !isDimName(o) && !isCatVar(o); });
          if (!preds.length || badP.length) { errors.push({ line: ln, message: '迴歸的預測變項「' + (badP[0] || '') + '」不是構面或背景欄位名稱。' }); return; }
          cfg.analysis.regression.push({ outcome: y, predictors: preds });
          return;
        }
        if (kind === '關聯' || kind === '關聯分析' || kind === '相關') {
          var p2 = splitPair(val);
          if (!p2 || !p2[0] || !p2[1]) { errors.push({ line: ln, message: '關聯請寫成「關聯：A × B」，A、B 須是構面名稱。' }); return; }
          if (!isDimName(p2[0]) || !isDimName(p2[1])) { errors.push({ line: ln, message: '關聯的「' + p2[0] + ' × ' + p2[1] + '」須都是構面名稱。' }); return; }
          cfg.analysis.correlation.push([p2[0], p2[1]]);
          return;
        }
        errors.push({ line: ln, message: '不認識的分析方法「' + kind + '」，可用：卡方、平均數檢定、共變異數、迴歸、關聯。' });
        return;
      }
    });

    cfg.intro = introLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    if (!cfg.studyTitle) errors.push({ line: 0, message: '缺少「研究標題」，請在檔案開頭寫「研究標題：……」。' });
    if (!cfg.adminCode) errors.push({ line: 0, message: '缺少「後台密碼」，請寫「後台密碼：……」（密碼跟著題目走，每個研究各自一組）。' });
    if (cfg.dimensions.length < 2) errors.push({ line: 0, message: '至少要有 2 個構面（目前 ' + cfg.dimensions.length + ' 個），請用「[構面] 名稱」新增。' });
    var dimNames = {};
    cfg.dimensions.forEach(function (d) {
      if (dimNames[d.name]) errors.push({ line: 0, message: '構面名稱「' + d.name + '」重複出現。' });
      dimNames[d.name] = true;
      if (d.items.length < 2) errors.push({ line: 0, message: '構面「' + d.name + '」至少要有 2 個題目（目前 ' + d.items.length + ' 個）。' });
      var itemNames = {};
      d.items.forEach(function (it) {
        if (itemNames[it]) errors.push({ line: 0, message: '構面「' + d.name + '」的題目「' + it + '」重複出現。' });
        itemNames[it] = true;
      });
      while (d.itemDescs.length < d.items.length) d.itemDescs.push('');
      d.itemDescs = d.itemDescs.slice(0, d.items.length);
    });
    // 量表標籤與點數一致；未給標籤時用該點數的預設中文標籤（2~7 點都有）。
    if (scaleLabelsGiven && cfg.scaleLabels.length !== cfg.scalePoints) {
      errors.push({ line: 0, message: '量表標籤共 ' + cfg.scaleLabels.length + ' 個，但量表點數是 ' + cfg.scalePoints + '，兩邊數量要相同。' });
    } else if (!scaleLabelsGiven) {
      cfg.scaleLabels = (DEFAULT_LABELS[cfg.scalePoints] || []).slice();
    }
    if (!cfg.appsScriptUrl) warnings.push({ line: 0, message: '未填「Apps Script 網址」，此研究為本機模式：填答只存在填答者瀏覽器，不寫入試算表。' });
    if (cfg.adminCode === DEFAULT_PASSWORD) warnings.push({ line: 0, message: '後台密碼還是預設值，請改成自己的密碼再發連結。' });
    if (cfg.groupLabel && !cfg.groupOptions.length) warnings.push({ line: 0, message: '已設「主要分組」但未填「分組選項」，填答時分組下拉會是空的。' });

    return { ok: errors.length === 0, config: cfg, errors: errors, warnings: warnings };
  }

  var api = { parse: parse, DEFAULT_PASSWORD: DEFAULT_PASSWORD, DEFAULT_LABELS: DEFAULT_LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.StudyTxt = api;
})();

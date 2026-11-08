// 統計量化問卷 — 報告計算（純函數，不碰 DOM）
// 輸入：records（app.js 的填答紀錄）、config、opts
// 輸出：結構化結果，app.js 只負責排版；Node 可直接驗證。
// 記錄形狀：{ id, submitted_at, group, background:{key:值}, responses:{dimIdx:{itemIdx:1..5}}, scores:{構面名:平均} }
(function (global) {
  'use strict';
  function S() { return (typeof STATS !== 'undefined') ? STATS : require('./stats.js'); }

  function getField(rec, config, label) {
    if (config.groupLabel && label === config.groupLabel) return rec.group;
    var f = config.backgroundFields.find(function (x) { return x.label === label; });
    if (f) return rec.background ? rec.background[f.key] : undefined;
    return undefined;
  }
  function fieldOptions(config, label) {
    if (config.groupLabel && label === config.groupLabel) return config.groupOptions;
    var f = config.backgroundFields.find(function (x) { return x.label === label; });
    return f ? f.options : [];
  }
  function dimScores(records, dimName) { return records.map(function (r) { return r.scores[dimName]; }).filter(function (v) { return typeof v === 'number'; }); }
  function groupValues(records, config, label) {
    var opts = fieldOptions(config, label);
    var map = {};
    opts.forEach(function (o) { map[o] = []; });
    records.forEach(function (r) {
      var v = getField(r, config, label);
      if (v !== undefined && v !== '' && map[v] === undefined) map[v] = [];
      if (v !== undefined && v !== '') map[v].push(r);
    });
    return map;
  }
  function dist(records, config, label) {
    var opts = fieldOptions(config, label);
    var counts = {}; opts.forEach(function (o) { counts[o] = 0; });
    var other = 0;
    records.forEach(function (r) {
      var v = getField(r, config, label);
      if (counts[v] !== undefined) counts[v]++; else other++;
    });
    var rows = opts.map(function (o) { return { value: o, n: counts[o], pct: records.length ? counts[o] / records.length * 100 : 0 }; });
    if (other) rows.push({ value: '其他／未填', n: other, pct: records.length ? other / records.length * 100 : 0 });
    return rows;
  }
  function contingency(records, config, labelA, labelB) {
    var aOpts = fieldOptions(config, labelA), bOpts = fieldOptions(config, labelB);
    var table = aOpts.map(function () { return bOpts.map(function () { return 0; }); });
    records.forEach(function (r) {
      var a = getField(r, config, labelA), b = getField(r, config, labelB);
      var i = aOpts.indexOf(a), j = bOpts.indexOf(b);
      if (i >= 0 && j >= 0) table[i][j]++;
    });
    return { rowLabels: aOpts, colLabels: bOpts, table: table };
  }

  function buildReportData(records, config, opts) {
    var stats = S();
    opts = opts || {};
    var alpha = opts.alpha || 0.05;
    var warnings = [];
    var out = { n: records.length, alpha: alpha, warnings: warnings, sample: {}, descriptive: [], chiSquare: [], meanTests: [], ancova: [], correlation: null, regression: [] };
    if (!records.length) { warnings.push('目前沒有填答紀錄，請先填答或載入示範資料。'); return out; }

    // ---- 樣本分布 ----
    out.sample.groups = [];
    if (config.groupLabel) out.sample.groups.push({ label: config.groupLabel, rows: dist(records, config, config.groupLabel) });
    config.backgroundFields.forEach(function (f) {
      out.sample.groups.push({ label: f.label, rows: dist(records, config, f.label) });
    });

    // ---- 描述統計＋信度 ----
    config.dimensions.forEach(function (dim, di) {
      var scores = dimScores(records, dim.name);
      var d = stats.describe(scores);
      // Cronbach's α：每位受訪者該構面各題分數
      var matrix = records.map(function (r) {
        return dim.items.map(function (_, ii) { return r.responses && r.responses[di] ? r.responses[di][ii] : null; });
      }).filter(function (row) { return row.every(function (v) { return typeof v === 'number'; }); });
      var alphaVal = matrix.length >= 3 ? stats.cronbachAlpha(matrix) : null;
      out.descriptive.push({
        name: dim.name, k: dim.items.length, n: d ? d.n : 0,
        mean: d ? d.mean : null, sd: d ? d.sd : null, min: d ? d.min : null, max: d ? d.max : null,
        cronbachAlpha: alphaVal,
        alphaNote: alphaVal === null ? '有效題分不足，無法計算' : (alphaVal < 0.7 ? 'α<.70，信度偏低，解釋構面分數時請謹慎' : '')
      });
    });

    // ---- 卡方：指定＋預設（背景兩兩） ----
    var chiPairs = (config.analysis && config.analysis.chiSquare && config.analysis.chiSquare.length)
      ? config.analysis.chiSquare.slice() : [];
    if (!chiPairs.length) {
      var catLabels = [];
      if (config.groupLabel) catLabels.push(config.groupLabel);
      config.backgroundFields.forEach(function (f) { catLabels.push(f.label); });
      for (var i = 0; i < catLabels.length; i++) for (var j = i + 1; j < catLabels.length; j++) chiPairs.push([catLabels[i], catLabels[j]]);
    }
    if (opts.runChiSquare !== false) chiPairs.forEach(function (pair) {
      var ct = contingency(records, config, pair[0], pair[1]);
      var r = stats.chiSquare(ct.table);
      out.chiSquare.push({ varA: pair[0], varB: pair[1], rowLabels: ct.rowLabels, colLabels: ct.colLabels, table: ct.table, result: r });
    });

    // ---- 平均數檢定：指定＋預設（每個背景 × 每個構面） ----
    var meanSpecs = (config.analysis && config.analysis.meanTests && config.analysis.meanTests.length)
      ? config.analysis.meanTests.slice() : [];
    if (!meanSpecs.length) {
      var gLabels = [];
      if (config.groupLabel) gLabels.push(config.groupLabel);
      config.backgroundFields.forEach(function (f) { gLabels.push(f.label); });
      gLabels.forEach(function (g) {
        meanSpecs.push({ group: g, outcomes: config.dimensions.map(function (d) { return d.name; }) });
      });
    }
    if (opts.runMeanTests !== false) meanSpecs.forEach(function (spec) {
      var gv = groupValues(records, config, spec.group);
      var levels = Object.keys(gv).filter(function (k) { return gv[k].length > 0; });
      spec.outcomes.forEach(function (outcome) {
        if (levels.length < 2) { warnings.push('平均數檢定「' + spec.group + ' → ' + outcome + '」：有效組別少於 2 組，跳過。'); return; }
        if (levels.length === 2) {
          var a = gv[levels[0]].map(function (r) { return r.scores[outcome]; });
          var b = gv[levels[1]].map(function (r) { return r.scores[outcome]; });
          var t = stats.tIndependent(a, b);
          var lev = stats.levene([a, b]);
          out.meanTests.push({ kind: 't', group: spec.group, outcome: outcome, levels: levels, result: t, levene: lev });
        } else {
          var groups = levels.map(function (lv) { return gv[lv].map(function (r) { return r.scores[outcome]; }); });
          var anova = stats.oneWayANOVA(groups);
          var lev2 = stats.levene(groups);
          out.meanTests.push({ kind: 'anova', group: spec.group, outcome: outcome, levels: levels, result: anova, levene: lev2 });
        }
      });
    });

    // ---- 共變異數 ----
    var ancovaSpecs = (config.analysis && config.analysis.ancova) || [];
    if (opts.runAncova !== false) ancovaSpecs.forEach(function (spec) {
      var gv2 = groupValues(records, config, spec.group);
      var levels2 = Object.keys(gv2).filter(function (k) { return gv2[k].length > 0; });
      if (levels2.length < 2) { warnings.push('共變異數「' + spec.group + ' → ' + spec.outcome + '」：有效組別少於 2 組，跳過。'); return; }
      var yGroups = levels2.map(function (lv) { return gv2[lv].map(function (r) { return r.scores[spec.outcome]; }); });
      var xGroups = levels2.map(function (lv) { return gv2[lv].map(function (r) { return r.scores[spec.covariate]; }); });
      var r = stats.ancova(yGroups, xGroups, levels2);
      out.ancova.push({ group: spec.group, outcome: spec.outcome, covariate: spec.covariate, levels: levels2, result: r });
    });

    // ---- 關聯：相關矩陣＋指定配對 ----
    if (opts.runCorrelation !== false) {
      var names = config.dimensions.map(function (d) { return d.name; });
      var matrix = {};
      names.forEach(function (a) {
        matrix[a] = {};
        names.forEach(function (b) {
          if (a === b) { matrix[a][b] = { r: 1, p: 0 }; return; }
          var pr = stats.pearson(dimScores(records, a), dimScores(records, b));
          matrix[a][b] = pr;
        });
      });
      var pairs = [];
      var corrSpecs = (config.analysis && config.analysis.correlation && config.analysis.correlation.length)
        ? config.analysis.correlation : [];
      corrSpecs.forEach(function (pair) {
        var pr2 = stats.pearson(dimScores(records, pair[0]), dimScores(records, pair[1]));
        var sp = stats.spearman(dimScores(records, pair[0]), dimScores(records, pair[1]));
        pairs.push({ a: pair[0], b: pair[1], pearson: pr2, spearman: sp });
      });
      out.correlation = { names: names, matrix: matrix, pairs: pairs };
    }

    // ---- 線性迴歸 ----
    var regSpecs = (config.analysis && config.analysis.regression) || [];
    if (opts.runRegression !== false) regSpecs.forEach(function (spec) {
      var y = records.map(function (r) { return r.scores[spec.outcome]; });
      var preds = {};
      spec.predictors.forEach(function (pn) {
        if (config.dimensions.some(function (d) { return d.name === pn; })) {
          preds[pn] = records.map(function (r) { return r.scores[pn]; });
        } else {
          // 類別預測變項：轉虛擬變項（第一組為參照組）
          var opts2 = fieldOptions(config, pn);
          opts2.slice(1).forEach(function (lv) {
            preds[pn + '＝' + lv] = records.map(function (r) { return getField(r, config, pn) === lv ? 1 : 0; });
          });
        }
      });
      var r = stats.linearRegression(preds, y);
      out.regression.push({ outcome: spec.outcome, predictors: Object.keys(preds), result: r });
    });

    return out;
  }

  var API = { buildReportData: buildReportData, getField: getField, fieldOptions: fieldOptions, dist: dist, contingency: contingency };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.StatsReport = API;
})(typeof window !== 'undefined' ? window : globalThis);

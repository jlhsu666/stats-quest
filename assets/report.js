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
      // 各題項現況（論文表4-2-2 格式）：每題平均數、標準差、構面內排序
      var itemStats = dim.items.map(function (it, ii) {
        var vals = records.map(function (r) { return r.responses && r.responses[di] ? r.responses[di][ii] : null; }).filter(function (v) { return typeof v === 'number'; });
        var dd = vals.length ? stats.describe(vals) : null;
        return { item: it, n: dd ? dd.n : 0, mean: dd ? dd.mean : null, sd: dd ? dd.sd : null, min: dd ? dd.min : null, max: dd ? dd.max : null, rank: 0 };
      });
      itemStats.slice().sort(function (a, b) { return (b.mean || 0) - (a.mean || 0); }).forEach(function (it, i) { it.rank = i + 1; });
      out.descriptive.push({
        name: dim.name, k: dim.items.length, n: d ? d.n : 0,
        mean: d ? d.mean : null, sd: d ? d.sd : null, min: d ? d.min : null, max: d ? d.max : null,
        cronbachAlpha: alphaVal,
        alphaNote: alphaVal === null ? '有效題分不足，無法計算' : (alphaVal < 0.6 ? 'α<.60，信度偏低，解釋構面分數時請謹慎' : (alphaVal < 0.7 ? 'α介於 .60–.69，信度可接受' : '')),
        items: itemStats
      });
    });
    // 構面平均數排序（論文表4-2-1「排序」欄）
    out.descriptive.slice().sort(function (a, b) { return (b.mean || 0) - (a.mean || 0); }).forEach(function (d, i) { d.rank = i + 1; });

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

    // ---- 敘述文字（論文第四章「由表4-x-x可知，……」句型，數字由上面結果帶入） ----
    out.narratives = buildNarratives(out, config, opts);

    return out;
  }

  // 相關強度（論文慣例）：|r|≥.70 高度，.40–.69 中度，.20–.39 低度，<.20 微弱
  function corrStrength(r) {
    var a = Math.abs(r);
    var s = a >= 0.7 ? '高度' : a >= 0.4 ? '中度' : a >= 0.2 ? '低度' : '微弱';
    return s + (r >= 0 ? '正相關' : '負相關');
  }
  function n2(x) { return (x === null || x === undefined || !isFinite(x)) ? '—' : x.toFixed(2); }
  function n3(x) { return (x === null || x === undefined || !isFinite(x)) ? '—' : x.toFixed(3); }
  function pWord(p) { return (p !== null && p !== undefined && isFinite(p) && p < 0.05) ? 'p<0.05' : 'p>0.05'; }
  function buildNarratives(data, config, opts) {
    opts = opts || {};
    var nav = { intro: '', sample: '', descriptive: '', items: [], chiSquare: [], meanTests: [], ancova: [], correlation: '', regression: [] };
    // 章首引言：樣本數＋本章節次
    var secs = ['第一節 樣本基本資料分析', '第二節 描述統計與信度分析'];
    if (opts.runChiSquare !== false) secs.push('第三節 卡方檢定');
    if (opts.runMeanTests !== false) secs.push('第四節 平均數檢定');
    if (opts.runAncova !== false) secs.push('第五節 共變異數分析');
    if (opts.runCorrelation !== false) secs.push('第六節 關聯分析');
    if (opts.runRegression !== false) secs.push('第七節 線性迴歸分析');
    nav.intro = '本研究有效問卷共 ' + data.n + ' 份。本章共分為' + secs.length + '節，' + secs.join('；') + '。';
    // 第一節：各背景變項人數最多的類別
    nav.sample = data.sample.groups.map(function (g) {
      if (!g.rows.length) return '';
      var top = g.rows.slice().sort(function (a, b) { return b.n - a.n; })[0];
      return '「' + g.label + '」以「' + top.value + '」人數最多（' + top.n + ' 人，占 ' + top.pct.toFixed(1) + '%）';
    }).filter(Boolean).join('；') + '。';
    // 第二節：構面平均數排序＋信度
    if (data.descriptive.length) {
      var ordered = data.descriptive.slice().sort(function (a, b) { return (b.mean || 0) - (a.mean || 0); });
      var top = ordered[0], bottom = ordered[ordered.length - 1];
      nav.descriptive = '各構面平均數以「' + top.name + '」最高（M=' + n2(top.mean) + '，SD=' + n2(top.sd) + '）' +
        (ordered.length > 2 ? '，其次依序為' + ordered.slice(1, -1).map(function (d) { return '「' + d.name + '」（M=' + n2(d.mean) + '）'; }).join('、') : '') +
        '；「' + bottom.name + '」最低（M=' + n2(bottom.mean) + '，SD=' + n2(bottom.sd) + '）。';
      var alphas = data.descriptive.map(function (d) { return d.cronbachAlpha; }).filter(function (v) { return typeof v === 'number'; });
      if (alphas.length) {
        var lo = Math.min.apply(null, alphas), hi = Math.max.apply(null, alphas);
        var lowDims = data.descriptive.filter(function (d) { return typeof d.cronbachAlpha === 'number' && d.cronbachAlpha < 0.7; });
        nav.descriptive += '各構面 Cronbach\'s α 介於 ' + n3(lo) + ' 至 ' + n3(hi) + ' 之間' +
          (lowDims.length ? '，其中「' + lowDims.map(function (d) { return d.name; }).join('」、「') + '」α 低於 .70，信度尚待提升' : '，均大於 .70，顯示量表具有良好的內部一致性信度') + '。';
      }
      data.descriptive.forEach(function (d) {
        var topItem = (d.items || []).slice().sort(function (a, b) { return (b.mean || 0) - (a.mean || 0); })[0];
        if (topItem) nav.items.push('「' + d.name + '」構面中平均數最高的題項為「' + topItem.item + '」（M=' + n2(topItem.mean) + '，SD=' + n2(topItem.sd) + '）。');
      });
    }
    // 第三節：卡方
    data.chiSquare.forEach(function (c) {
      var r = c.result;
      nav.chiSquare.push('「' + c.varA + '」與「' + c.varB + '」的卡方檢定結果' +
        (r.significant ? '達顯著' : '未達顯著') + '（χ²=' + n3(r.chi2) + '，df=' + r.df + '，' + pWord(r.p) + '），' +
        (r.significant ? '顯示兩變項有關聯' : '顯示兩變項無顯著關聯') + '；Cramer\'s V=' + n3(r.cramerV) + '。');
    });
    // 第四節：平均數檢定
    data.meanTests.forEach(function (m) {
      if (m.kind === 't') {
        var t = m.result, hi = t.mean1 >= t.mean2 ? 0 : 1, loI = 1 - hi;
        nav.meanTests.push('「' + m.group + '」在「' + m.outcome + '」上的差異' +
          (t.welch.significant ? '達顯著' : '未達顯著') + '（t=' + n3(t.welch.t) + '，' + pWord(t.welch.p) + '）' +
          (t.welch.significant ? '，「' + m.levels[hi] + '」（M=' + n2(hi === 0 ? t.mean1 : t.mean2) + '）高於「' + m.levels[loI] + '」（M=' + n2(loI === 0 ? t.mean1 : t.mean2) + '）' : '，顯示兩組在「' + m.outcome + '」上無顯著差異') + '。');
      } else {
        var a = m.result;
        var sigPairs = a.postHoc.filter(function (p) { return p.pBonf < 0.05; });
        nav.meanTests.push('「' + m.group + '」在「' + m.outcome + '」上的差異' +
          (a.significant ? '達顯著' : '未達顯著') + '（F=' + n3(a.F) + '，' + pWord(a.p) + '）' +
          (a.significant
            ? (sigPairs.length ? '。事後比較顯示' + sigPairs.map(function (p) { return '「' + m.levels[p.g1] + '」顯著' + (p.meanDiff >= 0 ? '高於' : '低於') + '「' + m.levels[p.g2] + '」'; }).join('、') : '，但事後比較未發現組間達顯著差異')
            : '，顯示各組在「' + m.outcome + '」上無顯著差異') + '。');
      }
    });
    // 第五節：共變異數
    data.ancova.forEach(function (a) {
      var r = a.result;
      if (!r.ok) { nav.ancova.push('「' + a.group + ' → ' + a.outcome + '」共變異數分析無法執行：' + r.error + '。'); return; }
      var sh = r.slopeHomogeneity;
      var s = '斜率同質性檢定結果' + (sh.homogeneous ? '未達顯著' : '達顯著') + '（F=' + n3(sh.F) + '，' + pWord(sh.p) + '），' +
        (sh.homogeneous ? '表示各組迴歸斜率同質，可續做共變異數分析' : '表示各組迴歸斜率不同質，不宜用同一斜率調整') + '。';
      var ge = r.groupEffect;
      var topIdx = r.adjMeans.indexOf(Math.max.apply(null, r.adjMeans));
      s += '排除「' + a.covariate + '」的影響後，「' + a.group + '」在「' + a.outcome + '」上的差異' +
        (ge.significant ? '達顯著' : '未達顯著') + '（F=' + n3(ge.F) + '，' + pWord(ge.p) + '）' +
        (ge.significant ? '，調整後平均數以「' + a.levels[topIdx] + '」最高（M=' + n2(r.adjMeans[topIdx]) + '）' : '') + '。';
      nav.ancova.push(s);
    });
    // 第六節：關聯
    if (data.correlation) {
      var names = data.correlation.names, mx = data.correlation.matrix;
      var best = null;
      for (var i = 0; i < names.length; i++) for (var j = i + 1; j < names.length; j++) {
        var c = mx[names[i]][names[j]];
        if (c && isFinite(c.r) && (!best || Math.abs(c.r) > Math.abs(best.r))) best = { a: names[i], b: names[j], r: c.r, p: c.p };
      }
      if (best) {
        nav.correlation = '各構面間相關以「' + best.a + '」與「' + best.b + '」相關最高（r=' + n3(best.r) + '，' + pWord(best.p) + '），為' + corrStrength(best.r) + '。';
      }
    }
    // 第七節：迴歸（解釋力以調整後 R² 計，與論文寫法相同）
    data.regression.forEach(function (rg) {
      var r = rg.result;
      if (!r.ok) { nav.regression.push('「' + rg.outcome + '」迴歸分析無法執行：' + r.error + '。'); return; }
      var pct = (r.adjR2 * 100).toFixed(0);
      var s = '「' + rg.outcome + '」的整體解釋力為 ' + pct + '%（F=' + n3(r.F) + '，' + pWord(r.pF) + '），說明模型' + (r.significant ? '具有' : '不具有') + '預測力';
      if (r.significant) {
        var sigCoefs = r.coefficients.filter(function (c) { return c.name !== '(截距)' && c.p < 0.05; });
        if (sigCoefs.length) {
          s += '，其中有顯著影響之因子為' + sigCoefs.map(function (c) {
            return '「' + c.name + '」標準化迴歸係數 ' + n2(c.betaStd) + '（t=' + n3(c.t) + '，p<0.05）';
          }).join('、') + '，即' + sigCoefs.map(function (c) { return c.name; }).join('、') + '對' + rg.outcome + '有顯著' + (sigCoefs.every(function (c) { return c.betaStd > 0; }) ? '正向' : '') + '影響';
        } else s += '，但個別預測變項皆未達顯著';
        var highVif = Object.keys(r.vif).filter(function (k) { return r.vif[k] > 10; });
        s += '；' + (highVif.length ? '「' + highVif.join('」、「') + '」VIF 高於 10，顯示有共線性問題' : '各預測變項之 VIF 皆低於 10，顯示無共線性問題');
      }
      nav.regression.push(s + '。');
    });
    return nav;
  }

  var API = { buildReportData: buildReportData, corrStrength: corrStrength, getField: getField, fieldOptions: fieldOptions, dist: dist, contingency: contingency };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.StatsReport = API;
})(typeof window !== 'undefined' ? window : globalThis);

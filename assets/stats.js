// ============================================================
// 統計量化問卷 — 純計算核心 stats.js（v0.1）
// 對照 AHP 的 assets/ahp.js：不碰 DOM、不碰網路，
// 只做數學，瀏覽器與 Node 都能用同一支檔案驗證。
// 方法：卡方、平均數檢定（t）、單因子變異數分析、
//       共變異數分析、相關分析、線性迴歸
// 顯著水準預設 α=.05，p 值皆為雙尾（迴歸/ANOVA/卡方為右尾）。
// 數值取小數第 3 位顯示，有效判定以未四捨五入值計算。
// ============================================================
(function (global) {
  'use strict';

  // ---------- 基本統計 ----------
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function variance(a, sample) {
    if (a.length < 2) return 0;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return s / (a.length - (sample === false ? 0 : 1));
  }
  function sd(a, sample) { return Math.sqrt(variance(a, sample)); }
  function median(a) {
    var b = a.slice().sort(function (x, y) { return x - y; });
    var n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
  }
  function describe(a) {
    a = a.filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (!a.length) return null;
    return {
      n: a.length, mean: mean(a), sd: sd(a), variance: variance(a),
      se: sd(a) / Math.sqrt(a.length),
      min: Math.min.apply(null, a), max: Math.max.apply(null, a), median: median(a)
    };
  }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  // ---------- 分布函數 ----------
  // Lanczos gamma log
  function gammaln(z) {
    var c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - gammaln(1 - z);
    z -= 1; var x = c[0];
    for (var i = 1; i < 9; i++) x += c[i] / (z + i);
    var t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  // 正則化不完全 gamma P(a,x)
  function gammaincP(a, x) {
    if (x <= 0) return 0; if (a <= 0) return NaN;
    if (x < a + 1) {
      var ap = a, s = 1 / a, d = s;
      for (var n = 1; n < 500; n++) { ap++; d *= x / ap; s += d; if (Math.abs(d) < Math.abs(s) * 1e-12) break; }
      return s * Math.exp(-x + a * Math.log(x) - gammaln(a));
    }
    return 1 - gammaincQ(a, x);
  }
  function gammaincQ(a, x) {
    if (x <= 0) return 1;
    var b = x + 1 - a, c = 1e30, d = 1 / b, h = d;
    for (var i = 1; i < 500; i++) {
      var an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d; var del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break;
    }
    return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
  }
  // 不完全 beta（Lentz 連分式）
  function betacf(a, b, x) {
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; var h = d;
    for (var m = 1; m < 500; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d; var del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return h;
  }
  function betainc(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    var bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }
  function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function erf(x) {
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  // t 分布：雙尾 p
  function tP(t, df) {
    var x = df / (df + t * t);
    return betainc(df / 2, 0.5, x);
  }
  function tCdf(t, df) {
    var ib = betainc(df / 2, 0.5, df / (df + t * t));
    return t >= 0 ? 1 - 0.5 * ib : 0.5 * ib;
  }
  // t 臨界值（雙尾 α，數值二分法）
  function tCrit(df, alpha) {
    var lo = 0, hi = 100, mid;
    for (var i = 0; i < 100; i++) { mid = (lo + hi) / 2; if (tP(mid, df) > alpha) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  function chi2P(chi2, df) { return gammaincQ(df / 2, chi2 / 2); }
  function fP(F, df1, df2) {
    if (F <= 0) return 1;
    var x = df2 / (df2 + df1 * F);
    return betainc(df2 / 2, df1 / 2, x);
  }
  function fCrit(df1, df2, alpha) {
    var lo = 0, hi = 1000, mid;
    for (var i = 0; i < 80; i++) { mid = (lo + hi) / 2; if (fP(mid, df1, df2) > alpha) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  function sig(p) { return p < 0.001 ? 'p<.001' : 'p=' + round3(p); }

  // ---------- 矩陣（供迴歸 / ANCOVA） ----------
  function transpose(M) { return M[0].map(function (_, j) { return M.map(function (r) { return r[j]; }); }); }
  function matMul(A, B) {
    var out = [];
    for (var i = 0; i < A.length; i++) { out[i] = []; for (var j = 0; j < B[0].length; j++) { var s = 0; for (var k = 0; k < A[0].length; k++) s += A[i][k] * B[k][j]; out[i][j] = s; } }
    return out;
  }
  function matInverse(M) {
    var n = M.length, A = M.map(function (r, i) { return r.concat(Array.from({ length: n }, function (_, j) { return i === j ? 1 : 0; })); });
    for (var col = 0; col < n; col++) {
      var piv = col; for (var r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      if (Math.abs(A[piv][col]) < 1e-12) return null;
      var tmp = A[col]; A[col] = A[piv]; A[piv] = tmp;
      var d = A[col][col]; for (var j = 0; j < 2 * n; j++) A[col][j] /= d;
      for (var rr = 0; rr < n; rr++) { if (rr === col) continue; var f = A[rr][col]; for (var jj = 0; jj < 2 * n; jj++) A[rr][jj] -= f * A[col][jj]; }
    }
    return A.map(function (r) { return r.slice(n); });
  }
  // OLS：X 為 n×p（已含截距欄），y 為 n
  function ols(X, y) {
    var n = y.length, p = X[0].length;
    var Xt = transpose(X), XtX = matMul(Xt, X), inv = matInverse(XtX);
    if (!inv) return { ok: false, error: 'X′X 不可逆（共線性）' };
    var Xty = matMul(Xt, y.map(function (v) { return [v]; }));
    var beta = matMul(inv, Xty).map(function (r) { return r[0]; });
    var fitted = X.map(function (r) { var s = 0; for (var i = 0; i < p; i++) s += r[i] * beta[i]; return s; });
    var resid = y.map(function (v, i) { return v - fitted[i]; });
    var ssRes = sum(resid.map(function (e) { return e * e; }));
    var ybar = mean(y);
    var ssTot = sum(y.map(function (v) { return (v - ybar) * (v - ybar); }));
    var dfRes = n - p;
    var mse = dfRes > 0 ? ssRes / dfRes : NaN;
    var se = beta.map(function (_, j) { return Math.sqrt(Math.max(0, mse * inv[j][j])); });
    var t = beta.map(function (b, j) { return se[j] ? b / se[j] : NaN; });
    var pval = t.map(function (tv) { return tP(tv, dfRes); });
    var R2 = ssTot ? 1 - ssRes / ssTot : 0;
    var adjR2 = 1 - (1 - R2) * (n - 1) / Math.max(1, dfRes);
    var F = (p > 1 && dfRes > 0 && ssRes > 0) ? ((ssTot - ssRes) / (p - 1)) / (ssRes / dfRes) : NaN;
    var pF = isFinite(F) ? fP(F, p - 1, dfRes) : NaN;
    // Durbin-Watson
    var dwNum = 0; for (var i = 1; i < n; i++) dwNum += (resid[i] - resid[i - 1]) * (resid[i] - resid[i - 1]);
    var dw = ssRes ? dwNum / ssRes : NaN;
    return { ok: true, n: n, p: p, beta: beta, se: se, t: t, pval: pval, fitted: fitted, resid: resid, ssRes: ssRes, ssTot: ssTot, dfRes: dfRes, mse: mse, R2: R2, adjR2: adjR2, R: Math.sqrt(Math.max(0, R2)), F: F, pF: pF, dw: dw, inv: inv };
  }

  // ---------- 1. 卡方檢定 ----------
  // table：r×c 觀察次數；回傳獨立性檢定。2×2 另給 phi。
  function chiSquare(table) {
    var r = table.length, c = table[0].length;
    var rowSum = table.map(function (row) { return sum(row); });
    var colSum = table[0].map(function (_, j) { return sum(table.map(function (row) { return row[j]; })); });
    var N = sum(rowSum);
    var expected = [], chi2 = 0, smallExp = 0, cells = 0;
    for (var i = 0; i < r; i++) {
      expected[i] = [];
      for (var j = 0; j < c; j++) {
        var e = rowSum[i] * colSum[j] / N; expected[i][j] = e; cells++;
        if (e < 5) smallExp++;
        chi2 += (table[i][j] - e) * (table[i][j] - e) / e;
      }
    }
    var df = (r - 1) * (c - 1);
    var p = chi2P(chi2, df);
    var cramerV = Math.sqrt(chi2 / (N * Math.max(1, Math.min(r - 1, c - 1))));
    var phi = (r === 2 && c === 2) ? Math.sqrt(chi2 / N) : null;
    return {
      method: '卡方獨立性檢定', N: N, chi2: chi2, df: df, p: p, significant: p < 0.05,
      cramerV: cramerV, phi: phi, expected: expected,
      warnings: smallExp ? ['有 ' + smallExp + '／' + cells + ' 格期望次數 <5，建議合併類別或改用 Fisher 精確檢定'] : []
    };
  }
  // 適合度檢定：observed vs expectedProbs（加總為 1）
  function chiSquareGOF(observed, expectedProbs) {
    var N = sum(observed), chi2 = 0;
    for (var i = 0; i < observed.length; i++) { var e = N * expectedProbs[i]; chi2 += (observed[i] - e) * (observed[i] - e) / e; }
    var df = observed.length - 1;
    return { method: '卡方適合度檢定', N: N, chi2: chi2, df: df, p: chi2P(chi2, df), significant: chi2P(chi2, df) < 0.05 };
  }

  // ---------- 2. 平均數檢定 ----------
  function tOneSample(a, mu0) {
    var d = describe(a); if (!d) return null;
    var se = d.sd / Math.sqrt(d.n), t = (d.mean - mu0) / se, df = d.n - 1, p = tP(t, df);
    var tc = tCrit(df, 0.05);
    return { method: '單一樣本 t 檢定', n: d.n, mean: d.mean, sd: d.sd, mu0: mu0, t: t, df: df, p: p, significant: p < 0.05, cohenD: (d.mean - mu0) / d.sd, ci95: [d.mean - tc * se, d.mean + tc * se] };
  }
  function tIndependent(a, b, opts) {
    opts = opts || {};
    var da = describe(a), db = describe(b);
    var equalVar = opts.equalVar !== false; // 預設先看 Levene／變異數同質性，報告同時列 Welch 與 Student
    // Welch
    var seW = Math.sqrt(da.variance / da.n + db.variance / db.n);
    var tW = (da.mean - db.mean) / seW;
    var dfW = Math.pow(da.variance / da.n + db.variance / db.n, 2) /
      (Math.pow(da.variance / da.n, 2) / (da.n - 1) + Math.pow(db.variance / db.n, 2) / (db.n - 1));
    // Student（合併變異數）
    var sp2 = ((da.n - 1) * da.variance + (db.n - 1) * db.variance) / (da.n + db.n - 2);
    var seS = Math.sqrt(sp2 * (1 / da.n + 1 / db.n));
    var tS = (da.mean - db.mean) / seS, dfS = da.n + db.n - 2;
    // 變異數同質性 F 檢定（簡版，供判讀；正式報告建議 Levene）
    var Fvar = Math.max(da.variance, db.variance) / Math.min(da.variance, db.variance);
    var pooledSD = Math.sqrt(sp2);
    var tcW = tCrit(Math.round(dfW), 0.05);
    return {
      method: '獨立樣本 t 檢定', mean1: da.mean, sd1: da.sd, n1: da.n, mean2: db.mean, sd2: db.sd, n2: db.n,
      meanDiff: da.mean - db.mean,
      welch: { t: tW, df: dfW, p: tP(tW, dfW), significant: tP(tW, dfW) < 0.05, ci95: [da.mean - db.mean - tcW * seW, da.mean - db.mean + tcW * seW] },
      student: { t: tS, df: dfS, p: tP(tS, dfS), significant: tP(tS, dfS) < 0.05 },
      cohenD: (da.mean - db.mean) / pooledSD,
      hedgesG: (da.mean - db.mean) / pooledSD * (1 - 3 / (4 * (da.n + db.n) - 9)),
      varRatioF: Fvar,
      note: '變異數不同質時以 Welch（不假設變異數相等）為準；同質時兩者相近。'
    };
  }
  function tPaired(before, after) {
    if (before.length !== after.length) return null;
    var diff = before.map(function (v, i) { return after[i] - v; });
    var d = describe(diff);
    var se = d.sd / Math.sqrt(d.n), t = d.mean / se, df = d.n - 1, p = tP(t, df);
    var tc = tCrit(df, 0.05);
    return { method: '成對樣本 t 檢定', n: d.n, meanDiff: d.mean, sdDiff: d.sd, t: t, df: df, p: p, significant: p < 0.05, cohenDz: d.mean / d.sd, ci95: [d.mean - tc * se, d.mean + tc * se] };
  }
  // Levene 檢定（以組內離差絕對值做 ANOVA，Brown-Forsythe 為中位數版）
  function levene(groups, useMedian) {
    var devGroups = groups.map(function (g) {
      var c = useMedian ? median(g) : mean(g);
      return g.map(function (v) { return Math.abs(v - c); });
    });
    var a = oneWayANOVA(devGroups);
    a.method = useMedian ? 'Levene 檢定（Brown-Forsythe，中位數）' : 'Levene 檢定（平均數）';
    return a;
  }

  // ---------- 3. 單因子變異數分析 ----------
  function oneWayANOVA(groups) {
    var k = groups.length;
    var all = []; groups.forEach(function (g) { all = all.concat(g); });
    var grand = mean(all), N = all.length;
    var ssb = 0, ssw = 0;
    var groupMeans = groups.map(function (g) { return mean(g); });
    groups.forEach(function (g, i) {
      ssb += g.length * Math.pow(groupMeans[i] - grand, 2);
      g.forEach(function (v) { ssw += Math.pow(v - groupMeans[i], 2); });
    });
    var sst = ssb + ssw;
    var dfb = k - 1, dfw = N - k;
    var msb = ssb / dfb, msw = ssw / dfw;
    var F = msw ? msb / msw : NaN, p = fP(F, dfb, dfw);
    var eta2 = sst ? ssb / sst : 0;
    var omega2 = (ssb - dfb * msw) / (sst + msw);
    // 事後比較：成對 t＋Bonferroni（Tukey/Scheffe 待報告格式確認後補上）
    var pairs = [];
    for (var i = 0; i < k; i++) for (var j = i + 1; j < k; j++) {
      var t = tIndependent(groups[i], groups[j]);
      var m = k * (k - 1) / 2;
      pairs.push({ g1: i, g2: j, meanDiff: groupMeans[i] - groupMeans[j], tWelch: t.welch.t, pWelch: t.welch.p, pBonf: Math.min(1, t.welch.p * m), cohenD: t.cohenD });
    }
    return {
      method: '單因子變異數分析（One-way ANOVA）', k: k, N: N, grandMean: grand,
      groupMeans: groupMeans, groupN: groups.map(function (g) { return g.length; }),
      groupSD: groups.map(function (g) { return sd(g); }),
      ssb: ssb, ssw: ssw, sst: sst, dfb: dfb, dfw: dfw, msb: msb, msw: msw,
      F: F, p: p, significant: p < 0.05, eta2: eta2, omega2: omega2,
      postHoc: pairs,
      postHocNote: '事後比較目前為成對 t＋Bonferroni 校正；若論文格式指定 Tukey HSD 或 Scheffe，改以該法輸出。'
    };
  }

  // ---------- 4. 共變異數分析（單因子＋單一共變項） ----------
  // groups：依變項分組陣列；covs：對應共變項分組陣列；names：組名
  function ancova(groups, covs, names) {
    var k = groups.length;
    var y = [], x = [], gIdx = [];
    groups.forEach(function (g, gi) { g.forEach(function (v, i) { y.push(v); x.push(covs[gi][i]); gIdx.push(gi); }); });
    var n = y.length, xbar = mean(x);
    // 設計矩陣：截距＋k-1 個組虛擬變項＋中心化共變項
    function design(withInteract) {
      return y.map(function (_, i) {
        var row = [1];
        for (var g = 1; g < k; g++) row.push(gIdx[i] === g ? 1 : 0);
        row.push(x[i] - xbar);
        if (withInteract) for (var gg = 1; gg < k; gg++) row.push((gIdx[i] === gg ? 1 : 0) * (x[i] - xbar));
        return row;
      });
    }
    var full = ols(design(true), y);   // 含組×共變項交互作用
    var main = ols(design(false), y);  // ANCOVA 主模型
    if (!full.ok || !main.ok) return { ok: false, error: full.error || main.error };
    // 迴歸斜率同質性檢定：比較 full vs main 的殘差平方和
    var dfInt = k - 1, dfResFull = full.dfRes;
    var Fint = ((main.ssRes - full.ssRes) / dfInt) / (full.ssRes / dfResFull);
    var pInt = fP(Fint, dfInt, dfResFull);
    // 主模型：組別效果＝拿掉組虛擬變項後的模型比較
    var XnoGroup = y.map(function (_, i) { return [1, x[i] - xbar]; });
    var noGroup = ols(XnoGroup, y);
    var dfGroup = k - 1, dfResMain = main.dfRes;
    var Fgroup = ((noGroup.ssRes - main.ssRes) / dfGroup) / (main.ssRes / dfResMain);
    var pGroup = fP(Fgroup, dfGroup, dfResMain);
    // 共變項效果＝拿掉共變項後的模型比較
    var XnoCov = y.map(function (_, i) { var row = [1]; for (var g = 1; g < k; g++) row.push(gIdx[i] === g ? 1 : 0); return row; });
    var noCov = ols(XnoCov, y);
    var Fcov = ((noCov.ssRes - main.ssRes) / 1) / (main.ssRes / dfResMain);
    var pCov = fP(Fcov, 1, dfResMain);
    // 調整後平均數：組平均 − b×(組共變項平均 − 總平均)，b 為主模型共變項係數
    var bCov = main.beta[main.beta.length - 1];
    var adjMeans = groups.map(function (g, gi) {
      return mean(g) - bCov * (mean(covs[gi]) - xbar);
    });
    var partialEtaGroup = (noGroup.ssRes - main.ssRes) / noGroup.ssRes;
    var partialEtaCov = (noCov.ssRes - main.ssRes) / noCov.ssRes;
    return {
      ok: true, method: '單因子共變異數分析（One-way ANCOVA）', k: k, N: n,
      names: names || groups.map(function (_, i) { return '組' + (i + 1); }),
      groupMeans: groups.map(function (g) { return mean(g); }),
      adjMeans: adjMeans, covariateMean: xbar, bCovariate: bCov,
      slopeHomogeneity: { F: Fint, df1: dfInt, df2: dfResFull, p: pInt, homogeneous: pInt >= 0.05, note: 'p≥.05 表示各組迴歸斜率同質，可續做 ANCOVA；p<.05 表示斜率不同質，不宜用同一斜率調整，建議改做 Johnson-Neyman 或分組迴歸。' },
      groupEffect: { F: Fgroup, df1: dfGroup, df2: dfResMain, p: pGroup, significant: pGroup < 0.05, partialEta2: partialEtaGroup },
      covariateEffect: { F: Fcov, df1: 1, df2: dfResMain, p: pCov, significant: pCov < 0.05, partialEta2: partialEtaCov },
      R2: main.R2, adjR2: main.adjR2
    };
  }

  // ---------- 5. 關聯分析 ----------
  function ranks(a) {
    var sorted = a.map(function (v, i) { return { v: v, i: i }; }).sort(function (p, q) { return p.v - q.v; });
    var r = new Array(a.length), i = 0;
    while (i < sorted.length) {
      var j = i; while (j + 1 < sorted.length && sorted[j + 1].v === sorted[i].v) j++;
      var avg = (i + j) / 2 + 1; for (var k = i; k <= j; k++) r[sorted[k].i] = avg; i = j + 1;
    }
    return r;
  }
  function pearson(x, y) {
    var n = x.length; if (n !== y.length || n < 3) return null;
    var mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); syy += (y[i] - my) * (y[i] - my); }
    var r = sxy / Math.sqrt(sxx * syy);
    var t = r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
    var p = tP(t, n - 2);
    // Fisher z 95% CI
    var z = 0.5 * Math.log((1 + r) / (1 - r)), se = 1 / Math.sqrt(n - 3);
    var lo = Math.tanh(z - 1.96 * se), hi = Math.tanh(z + 1.96 * se);
    return { method: 'Pearson 積差相關', n: n, r: r, r2: r * r, t: t, df: n - 2, p: p, significant: p < 0.05, ci95: [lo, hi] };
  }
  function spearman(x, y) {
    var r = pearson(ranks(x), ranks(y));
    if (r) r.method = 'Spearman 等級相關';
    return r;
  }
  function correlationMatrix(vars) {
    // vars：{名稱: 陣列}
    var names = Object.keys(vars), out = {};
    names.forEach(function (a) { out[a] = {}; names.forEach(function (b) { out[a][b] = a === b ? 1 : pearson(vars[a], vars[b]).r; }); });
    return { names: names, matrix: out };
  }

  // ---------- 6. 線性迴歸 ----------
  // predictors：{名稱: 陣列}，y：依變項陣列
  function linearRegression(predictors, y, names) {
    names = names || Object.keys(predictors);
    var n = y.length;
    var X = y.map(function (_, i) {
      var row = [1]; names.forEach(function (nm) { row.push(predictors[nm][i]); }); return row;
    });
    var res = ols(X, y);
    if (!res.ok) return res;
    var k = names.length;
    var ybar = mean(y), sdy = sd(y);
    var coef = [{ name: '(截距)', b: res.beta[0], se: res.se[0], betaStd: 0, t: res.t[0], p: res.pval[0] }];
    for (var j = 0; j < k; j++) {
      var sdx = sd(predictors[names[j]]);
      coef.push({ name: names[j], b: res.beta[j + 1], se: res.se[j + 1], betaStd: res.beta[j + 1] * sdx / sdy, t: res.t[j + 1], p: res.pval[j + 1], significant: res.pval[j + 1] < 0.05 });
    }
    // VIF：每一個預測變項對其餘預測變項迴歸的 R²
    var vif = {};
    names.forEach(function (nm, idx) {
      var others = names.filter(function (o) { return o !== nm; });
      if (!others.length) { vif[nm] = 1; return; }
      var Xo = predictors[nm].map(function (_, i) { var row = [1]; others.forEach(function (o) { row.push(predictors[o][i]); }); return row; });
      var rr = ols(Xo, predictors[nm]);
      vif[nm] = rr.ok ? 1 / Math.max(1e-9, 1 - rr.R2) : NaN;
    });
    // ANOVA 表（迴歸／殘差／總和）
    var ssReg = res.ssTot - res.ssRes;
    return {
      ok: true, method: k === 1 ? '簡單線性迴歸' : '多元線性迴歸', n: n, k: k,
      R: res.R, R2: res.R2, adjR2: res.adjR2, F: res.F, pF: res.pF, significant: res.pF < 0.05,
      dfReg: k, dfRes: res.dfRes, dfTot: n - 1,
      ssReg: ssReg, ssRes: res.ssRes, ssTot: res.ssTot,
      msReg: ssReg / k, msRes: res.ssRes / res.dfRes,
      coefficients: coef, vif: vif, durbinWatson: res.dw,
      warnings: Object.keys(vif).filter(function (nm) { return vif[nm] > 5; }).map(function (nm) { return nm + ' 的 VIF=' + round3(vif[nm]) + '（>5，共線性偏高）'; })
    };
  }

  // ---------- 量表信度：Cronbach's α ----------
  function cronbachAlpha(itemMatrix) {
    // itemMatrix：每列一受訪者，每欄一題
    var n = itemMatrix.length, k = itemMatrix[0].length;
    var itemVars = [];
    for (var j = 0; j < k; j++) itemVars.push(variance(itemMatrix.map(function (r) { return r[j]; })));
    var total = itemMatrix.map(function (r) { return sum(r); });
    var totalVar = variance(total);
    if (!totalVar) return 0;
    return (k / (k - 1)) * (1 - sum(itemVars) / totalVar);
  }
  // 構面分數：每位受訪者各題平均
  function scaleScore(itemMatrix) { return itemMatrix.map(function (r) { return mean(r); }); }

  var API = {
    mean: mean, sd: sd, variance: variance, describe: describe, round3: round3, sig: sig,
    tP: tP, chi2P: chi2P, fP: fP, tCrit: tCrit, fCrit: fCrit,
    chiSquare: chiSquare, chiSquareGOF: chiSquareGOF,
    tOneSample: tOneSample, tIndependent: tIndependent, tPaired: tPaired, levene: levene,
    oneWayANOVA: oneWayANOVA, ancova: ancova,
    pearson: pearson, spearman: spearman, correlationMatrix: correlationMatrix,
    linearRegression: linearRegression, ols: ols,
    cronbachAlpha: cronbachAlpha, scaleScore: scaleScore
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.STATS = API;
})(typeof window !== 'undefined' ? window : globalThis);

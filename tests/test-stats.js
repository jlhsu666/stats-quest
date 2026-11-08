// 已知答案驗證：數字取自教科書 / SPSS 常見例題，誤差容許 ±0.02（p 值 ±0.01）
const S = require('../assets/stats.js');
let fail = 0;
function check(name, got, want, tol) {
  tol = tol || 0.02;
  const ok = Math.abs(got - want) <= tol;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + ' got=' + (typeof got === 'number' ? got.toFixed(4) : got) + ' want~' + want);
  if (!ok) fail++;
}
// 1. 卡方獨立性：2x2 表 [[20,10],[10,20]] chi2=6.6667 df=1 p=.0098, phi=.333
{
  const r = S.chiSquare([[20, 10], [10, 20]]);
  check('卡方 chi2', r.chi2, 6.6667); check('卡方 p', r.p, 0.0098, 0.005); check('卡方 phi', r.phi, 0.3333);
}
// 2. 獨立 t：A=[2,3,4,5,6] B=[5,6,7,8,9] 均差 -3, Welch t=-3.0 df=8 p=.017（SE=1.0，手算驗證）
{
  const r = S.tIndependent([2, 3, 4, 5, 6], [5, 6, 7, 8, 9]);
  check('獨立t Welch t', r.welch.t, -3.0); check('獨立t p', r.welch.p, 0.0171, 0.005); check('Cohen d', r.cohenD, -1.897, 0.02);
}
// 3. 成對 t：差值 [2,2,2,1,3] 均值 2.0, SD 0.707, t=6.325, p=.003
{
  const r = S.tPaired([10, 12, 11, 13, 12], [12, 14, 13, 14, 15]);
  check('成對t t', r.t, 6.3246, 0.05); check('成對t p', r.p, 0.0032, 0.005);
}
// 4. 單因子 ANOVA：三組 [6,8,7,9,8] [10,12,11,13,12] [14,15,13,16,15] 手算 SSB=123.2 SSW=15.6 F=47.44
{
  const r = S.oneWayANOVA([[6, 8, 7, 9, 8], [10, 12, 11, 13, 12], [14, 15, 13, 16, 15]]);
  console.log('ANOVA F=' + r.F.toFixed(3) + ' p=' + r.p.toFixed(5) + ' eta2=' + r.eta2.toFixed(3));
  check('ANOVA F', r.F, 47.436, 0.5); check('ANOVA eta2', r.eta2, 0.888, 0.02);
  if (!(r.p < 0.001)) { console.log('FAIL ANOVA p<.001'); fail++; } else console.log('PASS ANOVA p<.001');
}
// 5. Pearson：x=[1,2,3,4,5] y=[2,4,5,4,5] r~0.7746
{
  const r = S.pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
  check('Pearson r', r.r, 0.7746); check('Pearson p', r.p, 0.124, 0.02);
}
// 6. 簡單迴歸：x=[1,2,3,4,5] y=[2,4,5,4,5] 斜率 0.6, 截距 2.2, R2=0.6
{
  const r = S.linearRegression({ x: [1, 2, 3, 4, 5] }, [2, 4, 5, 4, 5]);
  check('迴歸斜率', r.coefficients[1].b, 0.6); check('迴歸截距', r.coefficients[0].b, 2.2); check('迴歸 R2', r.R2, 0.6);
}
// 7. ANCOVA 煙霧測試：三組、共變項有作用且斜率同質，組別 F 應為正數、p 在 [0,1]
{
  const g1 = [10, 11, 12, 11, 13], g2 = [14, 15, 13, 16, 15], g3 = [18, 19, 17, 20, 19];
  const c1 = [5, 6, 5, 6, 7], c2 = [6, 7, 6, 7, 8], c3 = [7, 8, 7, 8, 9];
  const r = S.ancova([g1, g2, g3], [c1, c2, c3], ['A', 'B', 'C']);
  console.log('ANCOVA group F=' + r.groupEffect.F.toFixed(3) + ' p=' + r.groupEffect.p.toFixed(4) +
    ' cov F=' + r.covariateEffect.F.toFixed(3) + ' slope-homog p=' + r.slopeHomogeneity.p.toFixed(4) +
    ' adjMeans=' + r.adjMeans.map(v => v.toFixed(2)).join(','));
  if (!r.ok || !(r.groupEffect.F > 0) || !(r.groupEffect.p >= 0 && r.groupEffect.p <= 1)) { console.log('FAIL ANCOVA'); fail++; } else console.log('PASS ANCOVA smoke');
}
// 8. Cronbach alpha：高度一致的 3 題應 >0.8
{
  const m = [[5, 5, 4], [4, 4, 4], [3, 3, 2], [2, 2, 2], [1, 1, 1], [5, 4, 5]];
  const a = S.cronbachAlpha(m);
  console.log('Cronbach alpha=' + a.toFixed(3));
  if (a < 0.8) { console.log('FAIL alpha'); fail++; } else console.log('PASS alpha>0.8');
}
console.log(fail === 0 ? 'ALL PASS' : 'FAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);

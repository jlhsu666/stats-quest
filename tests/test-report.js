// report.js 驗證：用合成紀錄跑六種方法，確認每種都有數、方向正確
// 需要全域 STATS（report.js 在 Node 下會 require ./stats.js）
global.STATS = require('../assets/stats.js');
const R = require('../assets/report.js');
const fs = require('fs');
const StudyTxt = require('../assets/studyTxt.js');
const tpl = fs.readFileSync(__dirname + '/../studies/template.txt', 'utf8');
const config = StudyTxt.parse(tpl).config;

let fail = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
  if (!cond) fail++;
}
// 合成 30 筆：高年級態度與成效都較高，且成效與態度正相關
function mulberry32(seed) {
  return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const rnd = mulberry32(7);
function gauss() { const u = Math.max(1e-9, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function cr(x) { return Math.max(1, Math.min(5, Math.round(x))); }
const groups = ['低年級', '中年級', '高年級'];
const records = [];
for (let i = 0; i < 30; i++) {
  const gi = i % 3;
  const att = [3.0, 3.6, 4.2][gi] + gauss() * 0.45;
  const eff = 0.8 + 0.65 * att + gauss() * 0.35;
  const responses = {};
  [att, eff].forEach((lat, di) => { responses[di] = {}; for (let j = 0; j < 3; j++) responses[di][j] = cr(lat + gauss() * 0.4); });
  const scores = {};
  config.dimensions.forEach((d, di) => { scores[d.name] = [0, 1, 2].reduce((s, j) => s + responses[di][j], 0) / 3; });
  records.push({
    id: 'T' + String(i + 1).padStart(2, '0'), submitted_at: new Date().toISOString(),
    group: groups[gi],
    background: { bg1: i % 2 ? '男' : '女', bg2: ['30 歲以下', '31~40 歲', '41 歲以上'][i % 3], bg3: ['10 年以下', '11~20 年', '21 年以上'][i % 3] },
    responses, scores
  });
}
const data = R.buildReportData(records, config, {});
check('樣本 N=30', data.n === 30);
check('描述統計 2 構面', data.descriptive.length === 2 && data.descriptive.every(d => d.mean > 1 && d.mean < 5), JSON.stringify(data.descriptive.map(d => d.mean)));
check('信度 α 在 0~1', data.descriptive.every(d => d.cronbachAlpha > 0.5 && d.cronbachAlpha <= 1), JSON.stringify(data.descriptive.map(d => d.cronbachAlpha)));
check('卡方有結果', data.chiSquare.length >= 1 && isFinite(data.chiSquare[0].result.chi2), 'chi2=' + (data.chiSquare[0] && data.chiSquare[0].result.chi2));
check('平均數檢定有 t 與 ANOVA', data.meanTests.some(m => m.kind === 't') && data.meanTests.some(m => m.kind === 'anova'),
  data.meanTests.map(m => m.kind + ':' + m.group + '->' + m.outcome).join(' | '));
// 服務年資三組與潛在分數同向（i%3 設計）：21 年以上組成效應高於 10 年以下組
const anovaEff = data.meanTests.find(m => m.kind === 'anova' && m.group === '服務年資' && m.outcome === '備課成效感受');
check('ANOVA 年資高組成效最高', !!anovaEff && anovaEff.result.groupMeans[2] > anovaEff.result.groupMeans[0],
  anovaEff ? anovaEff.result.groupMeans.map(v => v.toFixed(2)).join(',') : 'missing');
check('ANOVA F 顯著', !!anovaEff && anovaEff.result.p < 0.05, anovaEff ? 'p=' + anovaEff.result.p.toFixed(4) : '');
// 性別→態度 為 t 檢定
const tTest = data.meanTests.find(m => m.kind === 't' && m.group === '性別');
check('性別 t 檢定有 Welch t', !!tTest && isFinite(tTest.result.welch.t));
check('相關矩陣 r>0.4', data.correlation && data.correlation.matrix['AI 工具態度']['備課成效感受'].r > 0.4,
  data.correlation ? 'r=' + data.correlation.matrix['AI 工具態度']['備課成效感受'].r.toFixed(3) : 'missing');
const reg = data.regression[0];
check('迴歸 R2>0.2', !!reg && reg.result.R2 > 0.2, reg ? 'R2=' + reg.result.R2.toFixed(3) + ' 斜率=' + reg.result.coefficients[1].b.toFixed(3) : 'missing');
check('迴歸斜率為正', !!reg && reg.result.coefficients[1].b > 0);
check('ANCOVA 未指定時為空', data.ancova.length === 0);
// 補一個 ANCOVA 指定：用 template 加一行
const cfg2 = JSON.parse(JSON.stringify(config));
cfg2.analysis.ancova = [{ group: '任教年段', outcome: '備課成效感受', covariate: 'AI 工具態度' }];
const data2 = R.buildReportData(records, cfg2, {});
check('ANCOVA 有結果且斜率同質', data2.ancova.length === 1 && data2.ancova[0].result.ok,
  data2.ancova[0] ? 'slope p=' + data2.ancova[0].result.slopeHomogeneity.p.toFixed(3) + ' group F=' + data2.ancova[0].result.groupEffect.F.toFixed(2) : 'missing');
// ---- 第四章格式（論文慣例）：題項現況、排序、敘述文字 ----
check('題項現況每構面 3 題有平均數與排序', data.descriptive.every(d => d.items && d.items.length === 3 && d.items.every(it => isFinite(it.mean) && it.rank >= 1 && it.rank <= 3)),
  JSON.stringify(data.descriptive.map(d => d.items.map(it => it.mean.toFixed(2) + '#' + it.rank))));
check('構面排序 rank 已指派', data.descriptive.every(d => d.rank >= 1 && d.rank <= 2) && data.descriptive.find(d => d.rank === 1).mean >= data.descriptive.find(d => d.rank === 2).mean);
check('相關強度分級', R.corrStrength(0.786) === '高度正相關' && R.corrStrength(0.636) === '中度正相關' && R.corrStrength(-0.478) === '中度負相關' && R.corrStrength(0.1) === '微弱正相關');
const nv = data.narratives;
check('敘述：引言含 N 與節次', nv.intro.includes('有效問卷共 30 份') && nv.intro.includes('第一節 樣本基本資料分析') && nv.intro.includes('第七節 線性迴歸分析'), nv.intro);
check('敘述：樣本含人數最多', nv.sample.includes('人數最多'));
check('敘述：描述統計含最高構面', nv.descriptive.includes('最高') && nv.descriptive.includes("Cronbach's α"));
check('敘述：題項最高分', nv.items.length === 2 && nv.items.every(s => s.includes('平均數最高的題項為')));
check('敘述：卡方含 χ²', nv.chiSquare.length >= 1 && nv.chiSquare.every(s => s.includes('χ²=')), nv.chiSquare[0]);
check('敘述：平均數檢定含 t 或 F', nv.meanTests.length >= 1 && nv.meanTests.every(s => s.includes('t=') || s.includes('F=')), nv.meanTests[0]);
check('敘述：事後比較方向與平均差一致（低組寫低於，不寫高於）', nv.meanTests.some(s => s.includes('「10 年以下」顯著低於「21 年以上」')) && !nv.meanTests.some(s => s.includes('「10 年以下」顯著高於')), nv.meanTests.join('｜'));
check('敘述：關聯含相關最高與強度', nv.correlation.includes('相關最高') && (nv.correlation.includes('中度') || nv.correlation.includes('高度')), nv.correlation);
check('敘述：迴歸含解釋力百分比', nv.regression.length === 1 && nv.regression[0].includes('整體解釋力為') && nv.regression[0].includes('%'), nv.regression[0]);
const nv2 = data2.narratives;
check('敘述：ANCOVA 含斜率同質性', nv2.ancova.length === 1 && nv2.ancova[0].includes('斜率同質性檢定'), nv2.ancova[0]);
console.log(fail === 0 ? 'ALL PASS' : 'FAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);

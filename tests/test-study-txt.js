// studyTxt 解析測試：範本往返＋錯誤案例行號
const fs = require('fs');
const path = require('path');
const S = require('../assets/studyTxt.js');
let fail = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
  if (!cond) fail++;
}
const tpl = fs.readFileSync(path.join(__dirname, '../studies/template.txt'), 'utf8');
const r = S.parse(tpl);
check('範本解析 ok', r.ok, JSON.stringify(r.errors));
check('範本標題', r.config.studyTitle.includes('生成式 AI'));
check('範本 2 構面', r.config.dimensions.length === 2);
check('範本每構面 3 題', r.config.dimensions.every(d => d.items.length === 3));
check('範本量表 5 點', r.config.scalePoints === 5 && r.config.scaleLabels.length === 5);
check('範本背景 3 欄', r.config.backgroundFields.length === 3);
check('範本分析：卡方 1 筆', r.config.analysis.chiSquare.length === 1);
check('範本分析：平均數 2 筆', r.config.analysis.meanTests.length === 2);
check('範本分析：迴歸 1 筆', r.config.analysis.regression.length === 1);
check('範本分析：關聯 1 筆', r.config.analysis.correlation.length === 1);
check('範本 ANCOVA 註解行不計入', r.config.analysis.ancova.length === 0);
// 半形標點也認得
const r2 = S.parse(tpl.replace(/：/g, ':').replace(/，/g, ','));
check('半形標點解析 ok', r2.ok, JSON.stringify(r2.errors));
// 錯誤案例：卡方用了構面名
const bad1 = tpl + '\n[分析設定]\n卡方：AI 工具態度 × 性別\n';
const rb1 = S.parse(bad1);
check('卡方用構面名應報錯', !rb1.ok && rb1.errors.some(e => e.message.includes('卡方')));
// 錯誤案例：量表標籤數量不符
const bad2 = tpl.replace('量表標籤：非常不同意, 不同意, 普通, 同意, 非常同意', '量表標籤：不同意, 同意');
const rb2 = S.parse(bad2);
check('量表標籤數量不符應報錯', !rb2.ok);
// 錯誤案例：迴歸依變項不是構面（範例註解行也有同一句，須全部取代）
const bad3 = tpl.split('迴歸：備課成效感受 ← AI 工具態度').join('迴歸：不存在的構面 ← AI 工具態度');
const rb3 = S.parse(bad3);
check('迴歸依變項不存在應報錯', !rb3.ok);
// 錯誤案例：構面只有 1 個
const bad4 = '研究標題：X\n後台密碼：123456\n[構面] 只有一個\n題目一\n題目二\n';
const rb4 = S.parse(bad4);
check('構面不足 2 個應報錯', !rb4.ok);
console.log(fail === 0 ? 'ALL PASS' : 'FAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);

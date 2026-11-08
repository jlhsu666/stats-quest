// ============================================================
// 統計量化問卷 — 研究者部署設定（對照 AHP 的 config.js）
// 改這支檔案，就改了整站的研究架構。
// 部署前請務必改：appsScriptUrl（沒有就留空，先用本機模式測試）、
// adminCode（不要用預設值）。後台密碼只是簡易門檻，不是真正的
// 身分驗證：不要在問卷收集可識別個人的敏感資料，請用匿名編號。
// 多研究：studies 註冊表，研究代號 → 題目檔，連結用 ?s=代號。
// 題目檔格式見 studies/template.txt；沒帶 ?s= 開預設研究。
// ============================================================
window.STATS_CONFIG = {
  studyTitle: '範例研究：教師使用生成式 AI 備課之態度與成效',
  studySubtitle: '統計量化問卷（Likert 五點量表）',
  appsScriptUrl: '',
  adminCode: '123456',
  groupLabel: '任教年段',
  groupOptions: ['低年級', '中年級', '高年級'],
  scalePoints: 5,
  scaleLabels: ['非常不同意', '不同意', '普通', '同意', '非常同意'],
  studies: {
    'example': { url: 'studies/template.txt', title: '範例：AI 備課態度與成效' }
  },
  backgroundFields: [
    { key: 'sex', label: '性別', options: ['男', '女'] },
    { key: 'age', label: '年齡', options: ['30 歲以下', '31~40 歲', '41 歲以上'] },
    { key: 'years', label: '服務年資', options: ['10 年以下', '11~20 年', '21 年以上'] }
  ],
  // 構面 = 量表分量表：每題 1~scalePoints 分，構面分數 = 各題平均。
  // desc 為構面定義，itemDescs 與 items 一一對應（可留空字串）。
  dimensions: [
    { name: 'AI 工具態度', desc: '教師對生成式 AI 工具的接受程度與信心。', items: ['我願意嘗試用生成式 AI 協助備課。', '我認為生成式 AI 能提升備課效率。', '我對使用生成式 AI 備課有信心。'], itemDescs: ['', '', ''] },
    { name: '備課成效感受', desc: '教師感受到的備課品質與時間節省。', items: ['使用生成式 AI 後，我的備課時間明顯減少。', '使用生成式 AI 後，我的教案內容更豐富。', '使用生成式 AI 後，我更能針對學生程度調整教材。'], itemDescs: ['', '', ''] }
  ],
  // 分析設定：與 template.txt 的 [分析設定] 同義，後台「研究設定」可改。
  // 不寫就用預設自動分析；迴歸與共變異數一定要指定依變項／共變項。
  analysis: {
    chiSquare: [['性別', '年齡']],
    meanTests: [
      { group: '性別', outcomes: ['AI 工具態度', '備課成效感受'] },
      { group: '服務年資', outcomes: ['AI 工具態度', '備課成效感受'] }
    ],
    ancova: [
      // { group: '任教年段', outcome: '備課成效感受', covariate: 'AI 工具態度' }
    ],
    regression: [
      { outcome: '備課成效感受', predictors: ['AI 工具態度'] }
    ],
    correlation: [['AI 工具態度', '備課成效感受']]
  }
};

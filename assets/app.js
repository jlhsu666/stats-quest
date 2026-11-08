// 統計量化問卷 — 前端邏輯（對照 AHP 的 assets/app.js）
// 填答（Likert 5 點）→ 構面分數預覽 → 送出（Sheets／本機）
// 後台：填答紀錄、分析報告（六種方法）、研究設定、匯入匯出、示範資料
// 計算全部走 assets/stats.js 與 assets/report.js；本檔只做畫面與存取。
(function () {
  'use strict';

  // ---------- 小工具 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmt3(x) { return (x === null || x === undefined || !isFinite(x)) ? '—' : (Math.round(x * 1000) / 1000).toFixed(3); }
  function fmtP(p) { if (p === null || p === undefined || !isFinite(p)) return '—'; if (p < 0.001) return '<.001'; return fmt3(p); }
  function sigMark(p) { if (p === null || p === undefined || !isFinite(p)) return ''; if (p < 0.001) return '***'; if (p < 0.01) return '**'; if (p < 0.05) return '*'; return ''; }
  function starNote() { return '<p class="small muted">* p&lt;.05，** p&lt;.01，*** p&lt;.001。數值顯示小數第 3 位，判定以未四捨五入值計算。</p>'; }
  function download(name, content, type) {
    var blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function downloadBinary(name, bytes) {
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function csvCell(v) { var s = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---------- 狀態 ----------
  var DEFAULT_CONFIG = (typeof window !== 'undefined' && window.STATS_CONFIG) ? window.STATS_CONFIG : null;
  var config = null;         // 目前研究設定
  var studyId = 'default';   // default 或 ?s= 代號
  var studyTitleForLink = '';
  var records = [];          // 目前資料來源的紀錄
  var currentSource = 'local';
  var adminUnlocked = false;
  var lastReportData = null;
  var lastReportHTML = '';

  function storageKey(base) { return studyId === 'default' ? base : base + '__' + studyId; }
  function localRecords() {
    try { return JSON.parse(localStorage.getItem(storageKey('stats_records')) || '[]'); } catch (e) { return []; }
  }
  function saveLocalRecords(list) { localStorage.setItem(storageKey('stats_records'), JSON.stringify(list)); }
  function loadOverride() {
    try { return JSON.parse(localStorage.getItem(storageKey('stats_config_override')) || 'null'); } catch (e) { return null; }
  }

  // ---------- 啟動：決定研究 ----------
  function queryParam(name) {
    var m = window.location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function showBootError(title, detail, listHtml) {
    $('view-fill').innerHTML = '<div class="card"><h2>' + esc(title) + '</h2><p>' + esc(detail) + '</p>' + (listHtml || '') + '</div>';
    $('view-admin').hidden = true;
  }
  function configFromTxt(txtConfig) {
    // txt 解析結果的 config 已是完整形狀；補上 studies 註冊表（沿用預設的）
    var c = txtConfig;
    if (DEFAULT_CONFIG) c.studies = DEFAULT_CONFIG.studies;
    return c;
  }
  function boot() {
    var s = queryParam('s'), cfgUrl = queryParam('config');
    if (s) {
      studyId = s;
      var entry = DEFAULT_CONFIG && DEFAULT_CONFIG.studies ? DEFAULT_CONFIG.studies[s] : null;
      if (!entry) {
        var list = DEFAULT_CONFIG && DEFAULT_CONFIG.studies
          ? Object.keys(DEFAULT_CONFIG.studies).map(function (k) { return '<li><a href="?s=' + esc(k) + '">' + esc(k) + '：' + esc(DEFAULT_CONFIG.studies[k].title) + '</a></li>'; }).join('')
          : '<li>（無已登記研究）</li>';
        showBootError('找不到研究代號「' + s + '」', '請確認連結的 ?s= 代號是否正確，或改開預設研究。', '<ul>' + list + '</ul><p><a href="./">開預設研究</a></p>');
        return;
      }
      studyTitleForLink = entry.title;
      fetch(entry.url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (txt) { finishBootFromTxt(txt, entry.url); })
        .catch(function (e) { showBootError('題目檔讀取失敗', '研究「' + s + '」的題目檔 ' + entry.url + ' 讀不到：' + e.message + '。請確認檔案已推上 GitHub。'); });
      return;
    }
    if (cfgUrl) {
      studyId = 'custom';
      fetch(cfgUrl).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (txt) { finishBootFromTxt(txt, cfgUrl); })
        .catch(function (e) { showBootError('題目檔讀取失敗', '網址 ' + cfgUrl + ' 讀不到：' + e.message + '。題目檔須是允許跨網域讀取（CORS）的網址，例如 GitHub raw；Google 雲端硬碟分享連結讀不到。'); });
      return;
    }
    finishBootDefault();
  }
  function finishBootFromTxt(txt, url) {
    var parsed = StudyTxt.parse(txt);
    if (!parsed.ok) {
      var errs = parsed.errors.map(function (e) { return '<li>第 ' + e.line + ' 行：' + esc(e.message) + '</li>'; }).join('');
      showBootError('題目檔格式有誤（' + url + '）', '請依 studies/template.txt 的格式修正後再推上 GitHub。', '<ul>' + errs + '</ul>');
      return;
    }
    config = configFromTxt(parsed.config);
    var ov = loadOverride();
    if (ov) config = Object.assign({}, config, ov);
    afterConfigLoaded(parsed.warnings);
  }
  function finishBootDefault() {
    if (!DEFAULT_CONFIG) { showBootError('缺少設定', '找不到 config.js 的預設研究設定。'); return; }
    config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    var ov = loadOverride();
    if (ov) config = Object.assign({}, config, ov);
    afterConfigLoaded([]);
  }
  function afterConfigLoaded(warnings) {
    document.title = config.studyTitle + ' — 統計量化問卷';
    $('siteTitle').textContent = config.studyTitle;
    $('siteSubtitle').textContent = config.studySubtitle || '統計量化問卷（Likert 五點量表）';
    renderFill();
    bindGlobal();
    if (warnings && warnings.length) {
      var w = $('fillIntro');
      warnings.forEach(function (x) {
        var d = document.createElement('p');
        d.className = 'small warn'; d.textContent = '提醒：' + x.message; w.appendChild(d);
      });
    }
  }

  // ---------- 填答頁 ----------
  function totalItems() { return config.dimensions.reduce(function (s, d) { return s + d.items.length; }, 0); }
  function readResponses() {
    var res = {};
    config.dimensions.forEach(function (dim, di) {
      res[di] = {};
      dim.items.forEach(function (_, ii) {
        var checked = document.querySelector('input[name="q-' + di + '-' + ii + '"]:checked');
        if (checked) res[di][ii] = parseInt(checked.value, 10);
      });
    });
    return res;
  }
  function answeredCount(res) {
    var n = 0;
    Object.keys(res).forEach(function (di) { Object.keys(res[di]).forEach(function () { n++; }); });
    return n;
  }
  function dimensionScores(res) {
    var scores = {};
    config.dimensions.forEach(function (dim, di) {
      var vals = dim.items.map(function (_, ii) { return res[di] ? res[di][ii] : undefined; }).filter(function (v) { return typeof v === 'number'; });
      scores[dim.name] = vals.length === dim.items.length ? STATS.mean(vals) : null;
    });
    return scores;
  }
  function renderFill() {
    // 說明
    var intro = $('fillIntro');
    intro.innerHTML = '<h2>' + esc(config.studyTitle) + '</h2><p class="muted">' + esc(config.studySubtitle || '') + '</p>';
    if (config.intro) {
      var div = document.createElement('div');
      div.className = 'intro';
      config.intro.split(/\n\s*\n/).forEach(function (para) {
        var p = document.createElement('p'); p.textContent = para; div.appendChild(p);
      });
      intro.appendChild(div);
    }
    if (!config.appsScriptUrl) {
      var warn = document.createElement('p');
      warn.className = 'small warn'; warn.textContent = '目前為本機模式：填答只存在這台瀏覽器的本機紀錄，不寫入試算表。研究者接好 Apps Script 網址後再發連結。';
      intro.appendChild(warn);
    }
    // 基本資料
    $('fGroupLabel').textContent = config.groupLabel || '分組';
    var grp = $('fGroup');
    grp.innerHTML = '<option value="">請選擇</option>' + (config.groupOptions || []).map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('');
    $('fGroupWrap').style.display = config.groupLabel ? '' : 'none';
    var bg = $('fBackground'); bg.innerHTML = '';
    config.backgroundFields.forEach(function (f) {
      var d = document.createElement('div');
      d.innerHTML = '<label for="bg-' + esc(f.key) + '">' + esc(f.label) + '</label><select id="bg-' + esc(f.key) + '"><option value="">請選擇</option>' +
        f.options.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</select>';
      bg.appendChild(d);
    });
    // 量表題
    $('scaleHint').textContent = config.scalePoints + ' 點量表（1=' + config.scaleLabels[0] + '，' + config.scalePoints + '=' + config.scaleLabels[config.scalePoints - 1] + '）';
    var dims = $('fillDims'); dims.innerHTML = '';
    config.dimensions.forEach(function (dim, di) {
      var h = document.createElement('h3');
      h.textContent = dim.name;
      dims.appendChild(h);
      if (dim.desc) { var pd = document.createElement('p'); pd.className = 'dim-desc'; pd.textContent = dim.desc; dims.appendChild(pd); }
      dim.items.forEach(function (item, ii) {
        var box = document.createElement('div');
        box.className = 'qitem'; box.id = 'qbox-' + di + '-' + ii;
        var qt = document.createElement('div');
        qt.className = 'qtext'; qt.textContent = (ii + 1) + '. ' + item;
        box.appendChild(qt);
        var lik = document.createElement('div');
        lik.className = 'likert';
        for (var v = 1; v <= config.scalePoints; v++) {
          (function (val) {
            var lab = document.createElement('label');
            lab.innerHTML = '<input type="radio" name="q-' + di + '-' + ii + '" value="' + val + '"><span class="lv">' + val + '</span><span class="lb">' + esc(config.scaleLabels[val - 1] || '') + '</span>';
            lab.addEventListener('click', function () {
              setTimeout(function () {
                lik.querySelectorAll('label').forEach(function (l) { l.classList.remove('on'); });
                lab.classList.add('on');
                box.classList.remove('unanswered');
                updateProgress();
              }, 0);
            });
            lik.appendChild(lab);
          })(v);
        }
        box.appendChild(lik);
        dims.appendChild(box);
      });
    });
    updateProgress();
  }
  function updateProgress() {
    var res = readResponses();
    var done = answeredCount(res), total = totalItems();
    $('fillProgress').style.width = (total ? done / total * 100 : 0) + '%';
    $('fillProgressText').textContent = '已作答 ' + done + '／' + total + ' 題' + (done < total ? '（未作答的題目送出前會標示出來）' : '（全部完成，可以預覽並送出）');
  }
  function buildRecord() {
    var res = readResponses();
    var done = answeredCount(res), total = totalItems();
    if (done < total) {
      var missing = [];
      config.dimensions.forEach(function (dim, di) {
        dim.items.forEach(function (_, ii) {
          if (res[di][ii] === undefined) { missing.push(dim.name + ' 第 ' + (ii + 1) + ' 題'); $('qbox-' + di + '-' + ii).classList.add('unanswered'); }
        });
      });
      return { ok: false, error: '還有 ' + (total - done) + ' 題未作答：' + missing.slice(0, 5).join('、') + (missing.length > 5 ? '……' : '') };
    }
    var code = $('fCode').value.trim();
    var group = config.groupLabel ? $('fGroup').value : '';
    if (config.groupLabel && !group) return { ok: false, error: '請先選「' + config.groupLabel + '」。' };
    var background = {};
    var bgMissing = [];
    config.backgroundFields.forEach(function (f) {
      var v = $('bg-' + f.key).value;
      background[f.key] = v;
      if (!v) bgMissing.push(f.label);
    });
    if (bgMissing.length) return { ok: false, error: '背景資料還沒填：' + bgMissing.join('、') + '。' };
    var scores = dimensionScores(res);
    var rec = {
      id: code || ('R' + Math.random().toString(36).slice(2, 8).toUpperCase()),
      submitted_at: new Date().toISOString(),
      group: group, background: background,
      responses: res, scores: scores,
      structure: { dimensions: config.dimensions.map(function (d) { return d.name; }), scalePoints: config.scalePoints }
    };
    return { ok: true, record: rec };
  }
  function renderPreview(rec) {
    var rows = config.dimensions.map(function (dim) {
      var s = rec.scores[dim.name];
      return '<tr><td>' + esc(dim.name) + '</td><td class="num">' + fmt3(s) + '</td><td class="num">' + dim.items.length + ' 題</td></tr>';
    }).join('');
    $('fillPreview').innerHTML = '<table><tr><th>構面</th><th>平均分數（1~' + config.scalePoints + '）</th><th>題數</th></tr>' + rows + '</table>' +
      '<p class="small muted">構面分數為各題平均。確認無誤後按「送出並存檔」。</p>';
    $('btnSubmit').disabled = false;
  }

  // ---------- 送出 ----------
  function rawHeaders() {
    var h = ['編號', '填答時間'];
    if (config.groupLabel) h.push(config.groupLabel);
    config.backgroundFields.forEach(function (f) { h.push(f.label); });
    config.dimensions.forEach(function (dim, di) { dim.items.forEach(function (_, ii) { h.push(dim.name + '-' + (ii + 1)); }); });
    h.push('responses_json');
    return h;
  }
  function rawRow(rec) {
    var row = [rec.id, rec.submitted_at];
    if (config.groupLabel) row.push(rec.group);
    config.backgroundFields.forEach(function (f) { row.push(rec.background[f.key] || ''); });
    config.dimensions.forEach(function (dim, di) { dim.items.forEach(function (_, ii) { row.push(rec.responses[di][ii]); }); });
    row.push(JSON.stringify(rec));
    return row;
  }
  function scoreHeaders() {
    var h = ['編號', '填答時間'];
    if (config.groupLabel) h.push(config.groupLabel);
    config.backgroundFields.forEach(function (f) { h.push(f.label); });
    config.dimensions.forEach(function (d) { h.push(d.name + '平均'); });
    return h;
  }
  function scoreRow(rec) {
    var row = [rec.id, rec.submitted_at];
    if (config.groupLabel) row.push(rec.group);
    config.backgroundFields.forEach(function (f) { row.push(rec.background[f.key] || ''); });
    config.dimensions.forEach(function (d) { row.push(fmt3(rec.scores[d.name])); });
    return row;
  }
  function submitRecord(rec) {
    var status = $('submitStatus');
    status.textContent = '送出中…';
    $('btnSubmit').disabled = true;
    function saveLocal(msg) {
      var list = localRecords();
      list.push(rec);
      saveLocalRecords(list);
      status.textContent = msg || '已存在本機紀錄（本機模式）。';
      $('fillDone').innerHTML = '<p class="ok">已送出，編號 ' + esc(rec.id) + '。' + esc(status.textContent) + '</p>';
    }
    if (!config.appsScriptUrl) { saveLocal('已存在本機紀錄（本機模式）。'); return; }
    var payload = { action: 'submit', record: rec, rawHeaders: rawHeaders(), rawRow: rawRow(rec), scoreHeaders: scoreHeaders(), scoreRow: scoreRow(rec) };
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 60000);
    fetch(config.appsScriptUrl, { method: 'POST', body: JSON.stringify(payload), signal: ctrl.signal })
      .then(function (r) { clearTimeout(timer); return r.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return { ok: false, error: '後端回應不是 JSON：' + t.slice(0, 120) }; } }); })
      .then(function (j) {
        if (j && j.ok) {
          status.textContent = '已送出並寫入 Google Sheets。';
          $('fillDone').innerHTML = '<p class="ok">已送出並寫入 Google Sheets，編號 ' + esc(rec.id) + '。</p>';
          var list = localRecords(); list.push(rec); saveLocalRecords(list);
        } else {
          saveLocal('Sheet 寫入失敗（' + ((j && j.error) || '未知錯誤') + '），已先存在本機。');
        }
      })
      .catch(function (e) {
        clearTimeout(timer);
        saveLocal('送出逾時或連線失敗（' + e.message + '），已先存在本機，請稍後再試或改用本機紀錄。');
      });
  }

  // ---------- 後台：共用 ----------
  function bindGlobal() {
    document.querySelectorAll('nav button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('nav button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        $('view-fill').hidden = b.dataset.view !== 'fill';
        $('view-admin').hidden = b.dataset.view !== 'admin';
      });
    });
    $('btnPreview').addEventListener('click', function () {
      var r = buildRecord();
      if (!r.ok) { $('fillPreview').innerHTML = '<p class="bad">' + esc(r.error) + '</p>'; $('btnSubmit').disabled = true; return; }
      renderPreview(r.record);
      // 注意：送出由下方 $('btnSubmit') 的 listener 統一處理（重新讀取表單再送出），
      // 這裡不可再掛 onclick，否則點一次送出會寫入兩筆（DOM 測試抓到的重複送出 bug）。
    });
    $('btnSubmit').addEventListener('click', function () {
      var r = buildRecord();
      if (!r.ok) { $('fillPreview').innerHTML = '<p class="bad">' + esc(r.error) + '</p>'; return; }
      submitRecord(r.record);
    });
    $('btnAdminUnlock').addEventListener('click', function () {
      var v = $('adminCodeInput').value;
      if (v === config.adminCode) {
        adminUnlocked = true;
        $('adminLock').hidden = true;
        $('adminBody').hidden = false;
        $('adminWarn').innerHTML = config.adminCode === '123456'
          ? '<p class="warn">你還在用預設後台密碼 123456，請先改成自己的密碼再正式發連結。</p>' : '';
        renderAdmin();
      } else {
        $('adminLockMsg').textContent = '密碼不正確，請再試一次。';
      }
    });
    // 資料來源
    document.querySelectorAll('[data-src]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('[data-src]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        currentSource = b.dataset.src;
        renderSourceControls();
      });
    });
    $('btnLoadDemo').addEventListener('click', function () {
      records = generateDemo();
      saveLocalRecords(records);
      currentSource = 'local';
      renderRecords();
      alert('已載入 24 筆示範資料（合成資料，非真實問卷）。');
    });
    $('btnClearLocal').addEventListener('click', function () {
      if (!confirm('確定清除本機紀錄？此動作無法復原（Google Sheets 的資料不受影響）。')) return;
      saveLocalRecords([]);
      records = [];
      renderRecords();
    });
    document.querySelectorAll('[data-atab]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('[data-atab]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        ['records', 'report', 'settings'].forEach(function (t) { $('atab-' + t).hidden = t !== b.dataset.atab; });
        if (b.dataset.atab === 'settings') renderSettings();
      });
    });
    $('recGroupFilter').addEventListener('change', renderRecords);
    $('recSearch').addEventListener('input', renderRecords);
    $('btnCsvRaw').addEventListener('click', downloadCsvRaw);
    $('btnCsvScores').addEventListener('click', downloadCsvScores);
    $('btnJson').addEventListener('click', function () { download('stats_records.json', JSON.stringify(records, null, 2), 'application/json'); });
    $('btnGenReport').addEventListener('click', generateReportUI);
    $('btnPrintReport').addEventListener('click', function () { window.print(); });
    $('btnDownloadReport').addEventListener('click', function () {
      if (!lastReportHTML) { alert('請先按「產生分析報告」。'); return; }
      download('stats_report.html', '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>分析報告</title></head><body>' + lastReportHTML + '</body></html>', 'text/html');
    });
    $('btnDownloadWord').addEventListener('click', downloadWordReport);
    $('btnDownloadConfig').addEventListener('click', downloadConfig);
  }
  function renderSourceControls() {
    var c = $('srcControls');
    if (currentSource === 'local') {
      $('srcHint').textContent = '本機紀錄：存在這台瀏覽器的資料（填答時自動存一份備份）。';
      c.innerHTML = '<button id="btnReloadLocal" class="secondary">重新讀取本機紀錄</button>';
      $('btnReloadLocal').addEventListener('click', function () { records = localRecords(); renderRecords(); });
      records = localRecords();
    } else if (currentSource === 'sheet') {
      $('srcHint').textContent = 'Google Sheets：從題目檔的 Apps Script 網址讀回（?action=list）。';
      c.innerHTML = '<button id="btnLoadSheet" class="secondary">從 Google Sheets 讀取</button><span class="small muted" id="sheetStatus"></span>';
      $('btnLoadSheet').addEventListener('click', function () {
        if (!config.appsScriptUrl) { $('sheetStatus').textContent = '此研究未填 Apps Script 網址（本機模式），無法從 Sheets 讀取。'; return; }
        $('sheetStatus').textContent = '讀取中…';
        fetch(config.appsScriptUrl + '?action=list').then(function (r) { return r.json(); }).then(function (j) {
          records = (j && j.records) || [];
          $('sheetStatus').textContent = '讀到 ' + records.length + ' 筆。';
          renderRecords();
        }).catch(function (e) { $('sheetStatus').textContent = '讀取失敗：' + e.message; });
      });
      return;
    } else {
      $('srcHint').textContent = '匯入檔案：支援本系統下載的 JSON（含 responses 與 scores 的完整紀錄）。';
      c.innerHTML = '<input type="file" id="importFile" accept=".json,application/json">';
      $('importFile').addEventListener('change', function (ev) {
        var f = ev.target.files[0];
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          try {
            var j = JSON.parse(rd.result);
            var list = Array.isArray(j) ? j : (j.records || []);
            if (!list.length) throw new Error('檔案裡沒有紀錄');
            records = list;
            renderRecords();
          } catch (e) { alert('匯入失敗：' + e.message); }
        };
        rd.readAsText(f);
      });
      return;
    }
    renderRecords();
  }
  function renderAdmin() {
    var gf = $('recGroupFilter');
    gf.innerHTML = '<option value="all">全部分組</option>' + (config.groupOptions || []).map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('');
    renderSourceControls();
  }

  // ---------- 後台：填答紀錄 ----------
  function filteredRecords() {
    var g = $('recGroupFilter').value, q = $('recSearch').value.trim();
    return records.filter(function (r) {
      if (g !== 'all' && r.group !== g) return false;
      if (q && String(r.id).indexOf(q) < 0) return false;
      return true;
    });
  }
  function renderRecords() {
    var list = filteredRecords();
    $('recSummary').textContent = '共 ' + records.length + ' 筆（篩選後 ' + list.length + ' 筆）。';
    if (!list.length) { $('recTable').innerHTML = '<p class="muted">目前沒有紀錄。請先填答、載入示範資料，或從 Google Sheets／檔案匯入。</p>'; $('recDetail').innerHTML = ''; return; }
    var head = '<tr><th>編號</th><th>時間</th>' + (config.groupLabel ? '<th>' + esc(config.groupLabel) + '</th>' : '') +
      config.dimensions.map(function (d) { return '<th>' + esc(d.name) + '</th>'; }).join('') + '<th>操作</th></tr>';
    var rows = list.map(function (r, i) {
      var t = r.submitted_at ? r.submitted_at.slice(0, 19).replace('T', ' ') : '';
      return '<tr><td>' + esc(r.id) + '</td><td>' + esc(t) + '</td>' + (config.groupLabel ? '<td>' + esc(r.group || '') + '</td>' : '') +
        config.dimensions.map(function (d) { return '<td class="num">' + fmt3(r.scores ? r.scores[d.name] : null) + '</td>'; }).join('') +
        '<td><button class="secondary" data-viewrec="' + i + '">查看</button> <button class="secondary danger" data-delrec="' + esc(r.id) + '">刪除</button></td></tr>';
    }).join('');
    $('recTable').innerHTML = '<table>' + head + rows + '</table>';
    $('recTable').querySelectorAll('[data-viewrec]').forEach(function (b) {
      b.addEventListener('click', function () { renderRecordDetail(list[parseInt(b.dataset.viewrec, 10)]); });
    });
    $('recTable').querySelectorAll('[data-delrec]').forEach(function (b) {
      b.addEventListener('click', function () { deleteRecord(b.dataset.delrec); });
    });
  }
  function renderRecordDetail(r) {
    if (!r) return;
    var h = '<h3>編號 ' + esc(r.id) + '</h3><p class="small muted">' + esc(r.submitted_at || '') + '　' +
      (config.groupLabel ? esc(config.groupLabel) + '：' + esc(r.group || '') + '　' : '') +
      config.backgroundFields.map(function (f) { return esc(f.label) + '：' + esc(r.background ? r.background[f.key] : ''); }).join('　') + '</p>';
    config.dimensions.forEach(function (dim, di) {
      h += '<h4>' + esc(dim.name) + '（平均 ' + fmt3(r.scores ? r.scores[dim.name] : null) + '）</h4><table><tr><th>題目</th><th>分數</th></tr>' +
        dim.items.map(function (it, ii) { return '<tr><td>' + esc(it) + '</td><td class="num">' + (r.responses && r.responses[di] ? r.responses[di][ii] : '—') + '</td></tr>'; }).join('') + '</table>';
    });
    $('recDetail').innerHTML = h;
  }
  function deleteRecord(id) {
    if (!confirm('確定刪除編號 ' + id + '？')) return;
    function removeLocal() {
      records = records.filter(function (r) { return String(r.id) !== String(id); });
      saveLocalRecords(records);
      renderRecords();
      $('recDetail').innerHTML = '';
    }
    if (currentSource === 'sheet' && config.appsScriptUrl) {
      fetch(config.appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'delete', id: id, adminCode: config.adminCode }) })
        .then(function (r) { return r.json(); }).then(function (j) {
          if (j && j.ok) removeLocal();
          else alert('Sheet 刪除被拒：' + ((j && j.error) || '未知錯誤') + '。請確認 Apps Script 已設 ADMIN_CODE 且與後台密碼相同。');
        }).catch(function (e) { alert('刪除失敗：' + e.message); });
    } else removeLocal();
  }
  function downloadCsvRaw() {
    if (!records.length) { alert('沒有紀錄可下載。'); return; }
    var lines = [rawHeaders().map(csvCell).join(',')];
    records.forEach(function (r) { lines.push(rawRow(r).map(csvCell).join(',')); });
    download('stats_raw_data.csv', '\uFEFF' + lines.join('\n'), 'text/csv');
  }
  function downloadCsvScores() {
    if (!records.length) { alert('沒有紀錄可下載。'); return; }
    var lines = [scoreHeaders().map(csvCell).join(',')];
    records.forEach(function (r) { lines.push(scoreRow(r).map(csvCell).join(',')); });
    download('stats_scores.csv', '\uFEFF' + lines.join('\n'), 'text/csv');
  }

  // ---------- 示範資料 ----------
  function generateDemo() {
    var rnd = mulberry32(20261108);
    function gauss() { var u = Math.max(1e-9, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    function clampRound(x) { return Math.max(1, Math.min(5, Math.round(x))); }
    var groups = ['低年級', '中年級', '高年級'];
    var list = [];
    for (var i = 0; i < 24; i++) {
      var gi = i % 3, grp = groups[gi];
      var attLatent = [3.2, 3.6, 4.0][gi] + gauss() * 0.5;
      var effLatent = 0.8 + 0.65 * attLatent + gauss() * 0.4;
      var responses = {};
      [attLatent, effLatent].forEach(function (lat, di) {
        responses[di] = {};
        config.dimensions[di].items.forEach(function (_, ii) { responses[di][ii] = clampRound(lat + gauss() * 0.5); });
      });
      var scores = {};
      config.dimensions.forEach(function (dim, di) {
        var vals = dim.items.map(function (_, ii) { return responses[di][ii]; });
        scores[dim.name] = STATS.mean(vals);
      });
      // 背景欄位鍵須用 config 的欄位代碼（config.js 是 sex/age/years，txt 解析是 bg1/bg2/bg3），
      // 不可寫死 bg1/bg2/bg3，否則報告讀不到背景值、卡方全為 0、平均數檢定會跳過。
      // 值用 i 循環取選項：年資（3 選項）與分組同步變化，示範報告看得到組間差異。
      var bg = {};
      config.backgroundFields.forEach(function (f) { bg[f.key] = f.options[i % f.options.length]; });
      list.push({
        id: 'DEMO-' + String(i + 1).padStart(2, '0'),
        submitted_at: new Date(Date.now() - (24 - i) * 3600 * 1000).toISOString(),
        group: grp,
        background: bg,
        responses: responses, scores: scores, demo: true,
        structure: { dimensions: config.dimensions.map(function (d) { return d.name; }), scalePoints: config.scalePoints }
      });
    }
    return list;
  }

  // ---------- 後台：分析報告 ----------
  function tableHTML(headers, rows) {
    return '<table><tr>' + headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + (typeof c === 'number' ? ' class="num"' : '') + '>' + (typeof c === 'number' ? fmt3(c) : esc(c)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
  }
  function barHTML(label, value, max) {
    var pct = max ? Math.max(0, Math.min(100, value / max * 100)) : 0;
    return '<div class="bar-row"><span class="lbl">' + esc(label) + '</span><span class="bar-track"><span class="bar-fill" style="display:block;width:' + pct.toFixed(1) + '%"></span></span><span class="v">' + fmt3(value) + '</span></div>';
  }
  function generateReportUI() {
    if (!records.length) { $('reportArea').innerHTML = '<p class="bad">目前沒有填答紀錄，請先填答、載入示範資料，或從 Google Sheets／檔案匯入。</p>'; return; }
    var opts = {
      runChiSquare: $('optChi').checked, runMeanTests: $('optMean').checked,
      runAncova: $('optAncova').checked, runCorrelation: $('optCorr').checked, runRegression: $('optReg').checked
    };
    var data = StatsReport.buildReportData(records, config, opts);
    lastReportData = data;
    var h = '';
    h += '<h2>' + esc(config.studyTitle) + ' — 分析報告（雛形）</h2>';
    h += '<p class="muted small">樣本數 N=' + data.n + '；α=.05；數值顯示小數第 3 位。報告章節與表格格式待研究者提供後再對，雛形先以完整統計量呈現。</p>';
    if (data.warnings.length) h += '<div class="warn">' + data.warnings.map(esc).join('<br>') + '</div>';
    // 樣本
    h += '<h3>一、樣本分布</h3>';
    data.sample.groups.forEach(function (g) {
      h += '<h4>' + esc(g.label) + '</h4>' + tableHTML(['類別', '人數', '百分比 %'], g.rows.map(function (r) { return [r.value, r.n, r.pct]; }));
    });
    // 描述＋信度
    h += '<h3>二、描述統計與信度</h3>';
    h += tableHTML(['構面', '題數', '平均數', '標準差', '最小值', '最大值', "Cronbach's α"],
      data.descriptive.map(function (d) { return [d.name, d.k, d.mean, d.sd, d.min, d.max, d.cronbachAlpha === null ? '—' : d.cronbachAlpha]; }));
    data.descriptive.forEach(function (d) { if (d.alphaNote) h += '<p class="small warn">' + esc(d.name) + '：' + esc(d.alphaNote) + '</p>'; });
    h += '<h4>構面平均分數</h4>' + data.descriptive.map(function (d) { return barHTML(d.name, d.mean || 0, config.scalePoints); }).join('');
    // 卡方
    if (opts.runChiSquare) {
      h += '<h3>三、卡方檢定</h3>';
      if (!data.chiSquare.length) h += '<p class="muted">無卡方分析（未指定且無兩個以上類別變項）。</p>';
      data.chiSquare.forEach(function (c) {
        h += '<h4>' + esc(c.varA) + ' × ' + esc(c.varB) + '</h4>';
        h += tableHTML([''].concat(c.colLabels), c.rowLabels.map(function (rl, i) { return [rl].concat(c.table[i]); }));
        var r = c.result;
        h += '<p>χ²=' + fmt3(r.chi2) + '，df=' + r.df + '，p' + fmtP(r.p) + sigMark(r.p) + '，Cramer\'s V=' + fmt3(r.cramerV) + (r.phi !== null ? '，φ=' + fmt3(r.phi) : '') + '。' +
          (r.significant ? '達顯著，兩變項有關聯。' : '未達顯著，兩變項無顯著關聯。') + '</p>';
        if (r.warnings.length) h += '<p class="small warn">' + esc(r.warnings.join('；')) + '</p>';
      });
    }
    // 平均數檢定
    if (opts.runMeanTests) {
      h += '<h3>四、平均數檢定／變異數分析</h3>';
      if (!data.meanTests.length) h += '<p class="muted">無平均數檢定分析。</p>';
      data.meanTests.forEach(function (m) {
        h += '<h4>' + esc(m.group) + ' → ' + esc(m.outcome) + '</h4>';
        if (m.kind === 't') {
          var t = m.result;
          h += tableHTML(['組別', 'n', '平均數', '標準差'],
            m.levels.map(function (lv, i) { return [lv, i === 0 ? t.n1 : t.n2, i === 0 ? t.mean1 : t.mean2, i === 0 ? t.sd1 : t.sd2]; }));
          h += '<p>Welch t=' + fmt3(t.welch.t) + '，df=' + fmt3(t.welch.df) + '，p' + fmtP(t.welch.p) + sigMark(t.welch.p) +
            '；Student t=' + fmt3(t.student.t) + '，df=' + t.student.df + '，p' + fmtP(t.student.p) + sigMark(t.student.p) +
            '；平均差=' + fmt3(t.meanDiff) + '，Cohen\'s d=' + fmt3(t.cohenD) + '，Hedges\' g=' + fmt3(t.hedgesG) + '。</p>';
          h += '<p class="small muted">Levene 同質性檢定：F=' + fmt3(m.levene.F) + '，p' + fmtP(m.levene.p) + sigMark(m.levene.p) + '。變異數不同質時以 Welch 為準。</p>';
        } else {
          var a = m.result;
          h += tableHTML(['組別', 'n', '平均數', '標準差'],
            m.levels.map(function (lv, i) { return [lv, a.groupN[i], a.groupMeans[i], a.groupSD[i]]; }));
          h += tableHTML(['變異來源', 'SS', 'df', 'MS', 'F', 'p'],
            [['組間', a.ssb, a.dfb, a.msb, a.F, a.p], ['組內', a.ssw, a.dfw, a.msw, '—', '—'], ['總和', a.sst, a.dfb + a.dfw, '—', '—', '—']]);
          h += '<p>F=' + fmt3(a.F) + '，p' + fmtP(a.p) + sigMark(a.p) + '，η²=' + fmt3(a.eta2) + '，ω²=' + fmt3(a.omega2) + '。</p>';
          h += '<p class="small muted">Levene 同質性檢定：F=' + fmt3(m.levene.F) + '，p' + fmtP(m.levene.p) + sigMark(m.levene.p) + '。</p>';
          h += '<h4>事後比較（成對 t＋Bonferroni 校正；Tukey／Scheffe 待報告格式確認）</h4>';
          h += tableHTML(['比較', '平均差', 't (Welch)', 'p', 'p (Bonferroni)', "Cohen's d"],
            a.postHoc.map(function (p) { return [m.levels[p.g1] + ' − ' + m.levels[p.g2], p.meanDiff, p.tWelch, p.pWelch, p.pBonf, p.cohenD]; }));
        }
      });
    }
    // ANCOVA
    if (opts.runAncova) {
      h += '<h3>五、共變異數分析</h3>';
      if (!data.ancova.length) h += '<p class="muted">未指定共變異數分析（須在 [分析設定] 寫「共變異數：分組 → 依變項，控制 共變項」）。</p>';
      data.ancova.forEach(function (a) {
        var r = a.result;
        if (!r.ok) { h += '<p class="bad">' + esc(a.group + ' → ' + a.outcome) + '：' + esc(r.error) + '</p>'; return; }
        h += '<h4>' + esc(a.group) + ' → ' + esc(a.outcome) + '，控制 ' + esc(a.covariate) + '</h4>';
        h += '<p>斜率同質性檢定：F=' + fmt3(r.slopeHomogeneity.F) + '，p' + fmtP(r.slopeHomogeneity.p) + sigMark(r.slopeHomogeneity.p) +
          '（' + (r.slopeHomogeneity.homogeneous ? '同質，可續做 ANCOVA' : '不同質，不宜用同一斜率調整') + '）。</p>';
        h += tableHTML(['組別', '原始平均', '調整後平均'],
          a.levels.map(function (lv, i) { return [lv, r.groupMeans[i], r.adjMeans[i]]; }));
        h += '<p>組別效果：F=' + fmt3(r.groupEffect.F) + '，df=' + r.groupEffect.df1 + '／' + r.groupEffect.df2 + '，p' + fmtP(r.groupEffect.p) + sigMark(r.groupEffect.p) + '，partial η²=' + fmt3(r.groupEffect.partialEta2) + '。' +
          '共變項效果：F=' + fmt3(r.covariateEffect.F) + '，p' + fmtP(r.covariateEffect.p) + sigMark(r.covariateEffect.p) + '，partial η²=' + fmt3(r.covariateEffect.partialEta2) + '。R²=' + fmt3(r.R2) + '。</p>';
      });
    }
    // 相關
    if (opts.runCorrelation && data.correlation) {
      h += '<h3>六、關聯分析</h3>';
      var names = data.correlation.names;
      h += '<h4>相關矩陣（Pearson r）</h4>';
      h += tableHTML([''].concat(names), names.map(function (a) {
        return [a].concat(names.map(function (b) {
          var c = data.correlation.matrix[a][b];
          return a === b ? '1.000' : fmt3(c.r) + sigMark(c.p);
        }));
      }));
      data.correlation.pairs.forEach(function (p) {
        h += '<p>' + esc(p.a) + ' × ' + esc(p.b) + '：Pearson r=' + fmt3(p.pearson.r) + '，p' + fmtP(p.pearson.p) + sigMark(p.pearson.p) +
          '，95% CI [' + fmt3(p.pearson.ci95[0]) + ', ' + fmt3(p.pearson.ci95[1]) + ']；Spearman ρ=' + fmt3(p.spearman.r) + '，p' + fmtP(p.spearman.p) + sigMark(p.spearman.p) + '。</p>';
      });
      h += starNote();
    }
    // 迴歸
    if (opts.runRegression) {
      h += '<h3>七、線性迴歸分析</h3>';
      if (!data.regression.length) h += '<p class="muted">未指定迴歸分析（須在 [分析設定] 寫「迴歸：依變項 ← 預測變項」）。</p>';
      data.regression.forEach(function (rg) {
        var r = rg.result;
        if (!r.ok) { h += '<p class="bad">' + esc(rg.outcome) + '：' + esc(r.error) + '</p>'; return; }
        h += '<h4>依變項：' + esc(rg.outcome) + ' ← ' + esc(rg.predictors.join('、')) + '</h4>';
        h += '<p>R=' + fmt3(r.R) + '，R²=' + fmt3(r.R2) + '，調整後 R²=' + fmt3(r.adjR2) + '，F=' + fmt3(r.F) + '，p' + fmtP(r.pF) + sigMark(r.pF) + '，Durbin-Watson=' + fmt3(r.durbinWatson) + '。</p>';
        h += tableHTML(['變項', 'B', 'SE', 'β（標準化）', 't', 'p', 'VIF'],
          r.coefficients.map(function (c) { return [c.name, c.b, c.se, c.betaStd || '—', c.t, c.p, c.name === '(截距)' ? '—' : r.vif[c.name]]; }));
        if (r.warnings.length) h += '<p class="small warn">' + esc(r.warnings.join('；')) + '</p>';
      });
    }
    var notes = $('reportNotes').value.trim();
    if (notes) h += '<h3>研究者解讀</h3><p>' + esc(notes).replace(/\n/g, '<br>') + '</p>';
    $('reportArea').innerHTML = h;
    lastReportHTML = h;
  }

  // ---------- Word 下載（雛形格式，沿用 AHP 的 DocxBuilder） ----------
  function downloadWordReport() {
    if (!lastReportData) { alert('請先按「產生分析報告」。'); return; }
    var D = DocxBuilder, data = lastReportData;
    var blocks = [];
    blocks.push(D.heading1(config.studyTitle + ' — 分析報告（雛形）'));
    blocks.push(D.bodyPara('樣本數 N=' + data.n + '；顯著水準 α=.05；數值顯示小數第 3 位。報告章節與表格格式待研究者提供後再對，雛形先以完整統計量呈現。'));
    function tbl(headers, rows) {
      return D.table(headers.map(function (x) { return { t: String(x) }; }),
        rows.map(function (r) { return r.map(function (c) { return { t: String(c === null || c === undefined || (typeof c === 'number' && !isFinite(c)) ? '—' : (typeof c === 'number' ? c.toFixed(3) : c)) }; }); }));
    }
    blocks.push(D.heading2('一、樣本分布'));
    data.sample.groups.forEach(function (g) {
      blocks.push(D.boldPara(g.label));
      blocks.push(tbl(['類別', '人數', '百分比 %'], g.rows.map(function (r) { return [r.value, r.n, r.pct.toFixed(1)]; })));
    });
    blocks.push(D.heading2('二、描述統計與信度'));
    blocks.push(tbl(['構面', '題數', '平均數', '標準差', "Cronbach's α"],
      data.descriptive.map(function (d) { return [d.name, d.k, d.mean, d.sd, d.cronbachAlpha === null ? '—' : d.cronbachAlpha]; })));
    if (data.chiSquare.length) {
      blocks.push(D.heading2('三、卡方檢定'));
      data.chiSquare.forEach(function (c) {
        blocks.push(D.boldPara(c.varA + ' × ' + c.varB));
        blocks.push(D.bodyPara('χ²=' + fmt3(c.result.chi2) + '，df=' + c.result.df + '，p' + fmtP(c.result.p) + sigMark(c.result.p) + '，Cramer\'s V=' + fmt3(c.result.cramerV) + '。'));
      });
    }
    if (data.meanTests.length) {
      blocks.push(D.heading2('四、平均數檢定／變異數分析'));
      data.meanTests.forEach(function (m) {
        if (m.kind === 't') {
          blocks.push(D.bodyPara(m.group + ' → ' + m.outcome + '：Welch t=' + fmt3(m.result.welch.t) + '，p' + fmtP(m.result.welch.p) + sigMark(m.result.welch.p) + '，Cohen\'s d=' + fmt3(m.result.cohenD) + '。'));
        } else {
          blocks.push(D.bodyPara(m.group + ' → ' + m.outcome + '：F=' + fmt3(m.result.F) + '，p' + fmtP(m.result.p) + sigMark(m.result.p) + '，η²=' + fmt3(m.result.eta2) + '。'));
        }
      });
    }
    if (data.ancova.length) {
      blocks.push(D.heading2('五、共變異數分析'));
      data.ancova.forEach(function (a) {
        if (a.result.ok) blocks.push(D.bodyPara(a.group + ' → ' + a.outcome + '（控制 ' + a.covariate + '）：組別 F=' + fmt3(a.result.groupEffect.F) + '，p' + fmtP(a.result.groupEffect.p) + sigMark(a.result.groupEffect.p) + '；斜率同質 p' + fmtP(a.result.slopeHomogeneity.p) + '。'));
      });
    }
    if (data.correlation) {
      blocks.push(D.heading2('六、關聯分析'));
      data.correlation.pairs.forEach(function (p) {
        blocks.push(D.bodyPara(p.a + ' × ' + p.b + '：Pearson r=' + fmt3(p.pearson.r) + '，p' + fmtP(p.pearson.p) + sigMark(p.pearson.p) + '。'));
      });
    }
    if (data.regression.length) {
      blocks.push(D.heading2('七、線性迴歸分析'));
      data.regression.forEach(function (rg) {
        if (rg.result.ok) blocks.push(D.bodyPara('依變項 ' + rg.outcome + '：R²=' + fmt3(rg.result.R2) + '，F=' + fmt3(rg.result.F) + '，p' + fmtP(rg.result.pF) + sigMark(rg.result.pF) + '。'));
      });
    }
    var notes = $('reportNotes').value.trim();
    if (notes) { blocks.push(D.heading2('研究者解讀')); blocks.push(D.bodyPara(notes)); }
    downloadBinary('stats_report.docx', D.buildDocx(blocks, config.studyTitle + ' 分析報告'));
  }

  // ---------- 後台：研究設定 ----------
  function renderSettings() {
    var h = '<table><tr><th>項目</th><th>內容</th></tr>' +
      '<tr><td>研究標題</td><td>' + esc(config.studyTitle) + '</td></tr>' +
      '<tr><td>副標題</td><td>' + esc(config.studySubtitle || '') + '</td></tr>' +
      '<tr><td>主要分組</td><td>' + esc(config.groupLabel || '（無）') + '：' + esc((config.groupOptions || []).join('、')) + '</td></tr>' +
      '<tr><td>背景欄位</td><td>' + config.backgroundFields.map(function (f) { return esc(f.label) + '（' + esc(f.options.join('、')) + '）'; }).join('<br>') + '</td></tr>' +
      '<tr><td>量表</td><td>' + config.scalePoints + ' 點：' + esc(config.scaleLabels.join('、')) + '</td></tr>' +
      '<tr><td>構面</td><td>' + config.dimensions.map(function (d) { return esc(d.name) + '（' + d.items.length + ' 題）'; }).join('<br>') + '</td></tr>' +
      '<tr><td>Apps Script</td><td>' + (config.appsScriptUrl ? esc(config.appsScriptUrl) : '（未填，本機模式）') + '</td></tr></table>';
    h += '<h3>分析設定</h3><pre class="small">' + esc(JSON.stringify(config.analysis || {}, null, 2)) + '</pre>';
    h += '<label for="settingsIntro">問卷說明（改完只存到本機測試，正式更換請改題目檔）</label><textarea id="settingsIntro">' + esc(config.intro || '') + '</textarea>' +
      '<button id="btnSaveIntro" class="secondary">只存到本機測試</button>';
    $('settingsEditor').innerHTML = h;
    $('btnSaveIntro').addEventListener('click', function () {
      var ov = loadOverride() || {};
      ov.intro = $('settingsIntro').value;
      localStorage.setItem(storageKey('stats_config_override'), JSON.stringify(ov));
      config.intro = ov.intro;
      $('settingsMsg').textContent = '已存到本機測試（重新整理後仍有效，正式部署請改題目檔）。';
      renderFill();
    });
  }
  function downloadConfig() {
    var body = '// 統計量化問卷 — 研究者部署設定（由後台下載，請覆蓋 repo 裡的 config.js）\n' +
      'window.STATS_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n';
    download('config.js', body, 'text/javascript');
  }

  // ---------- 啟動 ----------
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

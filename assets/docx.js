// 最小 .docx 產生器（不依賴外部套件，可在瀏覽器與 Node 執行）
// 產生的是真正的 OOXML 檔案：以 stored（不壓縮）方式把 XML 零件寫進 ZIP，
// Word、LibreOffice、Google 文件皆可開啟。字體依 HiTeach 論文第四章慣例：
// 中文標楷體、英文 Times New Roman；內文 12pt、行距 1.5 倍、首行縮排 2 字；
// 章標題 18pt、節標題 16pt，皆置中；表題置於表上方，不加資料來源註。
(function (global) {
  'use strict';
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    // Node 舊環境備援
    var bytes = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
      else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    return new Uint8Array(bytes);
  }
  function concat(arrays) {
    var total = 0, i, out, off = 0;
    arrays.forEach(function (a) { total += a.length; });
    out = new Uint8Array(total);
    arrays.forEach(function (a) { out.set(a, off); off += a.length; });
    return out;
  }
  // CRC-32（IEEE），ZIP 必要欄位。
  var CRC_TABLE = (function () {
    var table = [], c, k, n;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    var crc = 0xFFFFFFFF, i;
    for (i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function u16(n) { return new Uint8Array([n & 0xFF, (n >> 8) & 0xFF]); }
  function u32(n) { return new Uint8Array([n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF]); }
  // files: [{ name, data }]，data 為字串（UTF-8）或 Uint8Array。回傳 Uint8Array。
  function buildZip(files) {
    var locals = [], centrals = [], offset = 0, i, f, data, crc, nameBytes;
    files.forEach(function (file) {
      data = (typeof file.data === 'string') ? utf8(file.data) : file.data;
      crc = crc32(data);
      nameBytes = utf8(file.name);
      locals.push(concat([
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x21),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0), nameBytes, data
      ]));
      centrals.push(concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x21),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes
      ]));
      offset += locals[locals.length - 1].length;
    });
    var cd = concat(centrals);
    var eocd = concat([
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(cd.length), u32(offset), u16(0)
    ]);
    return concat(locals.concat([cd, eocd]));
  }

  function runXml(text, opts) {
    opts = opts || {};
    var size = opts.size || 24;
    var rPr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="標楷體" w:hAnsi="Times New Roman"/>'
      + (opts.bold ? '<w:b/>' : '') + (opts.italic ? '<w:i/>' : '')
      + '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/></w:rPr>';
    return '<w:r>' + rPr + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
  }
  // opts: style, align, bold, size, firstLine(1/2 字以 twips 計，內文預設 480),
  // spaceBefore, spaceAfter（twips），line（行距，360 = 1.5 倍）
  function paraXml(text, opts) {
    opts = opts || {};
    var pPr = '<w:pPr>';
    if (opts.style) pPr += '<w:pStyle w:val="' + opts.style + '"/>';
    if (opts.align) pPr += '<w:jc w:val="' + opts.align + '"/>';
    if (opts.firstLine) pPr += '<w:ind w:firstLine="' + opts.firstLine + '"/>';
    pPr += '<w:spacing w:before="' + (opts.spaceBefore || 0) + '" w:after="' + (opts.spaceAfter || 0) + '" w:line="' + (opts.line || 360) + '" w:lineRule="auto"/>';
    pPr += '</w:pPr>';
    return '<w:p>' + pPr + runXml(text, opts) + '</w:p>';
  }
  function bodyPara(text) { return paraXml(text, { size: 24, align: 'both', firstLine: 480, spaceAfter: 0 }); }
  function boldPara(text) { return paraXml(text, { size: 24, bold: true, align: 'left', spaceBefore: 120, spaceAfter: 60 }); }
  function heading1(text) { return paraXml(text, { style: 'Heading1', size: 36, bold: true, align: 'center', spaceBefore: 240, spaceAfter: 240 }); }
  function heading2(text) { return paraXml(text, { style: 'Heading2', size: 32, bold: true, align: 'center', spaceBefore: 120, spaceAfter: 120 }); }
  function captionPara(text) { return paraXml(text, { size: 24, bold: true, align: 'left', spaceBefore: 120, spaceAfter: 60 }); }
  function sourcePara(text) { return paraXml(text, { size: 20, align: 'left', spaceBefore: 60, spaceAfter: 240 }); }
  // headerCells / bodyRows 的每個儲存格為 { t, bold, align }。
  function tableXml(headerCells, bodyRows) {
    var cols = Math.max(headerCells.length, 1);
    var pageWidth = 9026, colW = Math.floor(pageWidth / cols);
    var grid = '<w:tblGrid>';
    for (var gi = 0; gi < cols; gi++) grid += '<w:gridCol w:w="' + colW + '"/>';
    grid += '</w:tblGrid>';
    var borders = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="000000"/><w:left w:val="single" w:sz="4" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:color="000000"/><w:right w:val="single" w:sz="4" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:color="000000"/></w:tblBorders>';
    function cellXml(cell, isHeader) {
      var tcPr = '<w:tcPr><w:tcW w:w="' + colW + '" w:type="dxa"/>' + (isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>' : '') + '</w:tcPr>';
      var align = cell.align === 'right' ? 'right' : 'left';
      return '<w:tc>' + tcPr + '<w:p><w:pPr><w:jc w:val="' + align + '"/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
        + runXml(cell.t, { size: 24, bold: !!(isHeader || cell.bold) }) + '</w:p></w:tc>';
    }
    function rowXml(cells, isHeader) {
      var r = '<w:tr>' + (isHeader ? '<w:trPr><w:tblHeader w:val="true"/></w:trPr>' : '');
      cells.forEach(function (c) { r += cellXml(c, isHeader); });
      return r + '</w:tr>';
    }
    var out = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' + borders + '</w:tblPr>' + grid;
    out += rowXml(headerCells, true);
    bodyRows.forEach(function (row) { out += rowXml(row, false); });
    return out + '</w:tbl>';
  }
  function documentXml(blocks) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body>' + blocks.join('') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>'
      + '</w:body></w:document>';
  }
  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="標楷體" w:hAnsi="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="zh-TW"/></w:rPr></w:rPrDefault>'
      + '<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>'
      + '</w:styles>';
  }
  function buildDocx(blocks, title) {
    var files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'word/document.xml', data: documentXml(blocks) },
      { name: 'word/styles.xml', data: stylesXml() },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><cp:title>' + esc(title || '分析報告') + '</cp:title><cp:creator>統計量化問卷系統</cp:creator></cp:coreProperties>' }
    ];
    return buildZip(files);
  }
  var api = { esc: esc, buildZip: buildZip, crc32: crc32, para: paraXml, bodyPara: bodyPara, boldPara: boldPara, heading1: heading1, heading2: heading2, captionPara: captionPara, sourcePara: sourcePara, table: tableXml, documentXml: documentXml, buildDocx: buildDocx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DocxBuilder = api;
})(typeof window !== 'undefined' ? window : globalThis);

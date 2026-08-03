// Minimal, dependency-free PDF writer for roster exports.
// Unit card art is stored as plain baseline JPEGs, and PDF's DCTDecode filter
// accepts raw JPEG bytes directly as an image XObject stream, so cards can be
// embedded without any re-encoding or image library.
const fs = require('fs');

const PAGE_W = 595.28; // A4 portrait, in points
const PAGE_H = 841.89;
const MARGIN = 28;
const GAP = 12;
const HEADER_H = 34;
const COLS = 3;
const ROWS = 3;
const PER_PAGE = COLS * ROWS;
const CARD_ASPECT = 642 / 900; // width / height of every unit_cards/*.jpg

function pdfEscape(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// Builds a PDF (as a Buffer) with one page of unit cards per PER_PAGE cards.
// `cards`: [{ name, imagePath }], already in the desired display order.
function buildRosterPdf(cards, title, subtitle) {
  const gridW = PAGE_W - 2 * MARGIN;
  const gridH = PAGE_H - 2 * MARGIN - HEADER_H;
  const cellW = (gridW - (COLS - 1) * GAP) / COLS;
  const cellH = (gridH - (ROWS - 1) * GAP) / ROWS;
  let cardW = cellW;
  let cardH = cardW / CARD_ASPECT;
  if (cardH > cellH) {
    cardH = cellH;
    cardW = cardH * CARD_ASPECT;
  }

  const numPages = Math.max(1, Math.ceil(cards.length / PER_PAGE));

  const catalogNum = 1;
  const pagesNum = 2;
  const fontNum = 3;
  const firstImageNum = 4;
  const imageNums = cards.map((_, i) => firstImageNum + i);
  const firstContentNum = firstImageNum + cards.length;
  const firstPageNum = firstContentNum + numPages;
  const pageNums = [];
  for (let i = 0; i < numPages; i++) pageNums.push(firstPageNum + i);
  const maxObjNum = pageNums[pageNums.length - 1];

  const buffers = [];
  let length = 0;
  const offsets = [];

  function push(buf) {
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf, 'latin1');
    buffers.push(buf);
    length += buf.length;
  }
  function beginObj(num) {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
  }
  function endObj() {
    push('endobj\n');
  }

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  beginObj(catalogNum);
  push(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>\n`);
  endObj();

  beginObj(pagesNum);
  push(`<< /Type /Pages /Kids [${pageNums.map(n => `${n} 0 R`).join(' ')}] /Count ${numPages} >>\n`);
  endObj();

  beginObj(fontNum);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\n');
  endObj();

  cards.forEach((c, i) => {
    const buf = fs.readFileSync(c.imagePath);
    beginObj(imageNums[i]);
    push(`<< /Type /XObject /Subtype /Image /Width 642 /Height 900 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${buf.length} >>\nstream\n`);
    push(buf);
    push('\nendstream\n');
    endObj();
  });

  for (let p = 0; p < numPages; p++) {
    const pageCards = cards.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
    let content = '';
    content += `BT /F1 14 Tf ${MARGIN} ${PAGE_H - MARGIN - 10} Td (${pdfEscape(title)}) Tj ET\n`;
    if (subtitle) {
      content += `BT /F1 9 Tf ${MARGIN} ${PAGE_H - MARGIN - 26} Td (${pdfEscape(`${subtitle} — page ${p + 1}/${numPages}`)}) Tj ET\n`;
    }
    pageCards.forEach((c, idx) => {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const cellX = MARGIN + col * (cellW + GAP);
      const cellTop = PAGE_H - MARGIN - HEADER_H - row * (cellH + GAP);
      const x = cellX + (cellW - cardW) / 2;
      const y = cellTop - cardH - (cellH - cardH) / 2;
      const globalIdx = p * PER_PAGE + idx;
      content += `q ${cardW.toFixed(2)} 0 0 ${cardH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${globalIdx} Do Q\n`;
    });

    const contentBuf = Buffer.from(content, 'latin1');
    const contentNum = firstContentNum + p;
    beginObj(contentNum);
    push(`<< /Length ${contentBuf.length} >>\nstream\n`);
    push(contentBuf);
    push('\nendstream\n');
    endObj();

    const xobjEntries = pageCards.map((c, idx) => `/Im${p * PER_PAGE + idx} ${imageNums[p * PER_PAGE + idx]} 0 R`).join(' ');
    beginObj(pageNums[p]);
    push(`<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontNum} 0 R >> /XObject << ${xobjEntries} >> >> /Contents ${contentNum} 0 R >>\n`);
    endObj();
  }

  const xrefOffset = length;
  push(`xref\n0 ${maxObjNum + 1}\n`);
  push('0000000000 65535 f \n');
  for (let n = 1; n <= maxObjNum; n++) {
    push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${maxObjNum + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.concat(buffers);
}

module.exports = { buildRosterPdf };

// Browser port of the server-side pdf.js: same hand-rolled PDF writer, but
// image bytes come from fetch() instead of fs.readFileSync, and byte buffers
// are plain Uint8Arrays instead of Node Buffers. Exposes buildRosterPdf(),
// which resolves to a Blob ready for URL.createObjectURL().
(function () {
  'use strict';

  const PAGE_W = 595.28; // A4 portrait, in points
  const PAGE_H = 841.89;
  const MARGIN = 28;
  const GAP = 12;
  const HEADER_H = 34;
  const COLS = 3;
  const ROWS = 3;
  const PER_PAGE = COLS * ROWS;
  const CARD_ASPECT = 642 / 900; // width / height of every unit_cards/*.jpg

  // Core-14 Helvetica / Helvetica-Bold glyph widths (per 1000 em units), used
  // to word-wrap faction text without an embedded font. Only the printable
  // ASCII range is listed; anything else falls back to AVG_WIDTH.
  const AVG_WIDTH = 556;
  const HELV_WIDTHS = {
    ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
    '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
    '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
    ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
    K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
    U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
    k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
    u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
    '{': 334, '|': 260, '}': 334, '~': 584,
  };
  const HELV_BOLD_WIDTHS = {
    ' ': 278, '!': 333, '"': 474, '#': 556, '$': 556, '%': 889, '&': 722, "'": 238,
    '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
    '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
    ':': 333, ';': 333, '<': 584, '=': 584, '>': 584, '?': 611, '@': 975,
    A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556,
    K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
    U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    '[': 333, '\\': 278, ']': 333, '^': 584, _: 556, '`': 333,
    a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
    k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
    u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
    '{': 389, '|': 280, '}': 389, '~': 584,
  };

  function pdfEscape(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  // Helvetica (via WinAnsiEncoding) can't render most of what column J throws
  // at it — curly quotes, em dashes, ★ complexity ratings, and mathematical
  // bold-sans-serif letters used for in-text emphasis (e.g. "𝗗𝗲𝗺𝗼𝗻 𝗼𝗳 𝗙𝘂𝗿𝘆").
  // NFKD folds the styled letters back to plain ASCII; everything left outside
  // Latin-1 gets a plain substitute or is dropped so it never reaches the font.
  function sanitizeText(str) {
    return String(str)
      .normalize('NFKD')
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...')
      .replace(/[•●]/g, '-')
      .replace(/★/g, '*')
      .replace(/[^\x00-\xFF]/g, '');
  }

  function charWidth(ch, bold) {
    const w = (bold ? HELV_BOLD_WIDTHS : HELV_WIDTHS)[ch];
    return w !== undefined ? w : AVG_WIDTH;
  }

  function textWidth(str, size, bold) {
    let w = 0;
    for (const ch of str) w += charWidth(ch, bold);
    return (w * size) / 1000;
  }

  // Greedy word-wrap of a single line of text (no embedded newlines) to fit maxWidth.
  function wrapWords(text, maxWidth, size, bold) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || textWidth(candidate, size, bold) <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // Strips the (sometimes typo'd) "<Faction> Loyalty Bonus:" prefix so it isn't
  // repeated right under our own "Loyalty Bonus" heading.
  function stripBonusPrefix(text) {
    return text.replace(/^[A-Za-z' ]{0,40}Loyalty Bonus:\s*/, '');
  }

  // Lays out faction reference text (description / abilities / loyalty bonus)
  // into as many pages as needed. Returns an array of pages, each an array of
  // { text, x, y, size, bold } draw ops in PDF user-space coordinates — bottom
  // of a `size`-pt line sits at `y`, matching the Tm baseline PDF expects.
  function layoutFactionPages(factions) {
    const usableW = PAGE_W - 2 * MARGIN;
    const topY = PAGE_H - MARGIN - HEADER_H;
    const bottomY = MARGIN;

    const pages = [];
    let ops = [];
    let y = topY;

    function newPage() {
      pages.push(ops);
      ops = [];
      y = topY;
    }
    function ensureSpace(h) {
      if (y - h < bottomY) newPage();
    }
    function addLine(text, size, bold, gapBefore) {
      ensureSpace(gapBefore + size * 1.3);
      y -= gapBefore;
      ops.push({ text, x: MARGIN, y: y - size, size, bold });
      y -= size * 1.3;
    }
    // `raw` may contain its own newlines (bullets on separate source lines);
    // each is wrapped independently so existing bullet breaks are preserved.
    function addWrapped(raw, size, bold, gapBefore) {
      let first = true;
      for (const line of sanitizeText(raw).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
          ensureSpace(size * 0.6);
          y -= size * 0.6;
          continue;
        }
        for (const wrapped of wrapWords(trimmed, usableW, size, bold)) {
          addLine(wrapped, size, bold, first ? gapBefore : 0);
          first = false;
        }
      }
    }

    factions.forEach((f, i) => {
      addLine(sanitizeText(f.faction), 13, true, i === 0 ? 0 : 16);
      if (f.description) addWrapped(f.description, 9, false, 5);
      const abilityEntries = Object.entries(f.abilities || {});
      if (abilityEntries.length) {
        addLine('Abilities', 10, true, 9);
        for (const [, text] of abilityEntries) addWrapped(text, 9, false, 4);
      }
      if (f.bonus) {
        addLine('Loyalty Bonus', 10, true, 9);
        addWrapped(stripBonusPrefix(f.bonus), 9, false, 4);
      }
    });

    if (ops.length || pages.length === 0) pages.push(ops);
    return pages;
  }

  function strToBytes(str) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    return bytes;
  }

  // Builds a PDF (as a Blob): faction reference pages (description, per-type
  // abilities, loyalty bonus) followed by the unit card grid, PER_PAGE cards
  // per page. `cards`: [{ name, faction, cost, image }], already in display
  // order — `image` is the same relative URL used for <img src>.
  // `factions`: [{ faction, description, abilities, bonus }], in display order.
  async function buildRosterPdf(cards, title, subtitle, factions) {
    factions = factions || [];
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

    const imageBytes = await Promise.all(
      cards.map(async c => {
        const res = await fetch(c.image);
        if (!res.ok) throw new Error(`Could not load ${c.image}`);
        return new Uint8Array(await res.arrayBuffer());
      })
    );

    const infoPages = factions.length ? layoutFactionPages(factions) : [];
    const numCardPages = Math.max(1, Math.ceil(cards.length / PER_PAGE));
    const totalPages = infoPages.length + numCardPages;

    const catalogNum = 1;
    const pagesNum = 2;
    const fontBoldNum = 3;
    const fontRegularNum = 4;
    const firstImageNum = 5;
    const imageNums = cards.map((_, i) => firstImageNum + i);
    const firstContentNum = firstImageNum + cards.length;
    const firstPageNum = firstContentNum + totalPages;
    const pageNums = [];
    for (let i = 0; i < totalPages; i++) pageNums.push(firstPageNum + i);
    const maxObjNum = pageNums[pageNums.length - 1];

    const chunks = [];
    let length = 0;
    const offsets = [];

    function push(data) {
      const bytes = typeof data === 'string' ? strToBytes(data) : data;
      chunks.push(bytes);
      length += bytes.length;
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
    push(`<< /Type /Pages /Kids [${pageNums.map(n => `${n} 0 R`).join(' ')}] /Count ${totalPages} >>\n`);
    endObj();

    beginObj(fontBoldNum);
    push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\n');
    endObj();

    beginObj(fontRegularNum);
    push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n');
    endObj();

    cards.forEach((c, i) => {
      const bytes = imageBytes[i];
      beginObj(imageNums[i]);
      push(`<< /Type /XObject /Subtype /Image /Width 642 /Height 900 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
      push(bytes);
      push('\nendstream\n');
      endObj();
    });

    const pageContents = []; // one content string per page, in final order

    const safeTitle = pdfEscape(sanitizeText(title));
    infoPages.forEach((ops, i) => {
      let content = `BT /F1 14 Tf ${MARGIN} ${PAGE_H - MARGIN - 10} Td (${safeTitle}) Tj ET\n`;
      content += `BT /F2 9 Tf ${MARGIN} ${PAGE_H - MARGIN - 26} Td (${pdfEscape(sanitizeText(`Faction Info — page ${i + 1}/${infoPages.length}`))}) Tj ET\n`;
      for (const op of ops) {
        const font = op.bold ? 'F1' : 'F2';
        content += `BT /${font} ${op.size} Tf 1 0 0 1 ${op.x.toFixed(2)} ${op.y.toFixed(2)} Tm (${pdfEscape(op.text)}) Tj ET\n`;
      }
      pageContents.push(content);
    });

    for (let p = 0; p < numCardPages; p++) {
      const pageCards = cards.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
      let content = `BT /F1 14 Tf ${MARGIN} ${PAGE_H - MARGIN - 10} Td (${safeTitle}) Tj ET\n`;
      if (subtitle) {
        content += `BT /F2 9 Tf ${MARGIN} ${PAGE_H - MARGIN - 26} Td (${pdfEscape(sanitizeText(`${subtitle} — page ${p + 1}/${numCardPages}`))}) Tj ET\n`;
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
      pageContents.push(content);
    }

    pageContents.forEach((content, i) => {
      const contentBytes = strToBytes(content);
      const contentNum = firstContentNum + i;
      beginObj(contentNum);
      push(`<< /Length ${contentBytes.length} >>\nstream\n`);
      push(contentBytes);
      push('\nendstream\n');
      endObj();

      const isCardPage = i >= infoPages.length;
      const p = i - infoPages.length;
      const xobjEntries = isCardPage
        ? cards
            .slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE)
            .map((c, idx) => `/Im${p * PER_PAGE + idx} ${imageNums[p * PER_PAGE + idx]} 0 R`)
            .join(' ')
        : '';
      beginObj(pageNums[i]);
      push(
        `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
          `/Resources << /Font << /F1 ${fontBoldNum} 0 R /F2 ${fontRegularNum} 0 R >> /XObject << ${xobjEntries} >> >> ` +
          `/Contents ${contentNum} 0 R >>\n`
      );
      endObj();
    });

    const xrefOffset = length;
    push(`xref\n0 ${maxObjNum + 1}\n`);
    push('0000000000 65535 f \n');
    for (let n = 1; n <= maxObjNum; n++) {
      push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
    }
    push(`trailer\n<< /Size ${maxObjNum + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

    const full = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      full.set(chunk, offset);
      offset += chunk.length;
    }
    return new Blob([full], { type: 'application/pdf' });
  }

  window.BloodfieldsPdf = { buildRosterPdf };
})();

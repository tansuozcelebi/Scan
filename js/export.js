class ExportManager {
  constructor() {
    this.quality = 'medium';
    this.pageSize = 'a4';
  }

  async exportJPG(pages, quality) {
    const q = quality === 'high' ? 0.95 : quality === 'low' ? 0.6 : 0.85;
    const files = [];
    for (let i = 0; i < pages.length; i++) {
      const blob = await new Promise(resolve => {
        pages[i].canvas.toBlob(resolve, 'image/jpeg', q);
      });
      files.push({ blob, name: `scan_${i + 1}.jpg` });
    }

    if (files.length > 1) {
      const shared = await this._shareMultiple(files, 'Taranan Sayfalar');
      if (shared) return files;
    }

    for (const f of files) {
      await this._download(f.blob, f.name);
    }
    return files;
  }

  async _shareMultiple(items, title) {
    if (!navigator.canShare || !navigator.share) return false;
    const files = items.map(i => new File([i.blob], i.name, { type: i.blob.type || this._mimeFromName(i.name) }));
    if (!navigator.canShare({ files })) return false;
    try {
      await navigator.share({ files, title });
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return true;
      return false;
    }
  }

  async exportPDF(pages, quality, pageSize) {
    const { jsPDF } = window.jspdf;
    const sizes = {
      a4: [210, 297],
      letter: [215.9, 279.4],
      legal: [215.9, 355.6]
    };
    const size = sizes[pageSize] || sizes.a4;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: size });
    const q = quality === 'high' ? 0.95 : quality === 'low' ? 0.6 : 0.85;

    for (let i = 0; i < pages.length; i++) {
      if (i > 0) pdf.addPage(size, 'portrait');
      const canvas = pages[i].canvas;
      const imgData = canvas.toDataURL('image/jpeg', q);

      const pageW = size[0];
      const pageH = size[1];
      const imgRatio = canvas.width / canvas.height;
      const pageRatio = pageW / pageH;

      let drawW, drawH, drawX, drawY;
      if (pageSize === 'original') {
        const pxToMm = 25.4 / 96;
        drawW = canvas.width * pxToMm;
        drawH = canvas.height * pxToMm;
        drawX = 0;
        drawY = 0;
      } else if (imgRatio > pageRatio) {
        drawW = pageW;
        drawH = pageW / imgRatio;
        drawX = 0;
        drawY = (pageH - drawH) / 2;
      } else {
        drawH = pageH;
        drawW = pageH * imgRatio;
        drawX = (pageW - drawW) / 2;
        drawY = 0;
      }
      pdf.addImage(imgData, 'JPEG', drawX, drawY, drawW, drawH);
    }

    const blob = pdf.output('blob');
    await this._download(blob, `scan_${Date.now()}.pdf`);
    return blob;
  }

  async exportDOCX(ocrResults) {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } = window.docx;

    const children = [];

    children.push(new Paragraph({
      children: [new TextRun({ text: 'Taranan Belge - OCR Sonucu', bold: true, size: 32 })],
      heading: HeadingLevel.HEADING_1
    }));

    children.push(new Paragraph({
      children: [new TextRun({
        text: `Tarih: ${new Date().toLocaleDateString('tr-TR')}`,
        size: 20,
        color: '666666'
      })]
    }));

    children.push(new Paragraph({ children: [] }));

    for (let i = 0; i < ocrResults.length; i++) {
      if (i > 0) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }

      if (ocrResults.length > 1) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `Sayfa ${i + 1}`, bold: true, size: 24 })],
          heading: HeadingLevel.HEADING_2
        }));
      }

      const lines = ocrResults[i].text.split('\n');
      for (const line of lines) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line, size: 22 })]
        }));
      }
    }

    const doc = new Document({
      sections: [{ children }]
    });

    const blob = await Packer.toBlob(doc);
    await this._download(blob, `scan_${Date.now()}.docx`);
    return blob;
  }

  async exportXLSX(ocrResults) {
    const wb = XLSX.utils.book_new();

    for (let i = 0; i < ocrResults.length; i++) {
      const text = ocrResults[i].text;
      const lines = text.split('\n').filter(l => l.trim());
      const rows = [];

      for (const line of lines) {
        const cells = line.split(/\t|  +|\|/).map(c => c.trim()).filter(c => c);
        const processedCells = cells.map(cell => {
          const num = cell.replace(/[.,]/g, (m, offset, str) => {
            const afterDot = str.substring(offset + 1);
            if (m === ',' && !afterDot.includes(',') && afterDot.length <= 2) return '.';
            if (m === '.' && !afterDot.includes('.') && afterDot.length <= 2) return '.';
            return '';
          });
          const parsed = parseFloat(num);
          if (!isNaN(parsed) && num.replace(/[^0-9.eE+-]/g, '') === num.replace(/[^0-9.eE+-]/g, '')) {
            return parsed;
          }
          return cell;
        });
        rows.push(processedCells);
      }

      const maxCols = Math.max(...rows.map(r => r.length), 1);
      const paddedRows = rows.map(r => {
        while (r.length < maxCols) r.push('');
        return r;
      });

      const ws = XLSX.utils.aoa_to_sheet(paddedRows);
      const sheetName = ocrResults.length > 1 ? `Sayfa ${i + 1}` : 'Tarama';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await this._download(blob, `scan_${Date.now()}.xlsx`);
    return blob;
  }

  async exportTXT(ocrResults) {
    let text = '';
    for (let i = 0; i < ocrResults.length; i++) {
      if (i > 0) text += '\n\n--- Sayfa ' + (i + 1) + ' ---\n\n';
      text += ocrResults[i].text;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    await this._download(blob, `scan_${Date.now()}.txt`);
    return blob;
  }

  async _download(blob, filename) {
    const mime = blob.type || this._mimeFromName(filename);
    const file = new File([blob], filename, { type: mime });

    if (this._canShareFile(file)) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  _canShareFile(file) {
    return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  }

  _mimeFromName(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      pdf: 'application/pdf', txt: 'text/plain;charset=utf-8',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }[ext] || 'application/octet-stream';
  }
}

window.ExportManager = ExportManager;

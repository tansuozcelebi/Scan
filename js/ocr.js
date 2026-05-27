class OCREngine {
  constructor() {
    this.worker = null;
    this.isReady = false;
    this.currentLang = 'tur';
  }

  async initialize(lang) {
    this.currentLang = lang || 'tur';
    if (this.worker) {
      await this.worker.terminate();
    }
    this.worker = await Tesseract.createWorker(this.currentLang, 1, {
      logger: (m) => {
        if (this.onProgress && m.status === 'recognizing text') {
          this.onProgress(Math.round(m.progress * 100));
        }
      }
    });
    this.isReady = true;
  }

  async recognize(canvas) {
    if (!this.isReady) {
      await this.initialize(this.currentLang);
    }

    const dataUrl = canvas.toDataURL('image/png');
    const result = await this.worker.recognize(dataUrl);
    return {
      text: result.data.text,
      confidence: result.data.confidence,
      words: result.data.words || [],
      lines: result.data.lines || [],
      blocks: result.data.blocks || [],
      paragraphs: result.data.paragraphs || []
    };
  }

  async recognizeMultiple(pages, onPageProgress) {
    const results = [];
    for (let i = 0; i < pages.length; i++) {
      if (onPageProgress) onPageProgress(i, pages.length);
      const result = await this.recognize(pages[i].canvas);
      results.push({ pageIndex: i, ...result });
    }
    return results;
  }

  extractStructuredData(ocrResult) {
    const lines = ocrResult.text.split('\n').filter(l => l.trim());
    const rows = [];
    for (const line of lines) {
      const cells = line.split(/\t|  +|\|/).map(c => c.trim()).filter(c => c);
      if (cells.length > 0) {
        rows.push(cells);
      }
    }
    return rows;
  }

  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.isReady = false;
    }
  }
}

window.OCREngine = OCREngine;

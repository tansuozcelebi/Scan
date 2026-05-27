(() => {
  'use strict';

  const scanner = new DocumentScanner();
  const ocrEngine = new OCREngine();
  const exportManager = new ExportManager();

  let currentScreen = 'homeScreen';
  let screenHistory = [];
  let ocrResults = [];
  let cropMode = false;
  let cropCorners = [];
  let activeCropHandle = null;

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    bindEvents();
    loadSettings();
    loadRecentDocs();
  }

  function navigateTo(screenId, addToHistory = true) {
    if (addToHistory && currentScreen !== screenId) {
      screenHistory.push(currentScreen);
    }
    $$('.screen').forEach(s => s.classList.remove('active'));
    $(screenId).classList.add('active');
    currentScreen = screenId;

    $('btnBack').classList.toggle('hidden', screenHistory.length === 0);
    $('pageTitle').textContent = getScreenTitle(screenId);
    $('btnSettings').classList.toggle('hidden', screenId !== 'homeScreen');
  }

  function navigateBack() {
    if (screenHistory.length === 0) return;
    const prev = screenHistory.pop();
    if (currentScreen === 'cameraScreen') {
      scanner.stopCamera();
    }
    navigateTo(prev, false);
  }

  function getScreenTitle(id) {
    const titles = {
      homeScreen: 'DocScan Pro',
      cameraScreen: 'Tarama',
      editorScreen: 'Düzenle',
      reviewScreen: 'Sayfalar',
      exportScreen: 'Dışa Aktar',
      ocrScreen: 'Metin Tanıma',
      settingsScreen: 'Ayarlar'
    };
    return titles[id] || 'DocScan Pro';
  }

  function showToast(msg, duration = 2500) {
    const toast = $('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.add('hidden'), duration);
  }

  function showLoading(text) {
    $('loadingText').textContent = text || 'Yükleniyor...';
    $('loadingOverlay').classList.remove('hidden');
  }

  function hideLoading() {
    $('loadingOverlay').classList.add('hidden');
  }

  function bindEvents() {
    $('btnBack').addEventListener('click', navigateBack);
    $('btnSettings').addEventListener('click', () => navigateTo('settingsScreen'));

    $('btnNewScan').addEventListener('click', startScan);
    $('btnImportImage').addEventListener('click', importFromGallery);

    $('btnCapture').addEventListener('click', capturePhoto);
    $('btnAutoCapture').addEventListener('click', toggleAutoCapture);
    $('btnFlash').addEventListener('click', toggleFlash);
    $('btnFinishScan').addEventListener('click', finishScan);

    $('btnRotateLeft').addEventListener('click', rotateCurrentPage);
    $('btnCrop').addEventListener('click', toggleCropMode);
    $('btnFilter').addEventListener('click', toggleFilterPanel);
    $('btnOCR').addEventListener('click', runOCROnCurrentPage);
    $('btnEditorDone').addEventListener('click', editorDone);

    $$('.filter-opt').forEach(btn => {
      btn.addEventListener('click', () => applyFilter(btn.dataset.filter));
    });
    $('brightness').addEventListener('input', (e) => adjustBrightness(parseInt(e.target.value)));
    $('contrast').addEventListener('input', (e) => adjustContrast(parseInt(e.target.value)));

    $('btnAddPage').addEventListener('click', addMorePages);
    $('btnExport').addEventListener('click', () => navigateTo('exportScreen'));

    $$('.export-btn').forEach(btn => {
      btn.addEventListener('click', () => handleExport(btn.dataset.format));
    });

    $('btnCopyText').addEventListener('click', copyOCRText);
    $('btnExportOCR').addEventListener('click', () => navigateTo('exportScreen'));

    $('fileInput').addEventListener('change', handleFileImport);

    initCropHandles();
  }

  async function startScan() {
    navigateTo('cameraScreen');
    const video = $('cameraFeed');
    const overlay = $('overlayCanvas');
    $('pageCounter').classList.toggle('hidden', scanner.pages.length === 0);
    $('pageCount').textContent = scanner.pages.length;

    const success = await scanner.startCamera(video, overlay);
    if (!success) {
      showToast('Kamera erişimi reddedildi');
      navigateBack();
      return;
    }

    scanner.onDetectionUpdate = (result) => {
      const status = $('detectionStatus');
      const statusText = $('statusText');
      if (result.detected) {
        status.classList.add('detected');
        statusText.textContent = result.stable ? 'Belge hazır - Çekiliyor...' : 'Belge algılandı';
      } else {
        status.classList.remove('detected');
        statusText.textContent = 'Belge aranıyor...';
      }
    };

    scanner.onAutoCapture = () => {
      if (scanner.autoCapture) {
        capturePhoto();
        scanner.edgeDetector.reset();
      }
    };
  }

  function capturePhoto() {
    const page = scanner.capture();
    if (!page) return;

    if (navigator.vibrate) navigator.vibrate(50);

    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:white;z-index:999;opacity:0.8;pointer-events:none;';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 150);

    $('pageCounter').classList.remove('hidden');
    $('pageCount').textContent = scanner.pages.length;

    showToast(`Sayfa ${scanner.pages.length} çekildi`);
  }

  function toggleAutoCapture() {
    scanner.autoCapture = !scanner.autoCapture;
    $('btnAutoCapture').classList.toggle('active', scanner.autoCapture);
    showToast(scanner.autoCapture ? 'Otomatik çekim açık' : 'Otomatik çekim kapalı');
  }

  async function toggleFlash() {
    const result = await scanner.toggleFlash();
    $('btnFlash').classList.toggle('active', result);
  }

  function finishScan() {
    scanner.stopCamera();
    if (scanner.pages.length === 0) {
      showToast('Hiç sayfa çekilmedi');
      navigateBack();
      return;
    }
    if (scanner.pages.length === 1) {
      scanner.currentPageIndex = 0;
      showEditor();
    } else {
      showReview();
    }
  }

  function importFromGallery() {
    $('fileInput').click();
  }

  function handleFileImport(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    showLoading('Resimler yükleniyor...');

    let loaded = 0;
    files.forEach(file => {
      const img = new Image();
      img.onload = () => {
        scanner.captureFromImage(img);
        loaded++;
        if (loaded === files.length) {
          hideLoading();
          if (scanner.pages.length === 1) {
            scanner.currentPageIndex = 0;
            showEditor();
          } else {
            showReview();
          }
        }
      };
      img.onerror = () => {
        loaded++;
        if (loaded === files.length) {
          hideLoading();
          if (scanner.pages.length > 0) showReview();
          else showToast('Resim yüklenemedi');
        }
      };
      img.src = URL.createObjectURL(file);
    });
    e.target.value = '';
  }

  function showEditor() {
    navigateTo('editorScreen');
    cropMode = false;
    $('cropHandles').classList.add('hidden');
    $('filterPanel').classList.add('hidden');
    renderEditorCanvas();
  }

  function renderEditorCanvas() {
    const page = scanner.getCurrentPage();
    if (!page) return;

    const canvas = $('editorCanvas');
    const container = $('editorContainer');
    const maxW = container.clientWidth;
    const maxH = container.clientHeight;

    const scale = Math.min(maxW / page.canvas.width, maxH / page.canvas.height, 1);
    canvas.width = page.canvas.width * scale;
    canvas.height = page.canvas.height * scale;
    canvas.getContext('2d').drawImage(page.canvas, 0, 0, canvas.width, canvas.height);
  }

  function rotateCurrentPage() {
    const page = scanner.getCurrentPage();
    if (!page) return;
    scanner.rotatePage(page, -90);
    renderEditorCanvas();
  }

  function toggleCropMode() {
    cropMode = !cropMode;
    $('btnCrop').classList.toggle('active', cropMode);
    const handles = $('cropHandles');

    if (cropMode) {
      handles.classList.remove('hidden');
      const canvas = $('editorCanvas');
      const rect = canvas.getBoundingClientRect();
      const margin = 20;
      cropCorners = [
        { x: rect.left + margin, y: rect.top + margin },
        { x: rect.right - margin, y: rect.top + margin },
        { x: rect.right - margin, y: rect.bottom - margin },
        { x: rect.left + margin, y: rect.bottom - margin }
      ];
      updateCropHandles();
    } else {
      handles.classList.add('hidden');
      applyCrop();
    }
  }

  function initCropHandles() {
    $$('.crop-handle').forEach(handle => {
      handle.addEventListener('touchstart', (e) => {
        e.preventDefault();
        activeCropHandle = handle.dataset.corner;
      }, { passive: false });
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        activeCropHandle = handle.dataset.corner;
      });
    });

    document.addEventListener('touchmove', (e) => {
      if (!activeCropHandle) return;
      e.preventDefault();
      const touch = e.touches[0];
      moveCropHandle(touch.clientX, touch.clientY);
    }, { passive: false });

    document.addEventListener('mousemove', (e) => {
      if (!activeCropHandle) return;
      moveCropHandle(e.clientX, e.clientY);
    });

    document.addEventListener('touchend', () => { activeCropHandle = null; });
    document.addEventListener('mouseup', () => { activeCropHandle = null; });
  }

  function moveCropHandle(clientX, clientY) {
    const cornerMap = { tl: 0, tr: 1, br: 2, bl: 3 };
    const idx = cornerMap[activeCropHandle];
    if (idx === undefined) return;
    cropCorners[idx] = { x: clientX, y: clientY };
    updateCropHandles();
  }

  function updateCropHandles() {
    const cornerMap = ['tl', 'tr', 'br', 'bl'];
    cornerMap.forEach((name, i) => {
      const handle = document.querySelector(`.crop-handle[data-corner="${name}"]`);
      handle.style.left = cropCorners[i].x + 'px';
      handle.style.top = cropCorners[i].y + 'px';
    });

    const svg = $('cropOverlay');
    const points = cropCorners.map(c => `${c.x},${c.y}`).join(' ');
    svg.innerHTML = `<polygon points="${points}" fill="rgba(67,97,238,0.15)" stroke="#4361ee" stroke-width="2"/>`;
  }

  function applyCrop() {
    if (cropCorners.length < 4) return;
    const page = scanner.getCurrentPage();
    if (!page) return;

    const canvas = $('editorCanvas');
    const rect = canvas.getBoundingClientRect();
    const scaleX = page.canvas.width / canvas.width;
    const scaleY = page.canvas.height / canvas.height;

    const mappedCorners = cropCorners.map(c => ({
      x: (c.x - rect.left) * scaleX,
      y: (c.y - rect.top) * scaleY
    }));

    scanner.applyPerspectiveCrop(page, mappedCorners);
    renderEditorCanvas();
    showToast('Kırpma uygulandı');
  }

  function toggleFilterPanel() {
    const panel = $('filterPanel');
    panel.classList.toggle('hidden');
    $('btnFilter').classList.toggle('active', !panel.classList.contains('hidden'));
  }

  function applyFilter(filter) {
    const page = scanner.getCurrentPage();
    if (!page) return;
    $$('.filter-opt').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
    scanner.applyFilter(page, filter);
    renderEditorCanvas();
  }

  function adjustBrightness(value) {
    const page = scanner.getCurrentPage();
    if (!page) return;
    scanner.adjustBrightness(page, value);
    renderEditorCanvas();
  }

  function adjustContrast(value) {
    const page = scanner.getCurrentPage();
    if (!page) return;
    scanner.adjustContrast(page, value);
    renderEditorCanvas();
  }

  async function runOCROnCurrentPage() {
    const page = scanner.getCurrentPage();
    if (!page) return;

    navigateTo('ocrScreen');
    $('ocrLoading').classList.remove('hidden');
    $('ocrResult').classList.add('hidden');

    const lang = $('settingLang').value;

    try {
      showToast('OCR motoru başlatılıyor...');
      await ocrEngine.initialize(lang);

      ocrEngine.onProgress = (progress) => {
        $('ocrProgressFill').style.width = progress + '%';
        $('ocrProgressText').textContent = progress + '%';
      };

      const result = await ocrEngine.recognize(page.canvas);
      ocrResults = [result];

      $('ocrLoading').classList.add('hidden');
      $('ocrResult').classList.remove('hidden');
      $('ocrText').value = result.text;
      $('ocrText').removeAttribute('readonly');

      if (result.confidence < 50) {
        showToast('Düşük doğruluk - belge kalitesini kontrol edin');
      } else {
        showToast(`Metin tanındı (%${Math.round(result.confidence)} doğruluk)`);
      }
    } catch (err) {
      console.error('OCR error:', err);
      $('ocrLoading').classList.add('hidden');
      showToast('OCR hatası: ' + err.message);
      navigateBack();
    }
  }

  function copyOCRText() {
    const text = $('ocrText').value;
    navigator.clipboard.writeText(text).then(() => {
      showToast('Metin kopyalandı');
    }).catch(() => {
      $('ocrText').select();
      document.execCommand('copy');
      showToast('Metin kopyalandı');
    });
  }

  function editorDone() {
    if (scanner.pages.length > 1) {
      showReview();
    } else {
      navigateTo('exportScreen');
    }
  }

  function showReview() {
    navigateTo('reviewScreen');
    renderPageThumbs();
  }

  function renderPageThumbs() {
    const container = $('pageThumbs');
    container.innerHTML = '';

    scanner.pages.forEach((page, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb';
      thumb.draggable = true;

      const img = document.createElement('img');
      img.src = page.canvas.toDataURL('image/jpeg', 0.5);
      img.alt = `Sayfa ${i + 1}`;

      const num = document.createElement('span');
      num.className = 'page-num';
      num.textContent = i + 1;

      const del = document.createElement('button');
      del.className = 'page-delete';
      del.innerHTML = '&times;';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        scanner.deletePage(i);
        renderPageThumbs();
        if (scanner.pages.length === 0) {
          navigateTo('homeScreen', false);
          screenHistory = [];
        }
      });

      thumb.appendChild(img);
      thumb.appendChild(num);
      thumb.appendChild(del);

      thumb.addEventListener('click', () => {
        scanner.currentPageIndex = i;
        showEditor();
      });

      let dragSrcIndex = null;
      thumb.addEventListener('dragstart', (e) => {
        dragSrcIndex = i;
        thumb.classList.add('sortable-drag');
        e.dataTransfer.effectAllowed = 'move';
      });
      thumb.addEventListener('dragend', () => {
        thumb.classList.remove('sortable-drag');
      });
      thumb.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      thumb.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragSrcIndex !== null && dragSrcIndex !== i) {
          scanner.reorderPages(dragSrcIndex, i);
          renderPageThumbs();
        }
      });

      container.appendChild(thumb);
    });
  }

  function addMorePages() {
    startScan();
  }

  async function handleExport(format) {
    const quality = $('settingQuality').value;
    const pageSize = $('settingPageSize').value;

    $('exportProgress').classList.remove('hidden');
    $('exportStatus').textContent = 'İşleniyor...';

    try {
      switch (format) {
        case 'jpg':
          $('exportStatus').textContent = 'JPEG oluşturuluyor...';
          updateExportProgress(50);
          await exportManager.exportJPG(scanner.pages, quality);
          updateExportProgress(100);
          showToast('JPEG dosyası indirildi');
          break;

        case 'pdf':
          $('exportStatus').textContent = 'PDF oluşturuluyor...';
          updateExportProgress(50);
          await exportManager.exportPDF(scanner.pages, quality, pageSize);
          updateExportProgress(100);
          showToast('PDF dosyası indirildi');
          break;

        case 'docx':
        case 'xlsx':
        case 'txt':
          $('exportStatus').textContent = 'OCR işleniyor...';
          updateExportProgress(20);

          const lang = $('settingLang').value;
          await ocrEngine.initialize(lang);
          ocrEngine.onProgress = (p) => {
            updateExportProgress(20 + p * 0.6);
          };

          ocrResults = await ocrEngine.recognizeMultiple(scanner.pages, (current, total) => {
            $('exportStatus').textContent = `Sayfa ${current + 1}/${total} OCR işleniyor...`;
          });

          updateExportProgress(80);
          $('exportStatus').textContent = `${format.toUpperCase()} oluşturuluyor...`;

          if (format === 'docx') {
            await exportManager.exportDOCX(ocrResults);
            showToast('Word dosyası indirildi');
          } else if (format === 'xlsx') {
            await exportManager.exportXLSX(ocrResults);
            showToast('Excel dosyası indirildi');
          } else {
            await exportManager.exportTXT(ocrResults);
            showToast('Metin dosyası indirildi');
          }
          updateExportProgress(100);
          break;
      }

      saveToRecent();

    } catch (err) {
      console.error('Export error:', err);
      showToast('Dışa aktarma hatası: ' + err.message);
    }

    setTimeout(() => {
      $('exportProgress').classList.add('hidden');
      updateExportProgress(0);
    }, 1500);
  }

  function updateExportProgress(percent) {
    const fill = $('exportProgress').querySelector('.progress-fill');
    fill.style.width = percent + '%';
  }

  function loadSettings() {
    const saved = localStorage.getItem('docscan_settings');
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        if (settings.quality) $('settingQuality').value = settings.quality;
        if (settings.lang) $('settingLang').value = settings.lang;
        if (settings.autoCapture !== undefined) {
          $('settingAutoCapture').checked = settings.autoCapture;
          scanner.autoCapture = settings.autoCapture;
        }
        if (settings.pageSize) $('settingPageSize').value = settings.pageSize;
      } catch (e) {}
    }

    ['settingQuality', 'settingLang', 'settingAutoCapture', 'settingPageSize'].forEach(id => {
      $(id).addEventListener('change', saveSettings);
    });
  }

  function saveSettings() {
    const settings = {
      quality: $('settingQuality').value,
      lang: $('settingLang').value,
      autoCapture: $('settingAutoCapture').checked,
      pageSize: $('settingPageSize').value
    };
    scanner.autoCapture = settings.autoCapture;
    localStorage.setItem('docscan_settings', JSON.stringify(settings));
  }

  function saveToRecent() {
    if (scanner.pages.length === 0) return;
    try {
      const recent = JSON.parse(localStorage.getItem('docscan_recent') || '[]');
      const thumb = scanner.pages[0].canvas.toDataURL('image/jpeg', 0.3);
      recent.unshift({
        id: Date.now(),
        thumb,
        pages: scanner.pages.length,
        date: new Date().toLocaleDateString('tr-TR')
      });
      if (recent.length > 10) recent.length = 10;
      localStorage.setItem('docscan_recent', JSON.stringify(recent));
    } catch (e) {}
  }

  function loadRecentDocs() {
    try {
      const recent = JSON.parse(localStorage.getItem('docscan_recent') || '[]');
      if (recent.length === 0) return;

      $('recentDocs').classList.remove('hidden');
      const list = $('recentList');
      list.innerHTML = '';

      recent.forEach(doc => {
        const item = document.createElement('div');
        item.className = 'recent-item';
        const img = document.createElement('img');
        img.src = doc.thumb;
        img.alt = 'Tarama';
        const span = document.createElement('span');
        span.textContent = `${doc.pages} sayfa - ${doc.date}`;
        item.appendChild(img);
        item.appendChild(span);
        list.appendChild(item);
      });
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', init);
})();

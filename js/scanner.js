class DocumentScanner {
  constructor() {
    this.video = null;
    this.stream = null;
    this.edgeDetector = new EdgeDetector();
    this.isScanning = false;
    this.autoCapture = true;
    this.flashOn = false;
    this.pages = [];
    this.currentPageIndex = -1;
    this.animFrameId = null;
    this.captureCanvas = document.createElement('canvas');
  }

  async startCamera(videoElement, overlayCanvas) {
    this.video = videoElement;
    this.overlayCanvas = overlayCanvas;

    const constraints = {
      video: {
        facingMode: 'environment',
        width: { ideal: 3840, min: 1920 },
        height: { ideal: 2160, min: 1080 },
        focusMode: 'continuous',
        whiteBalanceMode: 'continuous',
        exposureMode: 'continuous'
      },
      audio: false
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();
      this.isScanning = true;
      this.edgeDetector.reset();
      this._detectLoop();
      return true;
    } catch (err) {
      console.error('Camera error:', err);
      return false;
    }
  }

  stopCamera() {
    this.isScanning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  async toggleFlash() {
    if (!this.stream) return false;
    const track = this.stream.getVideoTracks()[0];
    const capabilities = track.getCapabilities();
    if (!capabilities.torch) return false;
    this.flashOn = !this.flashOn;
    await track.applyConstraints({ advanced: [{ torch: this.flashOn }] });
    return this.flashOn;
  }

  capture() {
    if (!this.video || !this.video.videoWidth) return null;

    this.captureCanvas.width = this.video.videoWidth;
    this.captureCanvas.height = this.video.videoHeight;
    const ctx = this.captureCanvas.getContext('2d');
    ctx.drawImage(this.video, 0, 0);

    const contour = this.edgeDetector.lastContour;
    let resultCanvas;

    if (contour) {
      const widthTop = Math.hypot(contour[1].x - contour[0].x, contour[1].y - contour[0].y);
      const widthBottom = Math.hypot(contour[2].x - contour[3].x, contour[2].y - contour[3].y);
      const heightLeft = Math.hypot(contour[3].x - contour[0].x, contour[3].y - contour[0].y);
      const heightRight = Math.hypot(contour[2].x - contour[1].x, contour[2].y - contour[1].y);
      const outW = Math.round(Math.max(widthTop, widthBottom));
      const outH = Math.round(Math.max(heightLeft, heightRight));
      resultCanvas = this.edgeDetector.perspectiveTransform(this.captureCanvas, contour, outW, outH);
    } else {
      resultCanvas = document.createElement('canvas');
      resultCanvas.width = this.captureCanvas.width;
      resultCanvas.height = this.captureCanvas.height;
      resultCanvas.getContext('2d').drawImage(this.captureCanvas, 0, 0);
    }

    const page = {
      id: Date.now(),
      canvas: resultCanvas,
      originalCanvas: this._cloneCanvas(this.captureCanvas),
      contour: contour ? [...contour] : null,
      filter: 'original',
      brightness: 0,
      contrast: 0,
      rotation: 0
    };

    this.pages.push(page);
    this.currentPageIndex = this.pages.length - 1;
    this.edgeDetector.reset();
    return page;
  }

  captureFromImage(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);

    const page = {
      id: Date.now(),
      canvas: this._cloneCanvas(canvas),
      originalCanvas: canvas,
      contour: null,
      filter: 'original',
      brightness: 0,
      contrast: 0,
      rotation: 0
    };

    this.pages.push(page);
    this.currentPageIndex = this.pages.length - 1;
    return page;
  }

  getCurrentPage() {
    if (this.currentPageIndex < 0 || this.currentPageIndex >= this.pages.length) return null;
    return this.pages[this.currentPageIndex];
  }

  deletePage(index) {
    this.pages.splice(index, 1);
    if (this.currentPageIndex >= this.pages.length) {
      this.currentPageIndex = this.pages.length - 1;
    }
  }

  reorderPages(fromIndex, toIndex) {
    const [page] = this.pages.splice(fromIndex, 1);
    this.pages.splice(toIndex, 0, page);
  }

  applyFilter(page, filter) {
    page.filter = filter;
    this._renderPage(page);
  }

  adjustBrightness(page, value) {
    page.brightness = value;
    this._renderPage(page);
  }

  adjustContrast(page, value) {
    page.contrast = value;
    this._renderPage(page);
  }

  rotatePage(page, degrees) {
    page.rotation = (page.rotation + degrees) % 360;
    const src = page.canvas;
    const rotated = document.createElement('canvas');
    const isHorizontal = degrees % 180 !== 0;

    if (isHorizontal) {
      rotated.width = src.height;
      rotated.height = src.width;
    } else {
      rotated.width = src.width;
      rotated.height = src.height;
    }

    const ctx = rotated.getContext('2d');
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);

    page.canvas = rotated;
  }

  applyPerspectiveCrop(page, corners) {
    const widthTop = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
    const widthBottom = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
    const heightLeft = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
    const heightRight = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);
    const outW = Math.round(Math.max(widthTop, widthBottom));
    const outH = Math.round(Math.max(heightLeft, heightRight));

    page.canvas = this.edgeDetector.perspectiveTransform(page.canvas, corners, outW, outH);
    page.contour = corners;
  }

  _renderPage(page) {
    const src = page.originalCanvas;
    const dst = document.createElement('canvas');
    dst.width = src.width;
    dst.height = src.height;
    const ctx = dst.getContext('2d');
    ctx.drawImage(src, 0, 0);

    if (page.filter !== 'original' || page.brightness !== 0 || page.contrast !== 0) {
      const imageData = ctx.getImageData(0, 0, dst.width, dst.height);
      const data = imageData.data;

      const brightnessVal = page.brightness * 2.55;
      const contrastFactor = (259 * (page.contrast + 255)) / (255 * (259 - page.contrast));

      for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i+1], b = data[i+2];

        r = contrastFactor * (r - 128) + 128 + brightnessVal;
        g = contrastFactor * (g - 128) + 128 + brightnessVal;
        b = contrastFactor * (b - 128) + 128 + brightnessVal;

        if (page.filter === 'grayscale' || page.filter === 'bw') {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          if (page.filter === 'bw') {
            const val = gray > 128 ? 255 : 0;
            r = g = b = val;
          } else {
            r = g = b = gray;
          }
        } else if (page.filter === 'enhanced') {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          const enhanced = contrastFactor * 1.3 * (gray - 128) + 128 + brightnessVal + 10;
          r = g = b = enhanced;
        }

        data[i] = Math.max(0, Math.min(255, r));
        data[i+1] = Math.max(0, Math.min(255, g));
        data[i+2] = Math.max(0, Math.min(255, b));
      }
      ctx.putImageData(imageData, 0, 0);
    }

    page.canvas = dst;
    if (page.contour) {
      const widthTop = Math.hypot(page.contour[1].x - page.contour[0].x, page.contour[1].y - page.contour[0].y);
      const widthBottom = Math.hypot(page.contour[2].x - page.contour[3].x, page.contour[2].y - page.contour[3].y);
      const heightLeft = Math.hypot(page.contour[3].x - page.contour[0].x, page.contour[3].y - page.contour[0].y);
      const heightRight = Math.hypot(page.contour[2].x - page.contour[1].x, page.contour[2].y - page.contour[1].y);
      const outW = Math.round(Math.max(widthTop, widthBottom));
      const outH = Math.round(Math.max(heightLeft, heightRight));
      page.canvas = this.edgeDetector.perspectiveTransform(dst, page.contour, outW, outH);
    }
  }

  _detectLoop() {
    if (!this.isScanning) return;
    const result = this.edgeDetector.detect(this.video, this.overlayCanvas);
    if (this.onDetectionUpdate) {
      this.onDetectionUpdate(result);
    }
    if (result.stable && this.autoCapture) {
      if (this.onAutoCapture) {
        this.onAutoCapture();
      }
    }
    this.animFrameId = requestAnimationFrame(() => this._detectLoop());
  }

  _cloneCanvas(src) {
    const clone = document.createElement('canvas');
    clone.width = src.width;
    clone.height = src.height;
    clone.getContext('2d').drawImage(src, 0, 0);
    return clone;
  }

  getPageDataURL(page, quality) {
    const q = quality === 'high' ? 0.95 : quality === 'low' ? 0.6 : 0.85;
    return page.canvas.toDataURL('image/jpeg', q);
  }

  getPageBlob(page, quality) {
    return new Promise(resolve => {
      const q = quality === 'high' ? 0.95 : quality === 'low' ? 0.6 : 0.85;
      page.canvas.toBlob(resolve, 'image/jpeg', q);
    });
  }

  clearAll() {
    this.pages = [];
    this.currentPageIndex = -1;
  }
}

window.DocumentScanner = DocumentScanner;

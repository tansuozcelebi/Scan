class EdgeDetector {
  constructor() {
    this.lastContour = null;
    this.stableCount = 0;
    this.stableThreshold = 8;
    this.detectionCanvas = document.createElement('canvas');
    this.detectionCtx = this.detectionCanvas.getContext('2d', { willReadFrequently: true });
  }

  detect(video, overlayCanvas) {
    const w = 320;
    const h = Math.round(w * (video.videoHeight / video.videoWidth)) || 240;
    this.detectionCanvas.width = w;
    this.detectionCanvas.height = h;
    this.detectionCtx.drawImage(video, 0, 0, w, h);

    const imageData = this.detectionCtx.getImageData(0, 0, w, h);
    const gray = this._toGrayscale(imageData);
    const blurred = this._gaussianBlur(gray, w, h);
    const edges = this._cannyEdge(blurred, w, h);
    const contour = this._findDocumentContour(edges, w, h);

    if (contour) {
      const scaleX = video.videoWidth / w;
      const scaleY = video.videoHeight / h;
      const scaled = contour.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
      this._drawContour(overlayCanvas, scaled, video.videoWidth, video.videoHeight);

      if (this._isStable(scaled)) {
        this.stableCount++;
      } else {
        this.stableCount = 0;
      }
      this.lastContour = scaled;
      return { detected: true, stable: this.stableCount >= this.stableThreshold, contour: scaled };
    }

    this._clearOverlay(overlayCanvas);
    this.stableCount = 0;
    this.lastContour = null;
    return { detected: false, stable: false, contour: null };
  }

  _toGrayscale(imageData) {
    const { data, width, height } = imageData;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      const j = i * 4;
      gray[i] = Math.round(0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]);
    }
    return gray;
  }

  _gaussianBlur(gray, w, h) {
    const kernel = [1, 4, 6, 4, 1, 4, 16, 24, 16, 4, 6, 24, 36, 24, 6, 4, 16, 24, 16, 4, 1, 4, 6, 4, 1];
    const result = new Uint8Array(w * h);
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        let sum = 0;
        for (let ky = -2; ky <= 2; ky++) {
          for (let kx = -2; kx <= 2; kx++) {
            sum += gray[(y + ky) * w + (x + kx)] * kernel[(ky + 2) * 5 + (kx + 2)];
          }
        }
        result[y * w + x] = sum / 256;
      }
    }
    return result;
  }

  _cannyEdge(gray, w, h) {
    const gx = new Float32Array(w * h);
    const gy = new Float32Array(w * h);
    const mag = new Float32Array(w * h);
    const dir = new Float32Array(w * h);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        gx[idx] = -gray[(y-1)*w+(x-1)] + gray[(y-1)*w+(x+1)] - 2*gray[y*w+(x-1)] + 2*gray[y*w+(x+1)] - gray[(y+1)*w+(x-1)] + gray[(y+1)*w+(x+1)];
        gy[idx] = -gray[(y-1)*w+(x-1)] - 2*gray[(y-1)*w+x] - gray[(y-1)*w+(x+1)] + gray[(y+1)*w+(x-1)] + 2*gray[(y+1)*w+x] + gray[(y+1)*w+(x+1)];
        mag[idx] = Math.sqrt(gx[idx]*gx[idx] + gy[idx]*gy[idx]);
        dir[idx] = Math.atan2(gy[idx], gx[idx]);
      }
    }

    const edges = new Uint8Array(w * h);
    const highThresh = 50;
    const lowThresh = 20;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        if (mag[idx] < lowThresh) continue;

        let angle = dir[idx] * 180 / Math.PI;
        if (angle < 0) angle += 180;
        let n1 = 0, n2 = 0;
        if ((angle < 22.5) || (angle >= 157.5)) {
          n1 = mag[y * w + (x + 1)];
          n2 = mag[y * w + (x - 1)];
        } else if (angle < 67.5) {
          n1 = mag[(y - 1) * w + (x + 1)];
          n2 = mag[(y + 1) * w + (x - 1)];
        } else if (angle < 112.5) {
          n1 = mag[(y - 1) * w + x];
          n2 = mag[(y + 1) * w + x];
        } else {
          n1 = mag[(y - 1) * w + (x - 1)];
          n2 = mag[(y + 1) * w + (x + 1)];
        }

        if (mag[idx] >= n1 && mag[idx] >= n2 && mag[idx] >= highThresh) {
          edges[idx] = 255;
        }
      }
    }
    return edges;
  }

  _findDocumentContour(edges, w, h) {
    const lines = this._houghLines(edges, w, h);
    if (lines.length < 4) {
      return this._fallbackContourDetection(edges, w, h);
    }

    const horizontal = [];
    const vertical = [];
    for (const line of lines) {
      const angle = Math.abs(line.theta - Math.PI / 2);
      if (angle < 0.5) horizontal.push(line);
      else if (angle > 1.0) vertical.push(line);
    }

    if (horizontal.length >= 2 && vertical.length >= 2) {
      horizontal.sort((a, b) => a.rho - b.rho);
      vertical.sort((a, b) => a.rho - b.rho);
      const top = horizontal[0];
      const bottom = horizontal[horizontal.length - 1];
      const left = vertical[0];
      const right = vertical[vertical.length - 1];

      const tl = this._lineIntersection(top, left);
      const tr = this._lineIntersection(top, right);
      const br = this._lineIntersection(bottom, right);
      const bl = this._lineIntersection(bottom, left);

      if (tl && tr && br && bl) {
        const corners = [tl, tr, br, bl];
        if (this._isValidQuad(corners, w, h)) {
          return corners;
        }
      }
    }

    return this._fallbackContourDetection(edges, w, h);
  }

  _fallbackContourDetection(edges, w, h) {
    const points = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (edges[y * w + x] === 255) {
          points.push({ x, y });
        }
      }
    }

    if (points.length < 50) return null;

    const hull = this._convexHull(points);
    if (hull.length < 4) return null;

    const corners = this._findFourCorners(hull, w, h);
    if (corners && this._isValidQuad(corners, w, h)) {
      return corners;
    }
    return null;
  }

  _houghLines(edges, w, h) {
    const maxRho = Math.sqrt(w * w + h * h);
    const thetaSteps = 180;
    const rhoSteps = Math.ceil(maxRho * 2);
    const accumulator = new Int32Array(thetaSteps * rhoSteps);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (edges[y * w + x] !== 255) continue;
        for (let t = 0; t < thetaSteps; t++) {
          const theta = (t * Math.PI) / thetaSteps;
          const rho = Math.round(x * Math.cos(theta) + y * Math.sin(theta) + maxRho);
          if (rho >= 0 && rho < rhoSteps) {
            accumulator[t * rhoSteps + rho]++;
          }
        }
      }
    }

    const threshold = 50;
    const lines = [];
    for (let t = 0; t < thetaSteps; t++) {
      for (let r = 0; r < rhoSteps; r++) {
        if (accumulator[t * rhoSteps + r] > threshold) {
          lines.push({
            theta: (t * Math.PI) / thetaSteps,
            rho: r - maxRho,
            votes: accumulator[t * rhoSteps + r]
          });
        }
      }
    }

    lines.sort((a, b) => b.votes - a.votes);
    return lines.slice(0, 20);
  }

  _lineIntersection(l1, l2) {
    const ct1 = Math.cos(l1.theta), st1 = Math.sin(l1.theta);
    const ct2 = Math.cos(l2.theta), st2 = Math.sin(l2.theta);
    const det = ct1 * st2 - ct2 * st1;
    if (Math.abs(det) < 0.001) return null;
    const x = (l1.rho * st2 - l2.rho * st1) / det;
    const y = (l2.rho * ct1 - l1.rho * ct2) / det;
    return { x, y };
  }

  _convexHull(points) {
    if (points.length < 3) return points;
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (O, A, B) => (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
    const lower = [];
    for (const p of points) {
      while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }

  _findFourCorners(hull, w, h) {
    const targets = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h }
    ];
    const corners = targets.map(target => {
      let best = null, bestDist = Infinity;
      for (const p of hull) {
        const d = Math.hypot(p.x - target.x, p.y - target.y);
        if (d < bestDist) { bestDist = d; best = p; }
      }
      return best;
    });
    const unique = new Set(corners.map(c => `${c.x},${c.y}`));
    if (unique.size < 4) return null;
    return corners;
  }

  _isValidQuad(corners, w, h) {
    for (const c of corners) {
      if (c.x < -w * 0.1 || c.x > w * 1.1 || c.y < -h * 0.1 || c.y > h * 1.1) return false;
    }
    const area = this._quadArea(corners);
    const totalArea = w * h;
    return area > totalArea * 0.1 && area < totalArea * 1.2;
  }

  _quadArea(c) {
    return 0.5 * Math.abs(
      (c[0].x * c[1].y - c[1].x * c[0].y) +
      (c[1].x * c[2].y - c[2].x * c[1].y) +
      (c[2].x * c[3].y - c[3].x * c[2].y) +
      (c[3].x * c[0].y - c[0].x * c[3].y)
    );
  }

  _isStable(contour) {
    if (!this.lastContour) return false;
    let totalDist = 0;
    for (let i = 0; i < 4; i++) {
      totalDist += Math.hypot(contour[i].x - this.lastContour[i].x, contour[i].y - this.lastContour[i].y);
    }
    return totalDist < 30;
  }

  _drawContour(canvas, contour, videoW, videoH) {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scaleX = canvas.width / videoW;
    const scaleY = canvas.height / videoH;

    ctx.beginPath();
    ctx.moveTo(contour[0].x * scaleX, contour[0].y * scaleY);
    for (let i = 1; i < contour.length; i++) {
      ctx.lineTo(contour[i].x * scaleX, contour[i].y * scaleY);
    }
    ctx.closePath();

    ctx.fillStyle = 'rgba(67, 97, 238, 0.15)';
    ctx.fill();
    ctx.strokeStyle = '#4361ee';
    ctx.lineWidth = 3;
    ctx.stroke();

    for (const p of contour) {
      ctx.beginPath();
      ctx.arc(p.x * scaleX, p.y * scaleY, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#4361ee';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  _clearOverlay(canvas) {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  perspectiveTransform(sourceCanvas, contour, outputWidth, outputHeight) {
    const MAX_EDGE = 2200;
    let scale = 1;
    const longest = Math.max(outputWidth, outputHeight);
    if (longest > MAX_EDGE) {
      scale = MAX_EDGE / longest;
      outputWidth = Math.round(outputWidth * scale);
      outputHeight = Math.round(outputHeight * scale);
    }

    const dst = document.createElement('canvas');
    dst.width = outputWidth;
    dst.height = outputHeight;
    const dstCtx = dst.getContext('2d');

    const srcPts = contour;
    const dstPts = [
      { x: 0, y: 0 },
      { x: outputWidth, y: 0 },
      { x: outputWidth, y: outputHeight },
      { x: 0, y: outputHeight }
    ];

    const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const srcW = sourceCanvas.width;
    const srcH = sourceCanvas.height;
    const srcPixels = srcCtx.getImageData(0, 0, srcW, srcH).data;
    const dstImage = dstCtx.createImageData(outputWidth, outputHeight);
    const dstPixels = dstImage.data;

    const c = this._computePerspectiveCoeffs(srcPts, dstPts);
    const c0 = c[0], c1 = c[1], c2 = c[2], c3 = c[3], c4 = c[4], c5 = c[5], c6 = c[6], c7 = c[7];

    let dstIdx = 0;
    for (let y = 0; y < outputHeight; y++) {
      const c1y = c1 * y + c2;
      const c4y = c4 * y + c5;
      const c7y = c7 * y + 1;
      for (let x = 0; x < outputWidth; x++) {
        const denom = c6 * x + c7y;
        const srcX = (c0 * x + c1y) / denom;
        const srcY = (c3 * x + c4y) / denom;
        const sx = srcX | 0;
        const sy = srcY | 0;
        if (sx >= 0 && sx < srcW && sy >= 0 && sy < srcH) {
          const srcIdx = (sy * srcW + sx) << 2;
          dstPixels[dstIdx] = srcPixels[srcIdx];
          dstPixels[dstIdx + 1] = srcPixels[srcIdx + 1];
          dstPixels[dstIdx + 2] = srcPixels[srcIdx + 2];
          dstPixels[dstIdx + 3] = 255;
        }
        dstIdx += 4;
      }
    }

    dstCtx.putImageData(dstImage, 0, 0);
    return dst;
  }

  _computePerspectiveCoeffs(src, dst) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      A.push([dst[i].x, dst[i].y, 1, 0, 0, 0, -src[i].x * dst[i].x, -src[i].x * dst[i].y]);
      b.push(src[i].x);
      A.push([0, 0, 0, dst[i].x, dst[i].y, 1, -src[i].y * dst[i].x, -src[i].y * dst[i].y]);
      b.push(src[i].y);
    }
    return this._solveLinearSystem(A, b);
  }

  _solveLinearSystem(A, b) {
    const n = b.length;
    const aug = A.map((row, i) => [...row, b[i]]);

    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
      }
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

      if (Math.abs(aug[col][col]) < 1e-10) continue;

      for (let row = col + 1; row < n; row++) {
        const factor = aug[row][col] / aug[col][col];
        for (let j = col; j <= n; j++) {
          aug[row][j] -= factor * aug[col][j];
        }
      }
    }

    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = aug[i][n];
      for (let j = i + 1; j < n; j++) {
        x[i] -= aug[i][j] * x[j];
      }
      x[i] /= aug[i][i];
    }
    return x;
  }

  reset() {
    this.lastContour = null;
    this.stableCount = 0;
  }
}

window.EdgeDetector = EdgeDetector;

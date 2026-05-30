/* Shared vat-diagram renderer for the sukumo site.
 *
 * Top-down view of the vat: each of the 8 electrodes is a node (in its wire
 * colour) that grows an e-ink-style dithered "activity cloud" — dense at the
 * node, diffusing outward, denser the higher that electrode's reading. Used by
 * both sonify.html (with audio + filter-arc overlay) and the dashboard on
 * index.html. Single source of truth so the two stay in sync.
 *
 * VatCloud.create(canvas, opts) -> { setReadings, setIdle, vizLevels, relayout }
 *   opts.radiusFraction : vat radius as a fraction of canvas size (default 0.38)
 *   opts.onFrame(viz, t): called each frame before easing (host sets targets / drives audio)
 *   opts.overlay(ctx, info): called each frame after the core draw (e.g. filter arcs)
 *
 * VatCloud.fetchReadings(sheetId) -> Promise<reading|null>  (gviz CSV of the published Sheet)
 * VatCloud.VOICES / .colors / .normElec / .clamp / .ELEC_* exposed for hosts.
 */
(function (global) {
  "use strict";

  // electrode layout + wire colours (docs/HARDWARE.md ADS channel map).
  // ratio/pos are only used by sonify's audio; the diagram uses key/dir/depth/col.
  var VOICES = [
    { key: "btm_n", ratio: 1, pos: [ 0, -1, -1], dir: "N", depth: 0.32, col: "#5995bb", wire: "light blue" },
    { key: "btm_s", ratio: 2, pos: [ 0, -1,  1], dir: "S", depth: 0.32, col: "#2b4c92", wire: "blue" },
    { key: "mid_n", ratio: 3, pos: [ 0,  0, -1], dir: "N", depth: 0.62, col: "#68a768", wire: "light green" },
    { key: "mid_s", ratio: 4, pos: [ 0,  0,  1], dir: "S", depth: 0.62, col: "#327847", wire: "green" },
    { key: "sfc_w", ratio: 5, pos: [-1,  1,  0], dir: "W", depth: 1.0,  col: "#9e2422", wire: "red" },
    { key: "sfc_e", ratio: 6, pos: [ 1,  1,  0], dir: "E", depth: 1.0,  col: "#c8a200", wire: "yellow" },
    { key: "sfc_n", ratio: 8, pos: [ 0,  1, -1], dir: "N", depth: 1.0,  col: "#d24d8c", wire: "pink" },
    { key: "sfc_s", ratio: 9, pos: [ 0,  1,  1], dir: "S", depth: 1.0,  col: "#bf7127", wire: "orange" }
  ];
  var DIR_VEC = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

  var C_PAPER = "#eef1f4", C_INK = "#111111", C_INDIGO = "#1c2638", C_FAINT = "#8c95a0";

  var WR = new Float32Array(VOICES.length),
      WG = new Float32Array(VOICES.length),
      WB = new Float32Array(VOICES.length);
  VOICES.forEach(function (v, i) {
    var n = parseInt(v.col.slice(1), 16);
    WR[i] = (n >> 16) & 255; WG[i] = (n >> 8) & 255; WB[i] = n & 255;
  });

  var ELEC_MIN = -0.5, ELEC_MAX = 0.5, IDLE_LEVEL = 0.12, EASE = 0.08;
  // two-part kernel per electrode: tight CORE + wider HALO (mid-density blend)
  var SIGMA_CORE = 0.13, SIGMA_HALO = 0.40, CORE_AMP = 1.0, HALO_AMP = 0.6;
  var CLOUD_SCALE = 1.0, CLOUD_CAP = 0.72, CLOUD_FLOOR = 0.05, CLOUD_UPDATE_MS = 33;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function normElec(v) {
    if (v === null || v === undefined || isNaN(v)) return null;
    return clamp((v - ELEC_MIN) / (ELEC_MAX - ELEC_MIN), 0, 1);
  }

  // ----- data: published readings Sheet via gviz CSV -----
  function parseCSVLine(line) {
    var out = [], cur = "", inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQ) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { out.push(cur); cur = ""; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  }
  function rowToReading(header, row) {
    function col(name) {
      var idx = header.indexOf(name);
      if (idx < 0 || idx >= row.length) return null;
      var v = parseFloat(row[idx]);
      return isNaN(v) ? null : v;
    }
    var tsIdx = header.indexOf("timestamp");
    var elec = {};
    VOICES.forEach(function (v) { elec[v.key] = col(v.key); });
    return {
      timestamp_str: (tsIdx >= 0 && tsIdx < row.length) ? row[tsIdx] : "",
      electrodes: elec,
      temp: col("temperature_c"), ph: col("ph"), orp: col("orp_mv"), do: col("do_mg_l")
    };
  }
  function fetchReadings(sheetId) {
    var url = "https://docs.google.com/spreadsheets/d/" + sheetId + "/gviz/tq?tqx=out:csv";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (csv) {
        if (!csv) return null;
        var lines = csv.split(/\r?\n/).filter(function (l) { return l !== ""; });
        if (lines.length < 2) return null;
        var header = parseCSVLine(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
        return rowToReading(header, parseCSVLine(lines[lines.length - 1]));
      })
      .catch(function () { return null; });
  }

  // ----- the diagram -----
  function create(canvas, opts) {
    opts = opts || {};
    var rFrac = opts.radiusFraction || 0.38;
    var g2 = canvas.getContext("2d");
    var cssW = 360, cssH = 360, DPR = 1, center = { x: 180, y: 180 }, R = 140, elecXY = {};
    var off = document.createElement("canvas"), offctx = off.getContext("2d"), cloudImg = null;
    var gidx = null, gW = null, gThr = null, gN = 0, LV = new Float32Array(VOICES.length);
    var lastCloud = 0, startT = 0;
    var targetLevels = {}, vizLevels = {};
    VOICES.forEach(function (v) { targetLevels[v.key] = IDLE_LEVEL; vizLevels[v.key] = IDLE_LEVEL; });

    function layout() {
      var rect = canvas.getBoundingClientRect();
      cssW = Math.max(200, rect.width || 360);
      cssH = cssW;
      DPR = window.devicePixelRatio || 1;
      canvas.width = Math.round(cssW * DPR);
      canvas.height = Math.round(cssH * DPR);
      g2.setTransform(DPR, 0, 0, DPR, 0, 0);
      center = { x: cssW / 2, y: cssH / 2 };
      R = Math.min(cssW, cssH) * rFrac;
      elecXY = {};
      VOICES.forEach(function (v) {
        var d = DIR_VEC[v.dir];
        elecXY[v.key] = { x: center.x + d[0] * R * v.depth, y: center.y + d[1] * R * v.depth };
      });
      buildCloudGrid();
    }

    function buildCloudGrid() {
      off.width = cssW; off.height = cssH;
      cloudImg = offctx.createImageData(cssW, cssH);
      var sigC = R * SIGMA_CORE, twoSigC2 = 2 * sigC * sigC;
      var sigH = R * SIGMA_HALO, twoSigH2 = 2 * sigH * sigH;
      var rIn2 = (R - 1) * (R - 1);
      var pxs = [], pys = [], idxs = [];
      for (var y = 0; y < cssH; y++) {
        for (var x = 0; x < cssW; x++) {
          var dx = x - center.x, dy = y - center.y;
          if (dx * dx + dy * dy <= rIn2) { pxs.push(x); pys.push(y); idxs.push((y * cssW + x) * 4); }
        }
      }
      gN = idxs.length;
      gidx = new Int32Array(idxs);
      gThr = new Float32Array(gN);
      for (var t = 0; t < gN; t++) gThr[t] = Math.random();
      gW = VOICES.map(function (v) {
        var e = elecXY[v.key], arr = new Float32Array(gN);
        for (var i = 0; i < gN; i++) {
          var ddx = pxs[i] - e.x, ddy = pys[i] - e.y, d2 = ddx * ddx + ddy * ddy;
          arr[i] = CORE_AMP * Math.exp(-d2 / twoSigC2) + HALO_AMP * Math.exp(-d2 / twoSigH2);
        }
        return arr;
      });
    }

    function refreshCloud() {
      if (!cloudImg) return;
      var data = cloudImg.data; data.fill(0);
      var nV = VOICES.length;
      for (var k = 0; k < nV; k++) LV[k] = vizLevels[VOICES[k].key];
      for (var i = 0; i < gN; i++) {
        var sumW = 0, sumWL = 0;
        for (var k2 = 0; k2 < nV; k2++) { var w = gW[k2][i]; sumW += w; sumWL += w * LV[k2]; }
        var p = CLOUD_SCALE * sumWL * sumWL;
        if (p > CLOUD_CAP) p = CLOUD_CAP;
        if (p > CLOUD_FLOOR && p > gThr[i]) {
          var sR = 0, sG = 0, sB = 0;
          for (var k3 = 0; k3 < nV; k3++) { var w3 = gW[k3][i]; sR += w3 * WR[k3]; sG += w3 * WG[k3]; sB += w3 * WB[k3]; }
          var inv = 1 / (sumW + 1e-6), di = gidx[i];
          data[di] = sR * inv; data[di + 1] = sG * inv; data[di + 2] = sB * inv; data[di + 3] = 255;
        }
      }
      offctx.putImageData(cloudImg, 0, 0);
    }

    function drawRing(radius) {
      g2.beginPath();
      g2.arc(center.x, center.y, radius, 0, Math.PI * 2);
      g2.strokeStyle = C_FAINT; g2.lineWidth = 1;
      g2.setLineDash([2, 4]); g2.stroke(); g2.setLineDash([]);
    }
    function drawDots() {
      VOICES.forEach(function (v) {
        var e = elecXY[v.key], lvl = vizLevels[v.key];
        g2.fillStyle = v.col;
        g2.beginPath();
        g2.arc(e.x, e.y, 3.0 + lvl * 8.5, 0, Math.PI * 2);
        g2.fill();
      });
    }
    function drawLabels() {
      g2.fillStyle = C_INK;
      g2.font = "bold 12px Inconsolata, monospace";
      g2.textBaseline = "middle"; g2.textAlign = "center";
      g2.fillText("N", center.x, center.y - R - 18);
      g2.fillText("S", center.x, center.y + R + 18);
      g2.textAlign = "left"; g2.fillText("E", center.x + R + 11, center.y);
      g2.textAlign = "right"; g2.fillText("W", center.x - R - 11, center.y);
      g2.textAlign = "left";
    }
    function drawListener() {
      g2.strokeStyle = C_FAINT; g2.lineWidth = 1;
      g2.beginPath(); g2.arc(center.x, center.y, 4, 0, Math.PI * 2); g2.stroke();
      g2.fillStyle = C_FAINT;
      g2.beginPath(); g2.arc(center.x, center.y, 1.4, 0, Math.PI * 2); g2.fill();
    }

    function frame(ms) {
      if (!startT) startT = ms;
      var tSec = (ms - startT) / 1000;
      if (opts.onFrame) opts.onFrame(vizLevels, tSec);
      VOICES.forEach(function (v) { vizLevels[v.key] += (targetLevels[v.key] - vizLevels[v.key]) * EASE; });
      if (ms - lastCloud >= CLOUD_UPDATE_MS) { refreshCloud(); lastCloud = ms; }
      g2.clearRect(0, 0, cssW, cssH);
      g2.fillStyle = C_PAPER; g2.fillRect(0, 0, cssW, cssH);
      if (cloudImg) { g2.imageSmoothingEnabled = false; g2.drawImage(off, 0, 0, cssW, cssH); }
      drawRing(R * 0.32); drawRing(R * 0.62); drawRing(R);
      drawDots();
      if (opts.showListener !== false) drawListener();   // centre mark (sonify: the listener)
      drawLabels();
      if (opts.overlay) opts.overlay(g2, { center: center, R: R, cssW: cssW, cssH: cssH, vizLevels: vizLevels });
      requestAnimationFrame(frame);
    }

    function setReadings(elec) {
      VOICES.forEach(function (v) {
        var n = normElec(elec ? elec[v.key] : null);
        targetLevels[v.key] = (n === null) ? IDLE_LEVEL * 0.4 : n;
      });
    }
    function setIdle() { VOICES.forEach(function (v) { targetLevels[v.key] = IDLE_LEVEL; }); }

    var resizeTimer = null;
    window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 150); });

    // optional: clicking a node calls opts.onNodeClick(key)
    if (opts.onNodeClick) {
      canvas.style.cursor = "pointer";
      canvas.addEventListener("click", function (e) {
        var rect = canvas.getBoundingClientRect();
        var x = e.clientX - rect.left, y = e.clientY - rect.top, best = null, bestD = 20 * 20;
        VOICES.forEach(function (v) {
          var p = elecXY[v.key]; if (!p) return;
          var dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
          if (d2 < bestD) { bestD = d2; best = v.key; }
        });
        if (best) opts.onNodeClick(best);
      });
    }

    layout();
    requestAnimationFrame(frame);

    return { setReadings: setReadings, setIdle: setIdle, vizLevels: vizLevels, relayout: layout };
  }

  global.VatCloud = {
    create: create,
    fetchReadings: fetchReadings,
    VOICES: VOICES,
    colors: { paper: C_PAPER, ink: C_INK, indigo: C_INDIGO, faint: C_FAINT },
    normElec: normElec, clamp: clamp,
    ELEC_MIN: ELEC_MIN, ELEC_MAX: ELEC_MAX, IDLE_LEVEL: IDLE_LEVEL
  };
})(window);

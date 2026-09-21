/* ===========================================================
 * 零依赖 QR 编码器（byte 模式，纠错等级 L/M，版本 1-20 自动选择）
 * 对外接口：QR.matrix(text, ec) -> {size, get(r,c)}
 *          QR.svg(text, opts)   -> SVG 字符串
 *          QR.canvas(text, opts)-> HTMLCanvasElement
 * =========================================================== */
var QR = (function () {
  'use strict';

  /* ---------- GF(256) ---------- */
  var EXP = new Array(256), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    EXP[255] = EXP[0];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[(LOG[a] + LOG[b]) % 255]; }

  function rsGenPoly(n) {
    var p = [1];
    for (var i = 0; i < n; i++) {
      var q = [1, EXP[i]], r = new Array(p.length + 1).fill(0);
      for (var a = 0; a < p.length; a++) for (var b = 0; b < q.length; b++) r[a + b] ^= gmul(p[a], q[b]);
      p = r;
    }
    return p;
  }
  function rsEncode(data, ecLen) {
    var gen = rsGenPoly(ecLen);
    var res = data.concat(new Array(ecLen).fill(0));
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef !== 0) for (var j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], coef);
    }
    return res.slice(data.length);
  }

  /* ---------- 规格表 ---------- */
  // [总码字, L:[ec/块, 组1块数, 组1数据, 组2块数, 组2数据], M:[...]]
  var SPEC = {
    1: [26, [7, 1, 19, 0, 0], [10, 1, 16, 0, 0]],
    2: [44, [10, 1, 34, 0, 0], [16, 1, 28, 0, 0]],
    3: [70, [15, 1, 55, 0, 0], [26, 1, 44, 0, 0]],
    4: [100, [20, 1, 80, 0, 0], [18, 2, 32, 0, 0]],
    5: [134, [26, 1, 108, 0, 0], [24, 2, 43, 0, 0]],
    6: [172, [18, 2, 68, 0, 0], [16, 4, 27, 0, 0]],
    7: [196, [20, 2, 78, 0, 0], [18, 4, 31, 0, 0]],
    8: [242, [24, 2, 97, 0, 0], [22, 2, 38, 2, 39]],
    9: [292, [30, 2, 116, 0, 0], [22, 3, 36, 2, 37]],
    10: [346, [18, 2, 68, 2, 69], [26, 4, 43, 1, 44]],
    11: [404, [20, 4, 81, 0, 0], [30, 1, 50, 4, 51]],
    12: [466, [24, 2, 92, 2, 93], [22, 6, 36, 2, 37]],
    13: [532, [26, 4, 107, 0, 0], [22, 8, 37, 1, 38]],
    14: [581, [30, 3, 115, 1, 116], [24, 4, 40, 5, 41]],
    15: [655, [22, 5, 87, 1, 88], [24, 5, 41, 5, 42]],
    16: [733, [24, 5, 98, 1, 99], [28, 7, 45, 3, 46]],
    17: [815, [28, 1, 107, 5, 108], [28, 10, 46, 1, 47]],
    18: [901, [30, 5, 120, 1, 121], [26, 9, 43, 4, 44]],
    19: [991, [28, 3, 113, 4, 114], [26, 3, 44, 11, 45]],
    20: [1085, [28, 3, 107, 5, 108], [26, 3, 41, 13, 42]]
  };
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38],
    8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58],
    13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70], 16: [6, 26, 50, 74],
    17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86], 20: [6, 34, 62, 90]
  };
  var VER_INFO = {
    7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3, 11: 0x0bbf6, 12: 0x0c762, 13: 0x0d847,
    14: 0x0e60d, 15: 0x0f928, 16: 0x10b78, 17: 0x1145d, 18: 0x12a17, 19: 0x13532, 20: 0x149a6
  };

  /* ---------- UTF-8 字节 ---------- */
  function toBytes(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c >= 0xd800 && c <= 0xdbff) {
        var c2 = str.charCodeAt(++i), cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
  }

  /* ---------- BCH ---------- */
  function bchFormat(fmt) {
    var d = fmt << 10;
    while (bitsLen(d) - 11 >= 0) d ^= 0x537 << (bitsLen(d) - 11);
    return ((fmt << 10) | d) ^ 0x5412;
  }
  function bitsLen(v) { var n = 0; while (v !== 0) { n++; v >>>= 1; } return n; }

  /* ---------- 位缓冲 ---------- */
  function BitBuf() { this.bits = []; }
  BitBuf.prototype.put = function (val, len) { for (var i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1); };

  /* ---------- 主流程 ---------- */
  function build(text, ecLevel) {
    var bytes = toBytes(String(text));
    var ec = ecLevel === 'L' ? 0 : 1;   // 0=L, 1=M
    var version = 0, totalData = 0, i;
    for (var v = 1; v <= 20; v++) {
      var sp = SPEC[v][1 + ec];
      var td = sp[1] * sp[2] + sp[3] * sp[4];
      var cb = v <= 9 ? 8 : 16;
      if (4 + cb + bytes.length * 8 <= td * 8) { version = v; totalData = td; break; }
    }
    if (!version) throw new Error('内容过长，二维码装不下（' + bytes.length + ' 字节）');
    var spec = SPEC[version][1 + ec];
    var ecPerBlock = spec[0], g1 = spec[1], d1 = spec[2], g2 = spec[3], d2 = spec[4];
    var ccBits = version <= 9 ? 8 : 16;

    var buf = new BitBuf();
    buf.put(4, 4);                                  // byte 模式
    buf.put(bytes.length, ccBits);
    for (i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);
    var cap = totalData * 8;
    for (i = 0; i < 4 && buf.bits.length < cap; i++) buf.bits.push(0);
    while (buf.bits.length % 8 !== 0) buf.bits.push(0);
    var dataCw = [];
    for (i = 0; i < buf.bits.length; i += 8) {
      var b = 0; for (var k = 0; k < 8; k++) b = (b << 1) | buf.bits[i + k];
      dataCw.push(b);
    }
    var pad = [0xec, 0x11], pi = 0;
    while (dataCw.length < totalData) { dataCw.push(pad[pi++ % 2]); }

    /* 分块 + 纠错 */
    var blocks = [], ecBlocks = [], off = 0;
    for (i = 0; i < g1; i++) { blocks.push(dataCw.slice(off, off + d1)); off += d1; }
    for (i = 0; i < g2; i++) { blocks.push(dataCw.slice(off, off + d2)); off += d2; }
    for (i = 0; i < blocks.length; i++) ecBlocks.push(rsEncode(blocks[i], ecPerBlock));

    /* 交织 */
    var maxD = Math.max(d1, d2), final = [];
    for (i = 0; i < maxD; i++) for (var bi = 0; bi < blocks.length; bi++) if (i < blocks[bi].length) final.push(blocks[bi][i]);
    for (i = 0; i < ecPerBlock; i++) for (bi = 0; bi < ecBlocks.length; bi++) final.push(ecBlocks[bi][i]);

    /* 矩阵 */
    var size = version * 4 + 17;
    var mod = [], reserved = [];
    for (i = 0; i < size; i++) { mod.push(new Array(size).fill(0)); reserved.push(new Array(size).fill(0)); }

    function setF(r, c, v) { if (r >= 0 && r < size && c >= 0 && c < size) { mod[r][c] = v; reserved[r][c] = 1; } }
    function finder(r, c) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var v = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4) ? 1 : 0;
        setF(rr, cc, v);
      }
    }
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
    for (i = 8; i < size - 8; i++) { setF(6, i, i % 2 === 0 ? 1 : 0); setF(i, 6, i % 2 === 0 ? 1 : 0); }

    var al = ALIGN[version];
    for (i = 0; i < al.length; i++) for (var j = 0; j < al.length; j++) {
      var ar = al[i], ac = al[j];
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === size - 7) || (ar === size - 7 && ac === 6)) continue;
      for (var dr2 = -2; dr2 <= 2; dr2++) for (var dc2 = -2; dc2 <= 2; dc2++) {
        var isEdge = Math.max(Math.abs(dr2), Math.abs(dc2));
        setF(ar + dr2, ac + dc2, isEdge === 1 ? 0 : 1);
      }
    }
    // 格式信息占位（注意跳过第 6 行/列的定位时序）
    for (i = 0; i <= 8; i++) { if (i !== 6) { setF(8, i, 0); setF(i, 8, 0); } }
    for (i = 0; i < 8; i++) { setF(8, size - 1 - i, 0); setF(size - 1 - i, 8, 0); }
    setF(size - 8, 8, 1); // 固定暗模块
    if (version >= 7) {
      for (i = 0; i < 18; i++) { setF(Math.floor(i / 3), size - 11 + (i % 3), 0); setF(size - 11 + (i % 3), Math.floor(i / 3), 0); }
    }

    /* 数据填充（右下起，之字形） */
    var bitIdx = 0, totalBits = final.length * 8;
    function nextBit() { if (bitIdx >= totalBits) return 0; var bb = final[bitIdx >> 3]; var v = (bb >>> (7 - (bitIdx & 7))) & 1; bitIdx++; return v; }
    var up = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (var n = 0; n < size; n++) {
        var row = up ? size - 1 - n : n;
        for (var c2 = 0; c2 < 2; c2++) {
          var cc2 = col - c2;
          if (reserved[row][cc2]) continue;
          mod[row][cc2] = nextBit();
        }
      }
      up = !up;
    }

    /* 掩码 */
    function maskFn(m, r, c) {
      switch (m) {
        case 0: return (r + c) % 2 === 0;
        case 1: return r % 2 === 0;
        case 2: return c % 3 === 0;
        case 3: return (r + c) % 3 === 0;
        case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
        case 5: return ((r * c) % 2 + (r * c) % 3) === 0;
        case 6: return (((r * c) % 2 + (r * c) % 3) % 2) === 0;
        case 7: return (((r + c) % 2 + (r * c) % 3) % 2) === 0;
      }
      return false;
    }
    function applyMask(m) {
      for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
        if (!reserved[r][c] && maskFn(m, r, c)) mod[r][c] ^= 1;
      }
    }
    function penalty() {
      var p = 0, r, c, i2, run, dark = 0;
      // 规则1：行/列连续同色
      for (r = 0; r < size; r++) {
        run = 1;
        for (c = 1; c < size; c++) { if (mod[r][c] === mod[r][c - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; } else run = 1; }
      }
      for (c = 0; c < size; c++) {
        run = 1;
        for (r = 1; r < size; r++) { if (mod[r][c] === mod[r - 1][c]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; } else run = 1; }
      }
      // 规则2：2x2 同色
      for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
        var v = mod[r][c];
        if (v === mod[r][c + 1] && v === mod[r + 1][c] && v === mod[r + 1][c + 1]) p += 3;
      }
      // 规则3：1:1:3:1:1 模式
      var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      function match(arr, start, pat) { for (var k = 0; k < 11; k++) if (arr[start + k] !== pat[k]) return false; return true; }
      for (r = 0; r < size; r++) {
        var rowArr = mod[r];
        for (c = 0; c + 11 <= size; c++) { if (match(rowArr, c, pat1) || match(rowArr, c, pat2)) p += 40; }
      }
      for (c = 0; c < size; c++) {
        var colArr = []; for (r = 0; r < size; r++) colArr.push(mod[r][c]);
        for (r = 0; r + 11 <= size; r++) { if (match(colArr, r, pat1) || match(colArr, r, pat2)) p += 40; }
      }
      // 规则4：暗模块比例
      for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (mod[r][c]) dark++;
      var ratio = Math.abs(dark * 100 / (size * size) - 50);
      p += Math.floor(ratio / 5) * 10;
      return p;
    }
    function writeFormat(m) {
      var fmt = bchFormat(((ec === 0 ? 1 : 0) << 3) | m);
      for (var k = 0; k <= 14; k++) {
        var bit = (fmt >> k) & 1;
        // 竖直：左上角 + 左下角
        if (k < 6) setF(k, 8, bit);
        else if (k < 8) setF(k + 1, 8, bit);
        else setF(size - 15 + k, 8, bit);
        // 水平：右上角 + 左上角
        if (k < 8) setF(8, size - 1 - k, bit);
        else if (k === 8) setF(8, 7, bit);
        else setF(8, 14 - k, bit);
      }
      setF(size - 8, 8, 1);
    }
    function writeVersion() {
      if (version < 7) return;
      var bits = VER_INFO[version];
      for (var k = 0; k < 18; k++) {
        var bit = (bits >> k) & 1;
        setF(Math.floor(k / 3), size - 11 + (k % 3), bit);
        setF(size - 11 + (k % 3), Math.floor(k / 3), bit);
      }
    }

    var best = 0, bestP = Infinity;
    var saved = null;
    for (var m = 0; m < 8; m++) {
      applyMask(m); writeFormat(m); writeVersion();
      var pt = penalty();
      if (pt < bestP) { bestP = pt; best = m; saved = mod.map(function (row) { return row.slice(); }); }
      applyMask(m); // 还原
    }
    mod = saved;
    return {
      size: size, version: version, mask: best, ec: ecLevel || 'M',
      get: function (r, c) { return mod[r][c]; },
      modules: mod
    };
  }

  /* ---------- 渲染 ---------- */
  function svg(text, opts) {
    opts = opts || {};
    var m = build(text, opts.ec || 'M');
    var q = opts.quiet == null ? 2 : opts.quiet;
    var dark = opts.dark || '#000000', light = opts.light || '#ffffff';
    var n = m.size + q * 2, d = '';
    for (var r = 0; r < m.size; r++) {
      var c = 0;
      while (c < m.size) {
        if (m.get(r, c)) {
          var s = c;
          while (c < m.size && m.get(r, c)) c++;
          d += 'M' + (s + q) + ' ' + (r + q) + 'h' + (c - s) + 'v1h-' + (c - s) + 'z';
        } else c++;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges">' +
      '<rect width="' + n + '" height="' + n + '" fill="' + light + '"/>' +
      '<path d="' + d + '" fill="' + dark + '"/></svg>';
  }
  function canvas(text, opts) {
    opts = opts || {};
    var m = build(text, opts.ec || 'M');
    var q = opts.quiet == null ? 2 : opts.quiet;
    var n = m.size + q * 2, scale = opts.scale || 8;
    var cv = document.createElement('canvas');
    cv.width = cv.height = n * scale;
    var g = cv.getContext('2d');
    g.fillStyle = opts.light || '#ffffff'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = opts.dark || '#000000';
    for (var r = 0; r < m.size; r++) for (var c = 0; c < m.size; c++) if (m.get(r, c)) g.fillRect((c + q) * scale, (r + q) * scale, scale, scale);
    return cv;
  }

  return { build: build, svg: svg, canvas: canvas, toBytes: toBytes };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QR;

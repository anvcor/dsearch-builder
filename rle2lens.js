/*
  rle2lens.js — SYNOPSYS .RLE lens files to Zemax .zmx and CODE V .seq
  Part of the DSEARCH macro builder.
  Copyright (C) 2026 anvcor

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <https://www.gnu.org/licenses/>.

  Usage (browser or Node):
    const R = RLE2LENS.parse(text);            // raw RLE content
    const M = RLE2LENS.build(R, options);      // resolved, converted system + messages
    RLE2LENS.toZMX(M) / RLE2LENS.toSEQ(M)      // file text (CRLF)
*/
(function (root) {
'use strict';

const DEG = Math.PI / 180;
const NUMRE = /[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[EeDd][-+]?\d+)?/g;
const NUM1 = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][-+]?\d+)?$/;
const toNum = s => parseFloat(String(s).replace(/[Dd]/, 'E'));
const numsIn = s => (String(s).match(NUMRE) || []).map(toNum);
const isNum = s => NUM1.test(s);

// whitespace tokens, quoted strings kept whole; `end` = index just past the token in the source string
function tokens(line) {
  const out = [], re = /'([^']*)'|"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(line))) {
    if (m[3] !== undefined) out.push({ t: m[3], end: re.lastIndex });
    else out.push({ t: (m[1] !== undefined ? m[1] : m[2]).trim(), q: true, end: re.lastIndex });
  }
  return out;
}

/* General aspheric terms (manual 3.3.2.2.2). DCn / ATn lines fill these G numbers in order. */
const GMAP = {
  DC1: [1, 3, 6, 10, 16], DC2: [2, 4, 5, 7, 8, 9], DC3: [11, 12, 13, 14, 15], DC4: [18, 19, 20, 21, 22],
  AT1: [1, 2, 3, 4], AT2: [5, 6, 7, 8], AT3: [9, 10, 11, 12], AT4: [13, 14, 15, 16, 17], AT5: [18, 19, 20, 21, 22]
};
// rotationally symmetric terms: [power of r, G number]
const GSYM = [[2, 1], [4, 3], [6, 6], [8, 10], [10, 16], [12, 18], [14, 19], [16, 20], [18, 21], [20, 22]];
const GNONSYM = [2, 4, 5, 7, 8, 9, 11, 12, 13, 14, 15];

const SOLVES = new Set(['YMT', 'YPT', 'XMT', 'XPT', 'UMC', 'UPC', 'YMC', 'YPC', 'VMC', 'VPC', 'XMC', 'XPC',
  'AMY', 'APY', 'IMY', 'IPY', 'NCOP', 'NTOP']);
const SKIPLINE = new Set(['EFILE', 'CTE', 'DNDT', 'SID', 'COATING', 'TAG', 'FLAG']);
const UNSUP = new Set(['DECEN', 'AT', 'TILT', 'GLOBAL', 'GLO', 'LOCAL', 'BT', 'DCCR', 'RAO', 'EAO', 'CAI', 'EAI',
  'USS', 'XDD', 'XLD', 'DOE', 'HOE', 'GRIN', 'SPLIN', 'PRISM', 'ZERNIKE', 'ZRN', 'TORIC', 'BICONIC', 'CYL',
  'ARRAY', 'GRATING', 'AMICI', 'PECHAN', 'PENTA', 'PORRO', 'DOVE', 'RANGLE']);
const UNSUP_CN = { DECEN: '偏心', AT: '倾斜', TILT: '倾斜', GLOBAL: '全局坐标', GLO: '全局坐标', LOCAL: '局部坐标',
  BT: '倾斜', DCCR: '偏心口径', RAO: '矩形口径', EAO: '椭圆口径', CAI: '中心遮拦', EAI: '椭圆遮拦', USS: '特殊面型',
  XDD: '特殊面型系数', XLD: '特殊面型系数', DOE: '衍射面', HOE: '全息面', GRIN: '梯度折射率', SPLIN: '样条面',
  PRISM: '棱镜', ZERNIKE: 'Zernike 面', ZRN: 'Zernike 面', TORIC: '复曲面', BICONIC: '双锥面', CYL: '柱面',
  ARRAY: '阵列', GRATING: '光栅' };

const WL_LETTER = { C: 0.6562725, D: 0.5875618, E: 0.546074, F: 0.4861327, G: 0.4358343 };

function parseSurf(S, rest) {
  const tk = tokens(rest);
  for (let i = 0; i < tk.length; i++) {
    if (tk[i].q) continue;
    const w = tk[i].t.toUpperCase();
    const nx = k => (tk[i + k] && !tk[i + k].q && isNum(tk[i + k].t)) ? toNum(tk[i + k].t) : undefined;
    const take = k => { const v = []; for (let j = 1; j <= k; j++) { const x = nx(j); if (x === undefined) break; v.push(x); } i += v.length; return v; };
    if (w === 'RAD' || w === 'RD') { const v = take(1); if (v.length) S.rad = v[0]; }
    else if (w === 'CV') { const v = take(1); if (v.length) S.cv = v[0]; }
    else if (w === 'TH') { const v = take(1); if (v.length) S.th = v[0]; }
    else if (w === 'AIR') S.mat = { t: 'air' };
    else if (w === 'GLM') { const v = take(2); S.mat = { t: 'glm', nd: v[0], vd: v[1] }; }
    else if (w === 'GTB') {
      const cat = (tk[i + 1] && !tk[i + 1].q) ? tk[i + 1].t.toUpperCase() : '';
      const name = tk[i + 2] ? tk[i + 2].t.trim() : '';
      S.mat = { t: 'gtb', cat, name }; i += 2;
    }
    else if (w === 'GID') { if (tk[i + 1]) { S.gid = tk[i + 1].t.trim(); i++; } }
    else if (w === 'PIN') { const v = take(1); if (v.length) S.pin = Math.round(v[0]); }
    else if (/^N(10|[1-9])$/.test(w)) { const v = take(1); if (v.length) (S.N = S.N || [])[+w.slice(1) - 1] = v[0]; }
    else if (w === 'CC') { const v = take(1); if (v.length) S.cc = v[0]; }
    else if (GMAP[w]) {
      const v = numsIn(rest.slice(tk[i].end)); S.G = S.G || {};
      GMAP[w].forEach((g, j) => { if (j < v.length) S.G[g] = v[j]; });
      return;
    }
    else if (w === 'CAO') { const v = take(3); if (v.length) S.cao = { r: v[0], x: v[1] || 0, y: v[2] || 0 }; }
    else if (w === 'PCV' || w === 'PTH') {
      const v = take(3);
      if (v.length) S[w.toLowerCase()] = { ns: Math.round(v[0]), m: v.length > 1 ? v[1] : 1, b: v.length > 2 ? v[2] : 0 };
    }
    else if (w === 'REFLECTOR') S.refl = true;
    else if (SOLVES.has(w)) { (S.solves = S.solves || []).push(w); take(1); }
    else if (SKIPLINE.has(w)) return;
    else if (UNSUP.has(w)) { (S.unsup = S.unsup || new Set()).add(w); return; }
    else if (isNum(tk[i].t)) continue;
    else (S.unknown = S.unknown || new Set()).add(w);
  }
}

function wavlList(rest) {
  const out = [];
  for (const t of rest.trim().split(/\s+/)) {
    if (!t) continue;
    if (isNum(t)) out.push(toNum(t));
    else for (const ch of t.toUpperCase()) if (WL_LETTER[ch]) out.push(WL_LETTER[ch]);
  }
  return out;
}

/* ---------- parse: text -> raw records ---------- */
function parse(text) {
  const R = { title: '', fname: '', units: 'MM', aps: null, wap: 0, obj: null, wavl: null, wa: [], wt: [],
    corder: null, vfield: null, tco: false, afocal: false, zoom: false, surf: {}, sysFlags: [] };
  const lines = String(text).replace(/\r/g, '').split('\n');
  let vfLeft = 0;
  for (const raw of lines) {
    const t = raw.trim(); if (!t) continue;
    if (vfLeft > 0) { const v = numsIn(t); if (v.length >= 4) R.vfield.push(v.slice(0, 4)); vfLeft--; continue; }
    const first = t.split(/\s+/)[0], k = first.toUpperCase(), rest = t.slice(first.length);
    if (k === 'END') break;
    if (R.zoom) continue;                                     // zoom data block: not converted
    if (/^\d+$/.test(first)) { const n = +first; parseSurf(R.surf[n] || (R.surf[n] = { n }), rest); continue; }
    switch (k) {
      case 'ID': R.title = rest.trim(); break;
      case 'FNAME': { const m = rest.match(/'([^']*)'/); R.fname = m ? m[1].trim() : rest.trim(); break; }
      case 'WAVL': R.wavl = wavlList(rest); break;
      case 'WA1': case 'WA2': R.wa[+k[2] - 1] = numsIn(rest); break;
      case 'WT1': case 'WT2': R.wt[+k[2] - 1] = numsIn(rest); break;
      case 'CORDER': R.corder = numsIn(rest).map(Math.round); break;
      case 'APS': { const v = numsIn(rest); if (v.length) R.aps = Math.round(v[0]); break; }
      case 'WAP': { const v = numsIn(rest); R.wap = v.length ? Math.round(v[0]) : 1; break; }
      case 'UNITS': case 'UNI': R.units = (rest.trim().split(/\s+/)[0] || 'MM').toUpperCase(); break;
      case 'VFIELD': R.vfield = []; vfLeft = Math.round(numsIn(rest)[0] || 0); break;
      case 'TCO': R.tco = true; break;
      case 'AFOCAL': R.afocal = true; break;
      case 'ZFILE': R.zoom = true; break;
      default:
        if (/^OB[A-Z]$/.test(k)) { if (!R.obj) R.obj = { type: k, v: numsIn(rest) }; }
        else if (['NOSEQUENTIAL', 'EPUPIL', 'RPUPIL'].includes(k)) R.sysFlags.push(k);
    }
  }
  return R;
}

/* ---------- paraxial trace (geometric slopes; mirrors via n' = -n) ---------- */
function ptrace(sy, y1, u0) {
  const { c, t, nA, N } = sy, y = [], u = [];
  y[1] = y1; u[0] = u0;
  for (let k = 1; k < N; k++) {
    const n = nA[k - 1], n2 = nA[k];
    u[k] = (n * u[k - 1] - y[k] * c[k] * (n2 - n)) / n2;
    y[k + 1] = y[k] + t[k] * u[k];
  }
  return { y, u };
}

function vfAt(rows, h) {
  if (!rows || !rows.length) return [1, 1, 1];
  if (h <= rows[0][0]) return rows[0].slice(1, 4);
  for (let i = 1; i < rows.length; i++) {
    if (h <= rows[i][0]) {
      const a = rows[i - 1], b = rows[i], f = (h - a[0]) / ((b[0] - a[0]) || 1);
      return [1, 2, 3].map(j => a[j] + (b[j] - a[j]) * f);
    }
  }
  return rows[rows.length - 1].slice(1, 4);
}

// nd / vd from per-wavelength indices (N1..Nk follow the WAVL order)
function ndvdFromN(Nv, wl, prim) {
  if (!Nv || !wl.length) return null;
  const near = x => { let b = -1, e = 1; wl.forEach((w, i) => { const d = Math.abs(w - x); if (d < e && Nv[i] !== undefined) { e = d; b = i; } }); return e < 0.003 ? b : -1; };
  const id = near(0.5876), iF = near(0.4861), iC = near(0.6563);
  if (id >= 0 && iF >= 0 && iC >= 0 && Nv[iF] !== Nv[iC]) return { nd: Nv[id], vd: (Nv[id] - 1) / (Nv[iF] - Nv[iC]), exact: true };
  const p = Nv[prim - 1] !== undefined ? prim - 1 : Nv.findIndex(x => x !== undefined);
  if (p < 0) return null;
  let s = -1, l = -1;
  wl.forEach((w, i) => { if (Nv[i] === undefined) return; if (s < 0 || w < wl[s]) s = i; if (l < 0 || w > wl[l]) l = i; });
  const vd = (s >= 0 && l >= 0 && s !== l && Nv[s] !== Nv[l]) ? (Nv[p] - 1) / (Nv[s] - Nv[l]) : 100;
  return { nd: Nv[p], vd, exact: false };
}

const ZCAT = { S: 'SCHOTT', O: 'OHARA', H: 'HOYA', G: 'CDGM', R: 'LZOS', M: 'SUMITA', F: 'CORNING', N: 'NIKON' };
const CVCAT = { S: 'SCHOTT', O: 'OHARA', H: 'HOYA', G: 'CDGM', M: 'SUMITA', F: 'CORNING', N: 'NIKON' };
// SYNOPSYS "unusual" materials (catalog U) that exist in Zemax INFRARED / MISC and CODE V SPECIAL
const UMAT = {
  GE: { z: ['INFRARED', 'GERMANIUM'], cv: 'GERM' }, ZNSE: { z: ['INFRARED', 'ZNSE'], cv: 'ZNSE' },
  ZNS: { z: ['INFRARED', 'ZNS_BROAD'], cv: 'ZNS' }, SILICON: { z: ['INFRARED', 'SILICON'], cv: 'SILICN' },
  FUSILICA: { z: ['MISC', 'F_SILICA'], cv: 'SILICA' }, SAPPHIRE: { z: ['INFRARED', 'SAPPHIRE'] },
  CAF2: { z: ['INFRARED', 'CAF2'] }, BAF2: { z: ['INFRARED', 'BAF2'] }, MGF2: { z: ['INFRARED', 'MGF2'] },
  KRS5: { z: ['INFRARED', 'KRS5'], cv: 'KRS5' }
};
const CATCN = { S: 'Schott', O: 'Ohara', H: 'Hoya', G: '成都光明', R: 'LZOS', M: '住田', F: '康宁', N: '尼康', U: '特殊材料', C: '自定义', P: '私有目录' };

/* ---------- build: resolve the lens, place the stop, convert fields/aperture/vignetting ---------- */
function build(R, opt) {
  opt = Object.assign({ hbar: [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], zmxDesc: true, vig: true, hardCao: true, glass: 'catalog' }, opt || {});
  const msg = { err: [], warn: [], info: [] };
  const E = s => msg.err.push(s), W = s => msg.warn.push(s), I = s => msg.info.push(s);
  const M = { msg, R, opt };

  const idx = Object.keys(R.surf).map(Number).filter(n => n >= 0).sort((a, b) => a - b);
  if (!idx.length || idx[idx.length - 1] < 2) { E('没有找到面数据（面号开头的行）。'); return M; }
  const N = idx[idx.length - 1];                          // image surface
  const S = [];
  for (let n = 0; n <= N; n++) S[n] = R.surf[n] || { n, missing: true };
  for (let n = 1; n < N; n++) if (S[n].missing) W(`第 ${n} 面在文件里没有数据，按平面、零厚度、空气处理。`);
  if (!R.obj) { E('没有找到物方定义（OBA / OBB / OBD 等）。'); return M; }
  if (R.zoom) W('文件带变焦数据（ZFILE），暂不支持多重结构，只转换第 1 个变焦位置。');
  if (R.afocal) W('文件是无焦系统（AFOCAL），转换后的像方按普通有焦系统设置，需要在 Zemax / CODE V 里改成无焦模式。');
  R.sysFlags.forEach(f => W(`系统设置 ${f} 没有转换。`));

  // wavelengths
  let wl = (R.wavl && R.wavl.length) ? R.wavl.slice() : [].concat(R.wa[0] || [], R.wa[1] || []);
  if (!wl.length) { wl = [0.5875618]; W('文件里没有波长，按 d 线 0.5876 µm。'); }
  let wt = [].concat(R.wt[0] || [], R.wt[1] || []);
  wt = wl.map((_, i) => (wt[i] !== undefined && wt[i] >= 0) ? wt[i] : 1);
  let prim = (R.corder && R.corder[0]) ? R.corder[0] : (wl.length >= 2 ? 2 : 1);
  if (prim < 1 || prim > wl.length) prim = 1;
  M.wl = wl; M.wt = wt; M.prim = prim;

  // curvature / thickness, including PCV / PTH pickups
  const baseC = s => s.cv !== undefined ? s.cv : (s.rad !== undefined ? ((s.rad === 0 || Math.abs(s.rad) > 1e10) ? 0 : 1 / s.rad) : undefined);
  const c = [], t = [], cc = [], G = [];
  for (let n = 0; n <= N; n++) { c[n] = baseC(S[n]); t[n] = S[n].th; cc[n] = S[n].cc; G[n] = S[n].G ? Object.assign({}, S[n].G) : null; }
  for (let pass = 0; pass <= N + 1; pass++) {
    let changed = false;
    for (let n = 1; n <= N; n++) {
      const s = S[n];
      if (c[n] === undefined && s.pcv) {
        const src = Math.abs(s.pcv.ns), sg = Math.sign(s.pcv.ns) || 1;
        if (src <= N && c[src] !== undefined) {
          c[n] = sg * c[src] * s.pcv.m + s.pcv.b; changed = true;
          if (cc[n] === undefined && cc[src] !== undefined) cc[n] = cc[src];
          if (!G[n] && G[src]) { G[n] = {}; for (const g in G[src]) G[n][g] = sg * G[src][g]; }
        }
      }
      if (t[n] === undefined && s.pth) {
        const src = Math.abs(s.pth.ns), sg = Math.sign(s.pth.ns) || 1;
        if (src <= N && t[src] !== undefined) { t[n] = sg * t[src] * s.pth.m + s.pth.b; changed = true; }
      }
    }
    if (!changed) break;
  }
  for (let n = 0; n <= N; n++) {
    if (c[n] === undefined) { if (S[n].pcv) W(`第 ${n} 面的曲率拾取（PCV）解不出来，按平面。`); c[n] = 0; }
    if (t[n] === undefined) { if (S[n].pth) W(`第 ${n} 面的厚度拾取（PTH）解不出来，按 0。`); t[n] = 0; }
  }

  // media
  const mat = [];
  const resolveMat = (n, depth) => {
    const s = S[n];
    if (s.refl) return { t: 'refl' };
    if (s.mat && s.mat.t !== 'air') return Object.assign({ N: s.N }, s.mat);
    if (s.pin !== undefined && depth < 20 && s.pin !== n && S[s.pin]) {
      const m = resolveMat(s.pin, depth + 1);
      if (m.t === 'refl') return { t: 'air' };
      return Object.assign({}, m, { N: s.N || m.N, gid: s.gid });
    }
    // medium given only by its indices (N1 N2 … per wavelength, no catalog / model glass)
    if (s.N && s.N.some(x => x !== undefined && Math.abs(x - 1) > 1e-9) && !(s.mat && s.mat.t === 'air'))
      return { t: 'idx', N: s.N, name: s.gid || '' };
    return { t: 'air' };
  };
  for (let n = 0; n <= N; n++) mat[n] = resolveMat(n, 0);

  // index at the primary wavelength (paraxial work only)
  const nA = []; let farFromD = false;
  for (let n = 0; n <= N; n++) {
    const m = mat[n];
    if (m.t === 'air') nA[n] = 1;
    else if (m.t === 'refl') nA[n] = -(n > 0 ? nA[n - 1] : 1);
    else if (m.N && m.N[prim - 1] !== undefined) nA[n] = m.N[prim - 1];
    else if (m.t === 'glm') {
      // model glass away from the d line: two-term Cauchy through nd and nF - nC = (nd-1)/vd
      const lam = wl[prim - 1];
      if (Math.abs(lam - 0.5876) > 0.001 && lam > 0.35 && lam < 1.1 && m.vd > 0) {
        const B = ((m.nd - 1) / m.vd) / (1 / 0.4861327 ** 2 - 1 / 0.6562725 ** 2), A = m.nd - B / 0.5875618 ** 2;
        nA[n] = A + B / lam ** 2; farFromD = true;
      } else nA[n] = m.nd;
    }
    else { nA[n] = 1.5; W(`第 ${n} 面后的玻璃 ${m.name || ''} 没有折射率数据，近轴计算按 1.5。`); }
  }
  if (farFromD) I('主波长不在 d 线，模型玻璃在主波长的折射率按 nd、vd 估算（Cauchy），近轴结果与 SYNOPSYS 可能差万分之几。');
  const sy = { c, t, nA, N };

  // object
  const ov = R.obj.v, ot = R.obj.type;
  let kind, TH0 = Infinity, YP0 = 0, UPP0 = 0, YMP1 = 0, YP1 = 0, u0 = 0;
  const finU = yp1 => (yp1 - YP0) / TH0;
  if (ot === 'OBB') {
    UPP0 = ov[1]; YMP1 = ov[2]; YP1 = ov[3] || 0; kind = 'inf'; u0 = Math.tan(UPP0 * DEG);
    if (Math.abs(ov[0] || 0) > 1e-9) W(`OBB 的 UMP0 = ${ov[0]} 不为 0，仍按无限远物处理。`);
    if (!(Math.abs(UPP0) < 90)) { E('OBB 的视场角必须小于 90°，更大的视场 SYNOPSYS 要用 OBD。'); return M; }
  } else if (ot === 'OBA' || ot === 'OBF') {
    TH0 = ov[0]; YP0 = ov[1]; YMP1 = ov[2]; YP1 = ov[3] || 0; kind = 'fin'; u0 = finU(YP1);
    if (ot === 'OBF') I('OBF 按 OBA（物高）处理。');
  } else if (ot === 'OBC') {
    TH0 = ov[0]; YP0 = -TH0 * Math.tan(ov[1] * DEG); YMP1 = ov[2]; YP1 = ov[3] || 0; kind = 'fin'; u0 = finU(YP1);
    W('OBC（平面物、按角度给视场）换算成物高视场，物高 = 物距 × tan(角度)，请核对视场方向。');
  } else if (ot === 'OBD') {
    TH0 = ov[0]; UPP0 = ov[1]; YMP1 = ov[2]; YP1 = ov[3] || 0;
    if (!(TH0 >= 1e9)) { E('有限距离的 OBD（球面物）暂不支持。'); return M; }
    kind = 'infD'; u0 = Math.abs(UPP0) < 85 ? Math.tan(UPP0 * DEG) : UPP0 * DEG;
    I('OBD 的相对视场按角度等分（手册 §3.1.1），转换后的视场 = 相对视场 × 半视场角。');
  } else { E(`物方类型 ${ot} 暂不支持。`); return M; }
  if (!YMP1 || !isFinite(YMP1)) { E('物方定义里的 YMP1（第 1 面边缘光线高度）不对。'); return M; }
  if (kind === 'fin' && !(Math.abs(TH0) > 0)) { E('物距 TH0 为 0。'); return M; }

  // ---- stop ----
  const aps = R.aps == null ? 1 : R.aps;
  const stop = { surf: null, insertAfter: null, d: 0, front: 0, real: false, text: '' };
  const fmtd = v => (+(+v).toFixed(4)).toString();
  const yStopFor = (sn, yp1) => { const P = ptrace(sy, yp1, kind === 'fin' ? finU(yp1) : u0); return P.y[sn]; };
  if (R.tco) {
    stop.surf = 1; stop.text = '物方远心（TCO），光阑放在第 1 面。';
  } else if (Math.abs(aps) > 1) {
    const sn = Math.abs(aps);
    if (sn >= N) { E(`APS ${aps} 超出了面数。`); return M; }
    stop.surf = sn; stop.real = aps < 0;
    stop.text = aps < 0 ? `APS ${aps}：第 ${sn} 面是实光阑（实际光线求光瞳）。` : `APS ${aps}：光阑在第 ${sn} 面（近轴求光瞳）。`;
    // the file's YP1 is the last solved value; recompute it so the aperture is consistent with this stop
    const y0 = yStopFor(sn, 0), y1 = yStopFor(sn, 1);
    if (Math.abs(y1 - y0) > 1e-14) {
      const yp = -y0 / (y1 - y0);
      if (Math.abs(yp - YP1) > 1e-4 * Math.max(1, Math.abs(yp))) I(`按光阑面重新算的 YP1 = ${fmtd(yp)}（文件里是 ${fmtd(YP1)}）。`);
      YP1 = yp; if (kind === 'fin') u0 = finU(YP1);
    }
  } else if (aps === -1) {
    stop.surf = 1; stop.real = true; stop.text = 'APS -1：第 1 面是实光阑。';
  } else {
    const tol = 1e-9 * Math.max(1, Math.abs(YP1));
    if (Math.abs(YP1) <= tol) { stop.surf = 1; stop.text = 'APS 1 且 YP1 = 0：光阑就在第 1 面。'; }
    else {
      const P = ptrace(sy, YP1, u0), cr = [];
      for (let k = 1; k < N; k++) {
        const a = P.y[k], b = P.y[k + 1];
        if (k > 1 && Math.abs(a) <= tol) cr.push({ at: k });
        else if (a * b < 0) cr.push({ after: k, d: -a / P.u[k] });
      }
      const z0 = -YP1 / u0;                               // object-space crossing, from surface 1
      if (cr.length) {
        const f = cr[0];
        if (f.at) { stop.surf = f.at; stop.text = `APS 1，YP1 = ${fmtd(YP1)}：近轴主光线正好在第 ${f.at} 面穿过光轴，光阑放在这一面。`; }
        else {
          const tk = t[f.after];
          if (Math.abs(f.d) < 1e-7) { stop.surf = f.after; }
          else if (Math.abs(tk - f.d) < 1e-7) { stop.surf = f.after + 1; }
          else { stop.insertAfter = f.after; stop.d = f.d; }
          stop.text = `APS 1，YP1 = ${fmtd(YP1)}：近轴主光线在第 ${f.after} 面之后 ${fmtd(f.d)}（到第 ${f.after + 1} 面还有 ${fmtd(tk - f.d)}）穿过光轴，`
            + (stop.insertAfter ? '在这里插入一个光阑面。' : '光阑放在相邻的面上。');
          if (stop.insertAfter && mat[f.after].t !== 'air') W(`光阑落在第 ${f.after} 面之后的玻璃里，插入的光阑面用同一种玻璃。`);
        }
        if (cr.length > 1) I(`近轴主光线在镜头里穿过光轴 ${cr.length} 次（光阑被前后成像），取第一处；近轴光瞳对哪一处都一样。`);
      } else if (z0 < 0) {
        stop.front = -z0;
        stop.text = `APS 1，YP1 = ${fmtd(YP1)}：近轴主光线在第 1 面之前 ${fmtd(-z0)} 穿过光轴（前置光阑），在第 1 面前插入光阑面。`;
        if (kind === 'fin' && !(TH0 - stop.front > 0)) { W('前置光阑比物面还远，改为把光阑放在第 1 面。'); stop.front = 0; stop.surf = 1; }
      } else {
        stop.surf = 1;
        W(`APS 1，YP1 = ${fmtd(YP1)}：近轴主光线在镜头内没有穿过光轴（光瞳在像方），无法放置实体光阑，暂放第 1 面，光瞳位置会不对。`);
      }
    }
  }
  if (stop.real === false && stop.surf !== null && Math.abs(aps) > 1 && R.vfield && R.vfield.length) stop.real = true; // VFIELD switches on the real pupil (manual 2.6.3.1)
  if (R.wap > 0) { stop.real = true; W(`WAP ${R.wap}（广角光瞳）转成实际光线瞄准，光瞳大小随视场的变化没有转换。`); }
  M.stop = stop;

  // aperture (object-space telecentric: TCO, or a finite object whose chief ray is parallel to the axis)
  let aper;
  M.tele = !!R.tco || (kind === 'fin' && Math.abs(u0) < 1e-12);
  if (M.tele && !R.tco) I('主光线在物方平行于光轴（物方远心），孔径改用物方数值孔径。');
  if (M.tele) {
    if (kind !== 'fin') { E('物方远心（TCO）只能用于有限距离物体。'); return M; }
    const ang = Math.atan(YMP1 / Math.abs(TH0));
    aper = { type: 'NA', na: Math.sin(ang), cone: ang / DEG };
  } else if (kind === 'fin') {
    const zEP = -YP1 / u0;
    const h = isFinite(zEP) ? YMP1 * (1 + zEP / TH0) : NaN;
    if (!isFinite(h) || h === 0) { E('有限物距下算不出入瞳直径。'); return M; }
    aper = { type: 'EPD', epd: 2 * Math.abs(h) };
  } else aper = { type: 'EPD', epd: 2 * Math.abs(YMP1) };
  M.aper = aper;

  // fields (HBAR list)
  const H = [...new Set((opt.hbar || []).map(Number).filter(h => isFinite(h) && h >= 0 && h <= 1).map(h => +h.toFixed(6)))].sort((a, b) => a - b);
  if (!H.length) { E('视场列表是空的。'); return M; }
  let ftype, fv;
  if (kind === 'inf') { ftype = 'angle'; fv = H.map(h => Math.atan(h * Math.tan(UPP0 * DEG)) / DEG); }
  else if (kind === 'infD') { ftype = 'angle'; fv = H.map(h => h * UPP0); }
  else { ftype = 'objh'; fv = H.map(h => h * YP0); }
  M.fields = { H, ftype, v: fv };
  if (H.length > 12) I(`视场有 ${H.length} 个；旧版 Zemax 最多 12 个，新版没有这个限制。`);

  // vignetting
  const vf = (R.vfield || []).slice().sort((a, b) => a[0] - b[0]);
  M.vig = (opt.vig && vf.length) ? H.map(h => vfAt(vf, h)) : null;
  if (vf.length && !opt.vig) I('文件里有 VFIELD，按设置没有写渐晕系数。');
  if (M.vig && vf[0][0] > 0) W('VFIELD 第一行不是 0 视场，0 到第一行之间按第一行的值处理。');

  // ---- output surface list (stop inserted) ----
  const out = [];
  const gl = mOf => glassOut(mOf, wl, prim, opt, W);
  const mk = n => {
    const s = S[n], o = { src: n, c: c[n], t: t[n], cc: cc[n] || 0, G: G[n], mat: mat[n], cao: s.cao, refl: !!s.refl, stop: false };
    if (s.unsup) s.unsup.forEach(k => W(`第 ${n} 面有 ${k}（${UNSUP_CN[k] || '不支持的设置'}），没有转换。`));
    if (s.unknown && s.unknown.size) I(`第 ${n} 面有未识别的关键字 ${[...s.unknown].join(' ')}，已忽略。`);
    if (G[n]) {
      const ns = GNONSYM.filter(g => G[n][g]);
      if (ns.length) W(`第 ${n} 面有非旋转对称的非球面项 ${ns.map(g => 'G' + g).join(' ')}，没有转换。`);
      if (G[n][17]) I(`第 ${n} 面的 G17（公差用）忽略。`);
    }
    if (s.cao && (s.cao.x || s.cao.y)) W(`第 ${n} 面的硬口径有偏心，转换时按居中处理。`);
    o.glass = gl(o.mat);
    return o;
  };
  if (stop.front > 0) out.push({ src: null, c: 0, t: stop.front, cc: 0, G: null, mat: mat[0], refl: false, stop: true, dummy: true, glass: gl(mat[0]) });
  for (let n = 1; n < N; n++) {
    const o = mk(n);
    if (stop.surf === n) o.stop = true;
    if (stop.insertAfter === n) {
      const tk = o.t; o.t = stop.d; out.push(o);
      out.push({ src: null, c: 0, t: tk - stop.d, cc: 0, G: null, mat: mat[n], refl: false, stop: true, dummy: true, glass: gl(mat[n]) });
    } else out.push(o);
  }
  const img = mk(N); img.t = 0; img.isImage = true;
  M.surfs = out; M.image = img;
  M.objDist = kind === 'fin' ? TH0 - (stop.front || 0) : Infinity;
  if (S[0].rad !== undefined && Math.abs(S[0].rad) < 1e10 && S[0].rad !== 0 && kind === 'fin') W('物面是曲面，没有转换（按平面）。');
  M.units = R.units; M.kind = kind;
  M.title = (R.title || '').replace(/\s{2,}\d+\s*$/, '').trim() || R.fname || 'SYNOPSYS lens';   // drop the trailing log number
  M.aim = stop.real ? 2 : 0;

  // ---- paraxial summary for checking against SYNOPSYS ----
  const P1 = ptrace(sy, 1, 0), uL = P1.u[N - 1];
  M.efl = Math.abs(uL) > 1e-15 ? -1 / (nA[N - 1] * uL) : Infinity;
  const Pm = kind === 'fin' ? ptrace(sy, YMP1, YMP1 / TH0) : ptrace(sy, YMP1, 0);
  M.lImg = Math.abs(Pm.u[N - 1]) > 1e-15 ? -Pm.y[N - 1] / Pm.u[N - 1] : Infinity;   // paraxial image distance from the last surface
  M.lastTh = t[N - 1];
  const Pc = ptrace(sy, YP1, kind === 'fin' ? finU(YP1) : u0);
  M.giht = isFinite(M.lImg) ? Pc.y[N - 1] + M.lImg * Pc.u[N - 1] : NaN;
  M.YP1 = YP1; M.YMP1 = YMP1; M.UPP0 = UPP0; M.TH0 = TH0; M.YP0 = YP0;
  if (isFinite(M.lImg) && Math.abs(M.lImg - M.lastTh) > 1e-3 * Math.max(1, Math.abs(M.lImg))) I(`像面不在近轴焦点：最后一面到像面 ${fmtd(M.lastTh)}，近轴像距 ${fmtd(M.lImg)}（差 ${fmtd(M.lastTh - M.lImg)}）。`);
  const nAsp = out.filter(o => o.G && GSYM.some(([, g]) => o.G[g])).length;
  if (nAsp) I(`${nAsp} 个非球面。`);
  msg.warn = [...new Set(msg.warn)]; msg.info = [...new Set(msg.info)];
  return M;
}

function glassOut(m, wl, prim, opt, W) {
  if (m.t === 'air') return { kind: 'air' };
  if (m.t === 'refl') return { kind: 'mirror' };
  if (m.t === 'glm') {
    if (!(m.nd > 0)) { W('模型玻璃数据不全，按 1.5 / 50。'); return { kind: 'model', nd: 1.5, vd: 50 }; }
    return { kind: 'model', nd: m.nd, vd: m.vd || 50 };
  }
  const fromN = ndvdFromN(m.N, wl, prim);
  const name = (m.name || m.gid || '').trim();
  const cat = m.cat || '';
  if (m.t === 'idx') {
    W(`第 ${'?'} 种玻璃 ${name || '(无名)'} 只给了各波长折射率，改成模型玻璃 nd ${fromN.nd.toFixed(5)} / vd ${fromN.vd.toFixed(2)}${fromN.exact ? '' : '（vd 按首末波长估算）'}。`.replace(`第 ? 种`, ''));
    return { kind: 'model', nd: fromN.nd, vd: fromN.vd, name };
  }
  const um = cat === 'U' ? UMAT[name.toUpperCase().replace(/[^A-Z0-9]/g, '')] : null;
  if (opt.glass === 'model' || !name || !(ZCAT[cat] || um)) {
    if (!fromN) { W(`玻璃 ${name || '(无名)'} 没有折射率数据，按 1.5 / 50 的模型玻璃。`); return { kind: 'model', nd: 1.5, vd: 50, name }; }
    if (opt.glass !== 'model' && name) W(`玻璃 ${name}（${CATCN[cat] || cat || '未知目录'}）在 Zemax / CODE V 里没有对应目录，改成模型玻璃 nd ${fromN.nd.toFixed(5)} / vd ${fromN.vd.toFixed(2)}${fromN.exact ? '' : '（vd 按文件里的首末波长估算）'}。`);
    return { kind: 'model', nd: fromN.nd, vd: fromN.vd, name };
  }
  const g = { kind: 'cat', name, cat, nd: fromN ? fromN.nd : 1.5, vd: fromN ? fromN.vd : 50 };
  if (um) { g.zcat = um.z[0]; g.zname = um.z[1]; g.cvname = um.cv ? um.cv + '_SPECIAL' : null; }
  else { g.zcat = ZCAT[cat]; g.zname = name.replace(/\s+/g, ''); g.cvname = CVCAT[cat] ? name.replace(/[^A-Za-z0-9]/g, '').toUpperCase() + '_' + CVCAT[cat] : null; }
  if (!g.cvname) W(`玻璃 ${name} 在 CODE V 自带目录里没有对应，.seq 里改用模型玻璃 nd ${g.nd.toFixed(5)} / vd ${g.vd.toFixed(2)}。`);
  if (!fromN) W(`玻璃 ${name} 文件里没有折射率数据，近轴计算和 CODE V 的模型玻璃按 1.5 / 50。`);
  return g;
}

/* ---------- writers ---------- */
const ascii = s => String(s || '').replace(/[^\x20-\x7E]/g, '?').replace(/"/g, "'");
function zn(v) {                                        // Zemax number: up to 15 significant digits
  if (!isFinite(v)) return '0';
  if (v === 0) return '0';
  return String(+(+v).toPrecision(15));
}
function cvn(v) {                                       // CODE V number, small values as 0.xxxe-n (as CODE V writes)
  v = +v; if (!isFinite(v) || v === 0) return '0.0';
  const a = Math.abs(v);
  if (a >= 1e-4 && a < 1e6) { let s = String(+v.toPrecision(15)); if (!/[.e]/.test(s)) s += '.0'; return s; }
  let e = Math.floor(Math.log10(a)) + 1, m = v / Math.pow(10, e);
  if (Math.abs(m) >= 1) { m /= 10; e += 1; }
  return String(+m.toPrecision(12)) + 'e' + e;
}
function cvWrap(tag, vals, width) {
  width = width || 72; const out = []; let cur = tag;
  for (const v of vals) {
    if (cur.length + 1 + v.length > width && cur !== tag) { out.push(cur + '&'); cur = ' ' + v; }
    else cur += ' ' + v;
  }
  out.push(cur + ' '); return out;
}
const asphOf = o => {
  const G = o.G || {}; const a = {};
  for (const [p, g] of GSYM) a[p] = G[g] || 0;
  return a;
};
const hasAsph = a => Object.values(a).some(v => v);

function zmxFieldOrder(M) { const idx = M.fields.H.map((_, i) => i); return M.opt.zmxDesc ? idx.reverse() : idx; }

function toZMX(M) {
  const L = [], a = s => L.push(s);
  const ord = zmxFieldOrder(M), nf = ord.length, n12 = Math.max(12, nf), pad = (arr, z) => arr.concat(Array(n12 - arr.length).fill(z));
  const unit = { MM: 'MM', CM: 'CM', IN: 'IN', INCH: 'IN', INCHES: 'IN', M: 'METER', METER: 'METER', METERS: 'METER' }[M.units] || 'MM';
  const cats = [...new Set([M.image].concat(M.surfs).map(o => o.glass && o.glass.kind === 'cat' ? o.glass.zcat : null).filter(Boolean))];
  a('VERS 190513 693 1 L000001');
  a('MODE SEQ');
  a('NAME ' + ascii(M.title).slice(0, 120));
  a('NOTE 0 Converted from a SYNOPSYS RLE file by rle2lens.js (DSEARCH macro builder).');
  a('NOTE 0 Stop: ' + ascii(stopNoteEN(M)));
  a('NOTE 1 ""');
  a('PFIL 0 0 0'); a('LANG 0');
  a(`UNIT ${unit} X W X CM MR CPMM`);
  if (M.aper.type === 'NA') a(`OBNA ${zn(M.aper.na)} 0`); else a(`ENPD ${zn(M.aper.epd)}`);
  a('ENVD 20 1 0'); a('GFAC 0 0');
  a('GCAT ' + (cats.length ? cats.join(' ') : 'SCHOTT') + ' ');
  a(`RAIM 0 ${M.aim} 1 1 0 0 0 0 0 1`);
  a('PUSH 0 0 0 0 0 0'); a('SDMA 0 1 0'); a('OMMA 1 1');
  const tele = M.tele ? 1 : 0;
  a(`FTYP ${M.fields.ftype === 'angle' ? 0 : 1} ${tele} ${nf} ${M.wl.length} 0 0 0 ${nf}`);
  a('ROPD 2'); a('HYPR 0'); a('PICB 1');
  a('XFLN ' + pad(ord.map(() => '0'), '0').join(' '));
  a('YFLN ' + pad(ord.map(i => zn(M.fields.v[i])), '0').join(' '));
  a('FWGN ' + pad(ord.map(() => '1'), '0').join(' '));
  if (M.vig) {
    const f = ord.map(i => M.vig[i]);                   // [VYP, VYN, VX]
    a('VDXN ' + pad(f.map(() => '0'), '0').join(' '));
    a('VDYN ' + pad(f.map(v => zn((v[0] - v[1]) / 2)), '0').join(' '));
    a('VCXN ' + pad(f.map(v => zn(1 - v[2])), '0').join(' '));
    a('VCYN ' + pad(f.map(v => zn(1 - (v[0] + v[1]) / 2)), '0').join(' '));
    a('VANN ' + pad(f.map(() => '0'), '0').join(' '));
  } else for (const k of ['VDXN', 'VDYN', 'VCXN', 'VCYN', 'VANN']) a(k + ' ' + Array(n12).fill('0').join(' '));
  M.wl.forEach((w, i) => a(`WAVM ${i + 1} ${zn(w)} ${zn(M.wt[i])}`));
  for (let i = M.wl.length + 1; i <= 24; i++) a(`WAVM ${i} 0.55 1`);
  a(`PWAV ${M.prim}`);
  a('POLS 1 0 1 0 0 1 0'); a('GLRS 1 0');
  a('GSTD 0 100.000 100.000 100.000 100.000 100.000 100.000 0 1 1 0 0 1 1 1 1 1 1');
  a('NSCD 100 500 0 9.9999999999999995e-07 10 9.9999999999999995e-07 0 0 0 0 0 1 1000000 0 2');
  a('COFN QF "COATING.DAT" "SCATTER_PROFILE.DAT" "ABG_DATA.DAT" "PROFILE.GRD"');
  a('COFN COATING.DAT SCATTER_PROFILE.DAT ABG_DATA.DAT PROFILE.GRD');
  a('SURF 0'); a('  TYPE STANDARD'); a('  CURV 0.0 0 0 0 0 ""'); a('  HIDE 0 0 0 0 0 0 0 0 0 0'); a('  MIRR 2 0');
  a('  DISZ ' + (isFinite(M.objDist) ? zn(M.objDist) : 'INFINITY'));
  a('  DIAM 0 0 0 0 1 ""'); a('  POPS 0 0 0 0 0 0 0 0 1 1 1 1 0 0 0 0');
  const all = M.surfs.concat([M.image]);
  all.forEach((o, i) => {
    const k = i + 1, asp = asphOf(o), hi = asp[18] || asp[20];
    const ty = hasAsph(asp) ? (hi ? 'XASPHERE' : 'EVENASPH') : 'STANDARD';
    a('SURF ' + k);
    if (o.dummy) a('  COMM STOP (inserted)');
    else if (o.src != null) a(`  COMM SYNOPSYS S${o.src}`);
    a('  TYPE ' + ty);
    a(`  CURV ${zn(o.c)} 0 0 0 0 ""`);
    a('  HIDE 0 0 0 0 0 0 0 0 0 0'); a('  MIRR 2 0');
    if (o.stop) a('  STOP');
    if (ty === 'EVENASPH') [2, 4, 6, 8, 10, 12, 14, 16].forEach((p, j) => a(`  PARM ${j + 1} ${zn(asp[p])}`));
    if (ty === 'XASPHERE') {
      const ex = v => (+v).toExponential(12).toUpperCase().replace(/E([+-])(\d+)$/, (_, s, d) => 'E' + s + d.padStart(2, '0'));
      const xd = (n, v) => a(`  XDAT ${n} ${ex(v)} 0 0 1.000000000000E+00 0.000000000000E+00 0 ""`);
      xd(1, 10); xd(2, 1);
      [2, 4, 6, 8, 10, 12, 14, 16, 18, 20].forEach((p, j) => xd(j + 3, asp[p]));
    }
    a('  DISZ ' + zn(o.isImage ? 0 : o.t));
    a('  CONI ' + zn(o.cc || 0));
    const g = o.glass;
    if (g && !o.isImage) {
      if (g.kind === 'mirror') a('  GLAS MIRROR 0 0 1.5 40 0 0 0 0 0 0');
      else if (g.kind === 'model') a(`  GLAS ___BLANK 1 0 ${zn(g.nd)} ${zn(g.vd)} 0 0 0 0 0 0`);
      else if (g.kind === 'cat') a(`  GLAS ${g.zname} 0 0 ${zn(g.nd)} ${zn(g.vd)} 0 0 0 0 0 0`);
    }
    if (o.cao && M.opt.hardCao) {
      a(`  DIAM ${zn(o.cao.r)} 1 0 0 1 ""`); a(`  CLAP 0 ${zn(o.cao.r)} 0`); a(`  MEMA ${zn(o.cao.r)} 0 0 0 1 ""`);
    } else { a('  DIAM 0 0 0 0 1 ""'); a('  MEMA 0 0 0 0 1 ""'); }
    a('  POPS 0 0 0 0 0 0 0 0 1 1 1 1 0 0 0 0');
  });
  return L.join('\r\n') + '\r\n';
}

function stopNoteEN(M) {
  const s = M.stop;
  if (s.front) return `paraxial chief ray (YP1 ${(+M.YP1).toFixed(4)}) crosses the axis ${s.front.toFixed(4)} before surface 1; a stop surface was inserted there.`;
  if (s.insertAfter) return `paraxial chief ray (YP1 ${(+M.YP1).toFixed(4)}) crosses the axis ${s.d.toFixed(4)} after SYNOPSYS surface ${s.insertAfter}; a stop surface was inserted there.`;
  return `on SYNOPSYS surface ${s.surf}${s.real ? ' (real stop, ray aiming on)' : ''}.`;
}

function cvGlass(g) {
  if (!g || g.kind === 'air') return '';
  if (g.kind === 'mirror') return 'REFL';
  if (g.kind === 'cat' && g.cvname) return g.cvname;
  const nd = g.nd, vd = g.vd;
  if (nd >= 1 && nd < 2 && vd > 0 && vd < 100) {
    const xxx = Math.round((nd - 1) * 1e6), yyy = ((vd / 100).toFixed(6).split('.')[1] || '0').replace(/0+$/, '') || '0';
    return String(xxx).padStart(6, '0') + '.' + yyy;
  }
  return cvn(nd) + ':' + cvn(vd);
}

function toSEQ(M) {
  const L = [], a = s => L.push(s);
  const H = M.fields.H, nf = H.length;                  // CODE V: axis first, ascending
  const dim = { MM: 'M', CM: 'C', IN: 'I', INCH: 'I', INCHES: 'I' }[M.units] || 'M';
  a('RDM;LEN       "Converted from SYNOPSYS RLE by rle2lens.js"');
  a("TITLE '" + ascii(M.title).replace(/'/g, '').slice(0, 70) + "'");
  if (M.aper.type === 'NA') { a('NAO   ' + cvn(M.aper.na)); a('TEL'); }
  else a('EPD   ' + cvn(M.aper.epd));
  a('DIM   ' + dim);
  const ord = M.wl.map((w, i) => i).sort((x, y) => M.wl[y] - M.wl[x]);
  a('WL    ' + ord.map(i => cvn(+(M.wl[i] * 1000).toFixed(6))).join(' '));
  a('REF   ' + (ord.indexOf(M.prim - 1) + 1));
  const mx = Math.max(...M.wt), allEq = M.wt.every(w => Math.abs(w - M.wt[0]) < 1e-12);
  a('WTW   ' + ord.map(i => allEq ? '1' : String(Math.max(0, Math.round(M.wt[i] / mx * 100)))).join(' '));
  a("INI   '   '");
  const ang = M.fields.ftype === 'angle';
  L.push(...cvWrap(ang ? 'XAN  ' : 'XOB  ', H.map(() => '0.0')));
  L.push(...cvWrap(ang ? 'YAN  ' : 'YOB  ', M.fields.v.map(cvn)));
  if (ang && M.fields.v.some(v => Math.abs(v) > 90)) a('WID   Y');
  L.push(...cvWrap('WTF  ', H.map(() => '1.0')));
  if (M.vig) {
    const v = M.vig;
    L.push(...cvWrap('VUX  ', v.map(x => cvn(+(1 - x[2]).toFixed(9)))));
    L.push(...cvWrap('VLX  ', v.map(x => cvn(+(1 - x[2]).toFixed(9)))));
    L.push(...cvWrap('VUY  ', v.map(x => cvn(+(1 - x[0]).toFixed(9)))));
    L.push(...cvWrap('VLY  ', v.map(x => cvn(+(1 - x[1]).toFixed(9)))));
  }
  a('SO    0.0 ' + (isFinite(M.objDist) ? cvn(M.objDist) : '0.1e11'));
  const all = M.surfs.concat([M.image]);
  const CVLET = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J'];
  all.forEach(o => {
    const R = o.c === 0 ? 0 : 1 / o.c;
    if (o.isImage) { a('SI    ' + cvn(R) + ' 0.0'); }
    else { const g = cvGlass(o.glass); a('S     ' + cvn(R) + ' ' + cvn(o.t) + (g ? ' ' + g : '')); }
    if (o.cao && M.opt.hardCao) a('  CIR ' + cvn(o.cao.r));
    if (o.stop) a('  STO');
    const asp = asphOf(o);
    if (asp[2]) {                                        // r^2 term: ASP has none, use the odd polynomial (C1 = K, ARn = r^n)
      a('  SPS ODD 0.0'); a('  SCO K ' + cvn(o.cc || 0));
      [2, 4, 6, 8, 10, 12, 14, 16, 18, 20].forEach(p => { if (asp[p]) a(`  SCO AR${p} ${cvn(asp[p])}`); });
    } else if (hasAsph(asp)) {
      a('  ASP'); a('  K   ' + cvn(o.cc || 0)); a('  CUF 0.0');
      const co = [4, 6, 8, 10, 12, 14, 16, 18, 20].map(p => asp[p]);
      let last = -1; co.forEach((v, i) => { if (v) last = i; });
      const groups = last < 4 ? [[0, 1, 2, 3]] : [[0, 1, 2, 3], [4, 5, 6, 7], [8]];
      for (const grp of groups) a('  ' + grp.map(i => CVLET[i] + ' ' + cvn(co[i])).join('; ').replace(/^(\S) /, '$1   '));
    } else if (o.cc) { a('  CON'); a('  K   ' + cvn(o.cc)); }
  });
  a('GO');
  return L.join('\r\n') + '\r\n';
}

const api = { parse, build, toZMX, toSEQ, ptrace, numsIn, version: '1.0' };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.RLE2LENS = api;
})(typeof self !== 'undefined' ? self : this);

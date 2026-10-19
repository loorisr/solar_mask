/**
 * Outils communs aux tests de masque_solaire.html
 * ------------------------------------------------
 * Aucune dépendance externe : uniquement les modules intégrés de Node
 * (node:fs, node:http, node:path, node:child_process, node:url) + un navigateur
 * Chromium/Chrome installé sur la machine.
 *
 *  - findBrowser()        : trouve un navigateur Chromium/Chrome
 *  - makeTestPage(js)     : copie l'appli en y injectant un scénario automatique
 *  - dumpDom(page)        : exécute la page en headless, renvoie le DOM (temps virtuel)
 *  - collectResult(page)  : exécute la page ; elle renvoie son résultat en POST vers Node
 *  - buildExifApp1()      : fabrique un bloc EXIF APP1 complet (focale, GPS, cap, offset…)
 *  - SCENE_JS             : makeTestScene() : photo synthétique dessinée dans la page
 *  - CAPTURE_JS           : interception de URL.createObjectURL pour lire les exports
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DIR = path.dirname(fileURLToPath(import.meta.url));
export const APP = path.resolve(DIR, '..', 'masque_solaire.html');
export const BUILD = path.join(DIR, '.build');

export function ensureBuild(){
  if (!fs.existsSync(BUILD)) fs.mkdirSync(BUILD, { recursive: true });
  return BUILD;
}

export function findBrowser(){
  const cands = [process.env.CHROME, 'chromium', 'chromium-browser', 'google-chrome',
    'google-chrome-stable', 'microsoft-edge'].filter(Boolean);
  for (const c of cands){
    try{ execSync('command -v ' + c, { stdio: 'ignore' }); return c; }
    catch(e){ /* candidat suivant */ }
  }
  throw new Error('Aucun navigateur Chromium trouvé. Installez chromium, ou lancez avec CHROME=/chemin/vers/chromium');
}

/** Copie l'appli en injectant un script de scénario juste avant </body> */
export function makeTestPage(scenarioJs, outPath){
  const html = fs.readFileSync(APP, 'utf8');
  if (!html.includes('</body>')) throw new Error('masque_solaire.html : balise </body> introuvable');
  const inject = '<script>\n' + scenarioJs + '\n<\/script>\n';
  fs.writeFileSync(outPath, html.replace('</body>', inject + '</body>'));
  return outPath;
}

/** Options communes de Chromium en mode headless (--headless = mode moderne depuis Chrome 112) */
export function chromeArgs(extra){
  return ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars'].concat(extra || []);
}

/** Exécution avec temps virtuel : renvoie le DOM final (le scénario écrit un <div id="TESTOUT">) */
export function dumpDom(pagePath, virtualTimeMs = 15000){
  const cmd = findBrowser() + ' ' + chromeArgs().join(' ')
    + ' --virtual-time-budget=' + virtualTimeMs
    + ' --dump-dom ' + JSON.stringify('file://' + pagePath) + ' 2>/dev/null';
  return execSync(cmd, { maxBuffer: 64*1024*1024 }).toString();
}

/** Lecture du résultat écrit par la page : RESULTS={...}</div> */
export function readResults(dom){
  const m = dom.match(/RESULTS=(\{.*?\})<\/div>/s);
  return m ? JSON.parse(m[1]) : null;
}

/** Exécution sans temps virtuel : la page poste son résultat JSON sur http://127.0.0.1:port/done */
export async function collectResult(pagePath, { port = 8765, timeoutMs = 60000, size = '1500,1100' } = {}){
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok');
      if (req.url.startsWith('/done')) resolveDone(body);
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const chrome = spawn(findBrowser(), chromeArgs(['--window-size=' + size, 'file://' + pagePath]),
    { stdio: 'ignore' });
  const timeout = new Promise((r) => setTimeout(() => r(null), timeoutMs));
  const body = await Promise.race([done, timeout]);
  chrome.kill('SIGKILL');
  server.close();
  if (!body) throw new Error('La page de test n’a pas répondu (timeout de ' + timeoutMs + ' ms)');
  return JSON.parse(body);
}

/* ---------------------------------------------------------------------------
   Fabrication d'un bloc EXIF complet pour les tests (TIFF little-endian)
   --------------------------------------------------------------------------- */
export function buildExifApp1(o = {}){
  const opt = Object.assign({
    f35: 12, focal: 2.23,
    lat: 48.8530, lon: 2.3499, latRef: 'N', lonRef: 'E', alt: 35.0, gpsAcc: 10,
    heading: 290, headingRef: 'M',
    date: '2026:10:18 10:14:48', utcDate: '2026:10:18', utcTime: [8, 13, 37],
    offset: '+02:00', digitalZoom: null, orient: 1, pxW: null, pxH: null,
    make: 'TestCam', model: 'TestPhone X', lens: 'back camera 2.23mm f/1.95'
  }, o);
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
  const rat = (n, d) => Buffer.concat([u32(n), u32(d)]);
  const asc = (s) => Buffer.from(s + '\0', 'latin1');
  const dms = (deg) => {                       // degrés décimaux -> [deg, min, sec*100]
    const d = Math.floor(deg), m = Math.floor((deg - d)*60);
    const s = Math.round(((deg - d)*60 - m)*60*100);
    return [d, m, s, 100];
  };
  const la = dms(opt.lat), lo = dms(opt.lon);

  const ifd0 = [];
  ifd0.push({ tag: 0x8769, type: 4, count: 1, ptr: 'exif' });
  ifd0.push({ tag: 0x8825, type: 4, count: 1, ptr: 'gps' });
  if (opt.make) ifd0.push({ tag: 0x010F, type: 2, count: opt.make.length + 1, data: asc(opt.make) });
  if (opt.model) ifd0.push({ tag: 0x0110, type: 2, count: opt.model.length + 1, data: asc(opt.model) });
  if (opt.orient != null) ifd0.push({ tag: 0x0112, type: 3, count: 1, inline: u16(opt.orient) });

  const exif = [];
  exif.push({ tag: 0xA405, type: 3, count: 1, inline: u16(opt.f35) });
  if (opt.focal) exif.push({ tag: 0x920A, type: 5, count: 1, data: rat(Math.round(opt.focal*100), 100) });
  exif.push({ tag: 0x9003, type: 2, count: opt.date.length + 1, data: asc(opt.date) });
  if (opt.offset) exif.push({ tag: 0x9011, type: 2, count: opt.offset.length + 1, data: asc(opt.offset) });
  if (opt.digitalZoom) exif.push({ tag: 0xA404, type: 5, count: 1, data: rat(Math.round(opt.digitalZoom*100), 100) });
  if (opt.lens) exif.push({ tag: 0xA434, type: 2, count: opt.lens.length + 1, data: asc(opt.lens) });
  if (opt.pxW) exif.push({ tag: 0xA002, type: 4, count: 1, inline: u32(opt.pxW) });
  if (opt.pxH) exif.push({ tag: 0xA003, type: 4, count: 1, inline: u32(opt.pxH) });

  const gps = [];
  gps.push({ tag: 0x0001, type: 2, count: 2, inline: asc(opt.latRef) });
  gps.push({ tag: 0x0002, type: 5, count: 3, data: Buffer.concat([rat(la[0], 1), rat(la[1], 1), rat(la[2], la[3])]) });
  gps.push({ tag: 0x0003, type: 2, count: 2, inline: asc(opt.lonRef) });
  gps.push({ tag: 0x0004, type: 5, count: 3, data: Buffer.concat([rat(lo[0], 1), rat(lo[1], 1), rat(lo[2], lo[3])]) });
  if (opt.alt != null){
    gps.push({ tag: 0x0005, type: 1, count: 1, inline: Buffer.from([opt.alt < 0 ? 1 : 0]) });
    gps.push({ tag: 0x0006, type: 5, count: 1, data: rat(Math.round(Math.abs(opt.alt)*10), 10) });
  }
  if (opt.heading != null){
    gps.push({ tag: 0x0010, type: 2, count: 2, inline: asc(opt.headingRef) });
    gps.push({ tag: 0x0011, type: 5, count: 1, data: rat(Math.round(opt.heading), 1) });
  }
  if (opt.gpsAcc) gps.push({ tag: 0x001F, type: 5, count: 1, data: rat(Math.round(opt.gpsAcc), 1) });
  gps.push({ tag: 0x0007, type: 5, count: 3, data: Buffer.concat([rat(opt.utcTime[0], 1), rat(opt.utcTime[1], 1), rat(opt.utcTime[2], 1)]) });
  gps.push({ tag: 0x001D, type: 2, count: 11, data: asc(opt.utcDate) });

  // --- écriture (agencement : IFD0 à l'offset 8, puis ExifIFD, puis GPS, puis les données) ---
  const sizeOf = (entries) => 2 + entries.length*12 + 4;
  const offIfd0 = 8;
  const offExif = offIfd0 + sizeOf(ifd0);
  const offGps = offExif + sizeOf(exif);
  let offData = offGps + sizeOf(gps);
  const chunks = [];
  const place = (e) => {
    if (!e.data) return null;
    const at = offData;
    chunks.push({ at, buf: e.data });
    offData += e.data.length + (e.data.length % 2);
    return at;
  };
  const exifOffsets = exif.map(place);
  const gpsOffsets = gps.map(place);
  const ifd0Offsets = ifd0.map(place);

  const buf = Buffer.alloc(offData, 0);
  Buffer.from('II', 'latin1').copy(buf, 0);
  u16(42).copy(buf, 2);
  u32(offIfd0).copy(buf, 4);
  const writeIFD = (at, entries, offsets, ptrs) => {
    let p = at;
    u16(entries.length).copy(buf, p); p += 2;
    entries.forEach((e, i) => {
      u16(e.tag).copy(buf, p);
      u16(e.type).copy(buf, p + 2);
      u32(e.count).copy(buf, p + 4);
      if (e.ptr) u32(ptrs[e.ptr]).copy(buf, p + 8);
      else if (e.inline) e.inline.copy(buf, p + 8);
      else u32(offsets[i]).copy(buf, p + 8);
      p += 12;
    });
    u32(0).copy(buf, p);
  };
  writeIFD(offIfd0, ifd0, ifd0Offsets, { exif: offExif, gps: offGps });
  writeIFD(offExif, exif, exifOffsets, {});
  writeIFD(offGps, gps, gpsOffsets, {});
  for (const c of chunks) c.buf.copy(buf, c.at);

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), buf]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xFFE1, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** Bloc APP1 « XMP » (http://ns.adobe.com/xap/1.0/) à insérer dans un JPEG de test */
export function buildXmpApp1(xml){
  const payload = Buffer.concat([
    Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'),
    Buffer.from(xml, 'utf8')
  ]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xFFE1, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** Scène de synthèse dessinée dans la page (photo « depuis la fenêtre ») */
export const SCENE_JS = `
function makeTestScene(W, H){
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const hz = Math.round(H*0.70);
  const grad = g.createLinearGradient(0, 0, 0, hz);
  grad.addColorStop(0, '#2f6fbf'); grad.addColorStop(0.65, '#8fc0ea'); grad.addColorStop(1, '#e4eef5');
  g.fillStyle = grad; g.fillRect(0, 0, W, hz);
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.beginPath(); g.ellipse(W*0.33, H*0.15, W*0.07, H*0.043, 0, 0, 7); g.fill();
  const gg = g.createLinearGradient(0, hz, 0, H);
  gg.addColorStop(0, '#6e6a5e'); gg.addColorStop(1, '#3b382f');
  g.fillStyle = gg; g.fillRect(0, hz, W, H - hz);
  g.fillStyle = '#8d8477'; g.fillRect(W*0.05, H*0.31, W*0.24, hz - H*0.31);
  g.fillStyle = '#5b5348'; g.fillRect(W*0.04, H*0.295, W*0.26, H*0.02);
  g.fillStyle = '#4c5a66';
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++)
    g.fillRect(W*0.07 + i*W*0.055, H*0.35 + j*H*0.07, W*0.032, H*0.043);
  g.fillStyle = '#6b4f33'; g.fillRect(W*0.85, H*0.59, W*0.02, hz - H*0.59);
  g.fillStyle = '#3f5b2f';
  g.beginPath(); g.ellipse(W*0.86, H*0.52, W*0.12, H*0.18, 0, 0, 7); g.fill();
  g.strokeStyle = '#dcdcd6'; g.lineWidth = Math.round(H*0.042);
  g.strokeRect(g.lineWidth/2, g.lineWidth/2, W - g.lineWidth, H - g.lineWidth);
  return c;
}
`;

/** Code page : scène canvas -> JPEG, puis insertion du bloc EXIF après le SOI */
export const JPEG_WITH_EXIF_JS = `
async function jpegWithExif(app1B64, W, H, name){
  const c = makeTestScene(W || 800, H || 600);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  const buf = new Uint8Array(await blob.arrayBuffer());
  const app1 = Uint8Array.from(atob(app1B64), (ch) => ch.charCodeAt(0));
  const out = new Uint8Array(buf.length + app1.length);
  out.set(buf.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(buf.subarray(2), 2 + app1.length);
  return new File([out], name || 'photo_test.jpg', { type: 'image/jpeg' });
}
async function fileFromB64(b64, name, type){
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new File([u8], name, { type: type || 'image/jpeg' });
}
/** JPEG fabriqué dans la page, avec plusieurs segments (EXIF, XMP…) insérés après le SOI */
async function jpegWithSegments(segsB64, W, H, name){
  const c = makeTestScene(W || 800, H || 600);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  const buf = new Uint8Array(await blob.arrayBuffer());
  const parts = segsB64.filter(Boolean).map((b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(buf.length + total);
  out.set(buf.subarray(0, 2), 0);
  let off = 2;
  for (const p of parts){ out.set(p, off); off += p.length; }
  out.set(buf.subarray(2), off);
  return new File([out], name || 'photo_test.jpg', { type: 'image/jpeg' });
}
function canvasToJpegB64(canvas, q){
  return canvas.toDataURL('image/jpeg', q || 0.82).split(',')[1];
}
`;

/** Code page : notification du résultat au serveur Node (POST no-cors) */
export const SEND_JS = `
function sendResult(o, port){
  return fetch('http://127.0.0.1:' + (port || 8765) + '/done', {
    method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(o) });
}
`;

/** Code page : interception des exports (Blob) pour pouvoir en vérifier le contenu */
export const CAPTURE_JS = `
window.__blobs = [];
const __origCreate = URL.createObjectURL.bind(URL);
URL.createObjectURL = (b) => { window.__blobs.push(b); return __origCreate(b); };
async function lastExportText(){
  const b = window.__blobs[window.__blobs.length - 1];
  return b ? await b.text() : null;
}
function exportCount(){ return window.__blobs.length; }
`;

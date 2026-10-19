/**
 * Tests de la géométrie et de l'astronomie de masque_solaire.html
 * ------------------------------------------------------------------
 * Extrait le bloc `// ==MATH-BEGIN== … ==MATH-END==` du fichier HTML
 * (qui ne dépend d'aucun élément de page) et vérifie :
 *   - la position du soleil (algorithmes NOAA)
 *   - la projection sténopé et sa réciproque
 *   - le calibrage par la ligne d'horizon (pitch, roulis, ordre des points)
 *   - la grille de masque (angles solides, échantillonnage bilinéaire)
 *
 * Usage :  node tests/test_math.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(DIR, '..', 'masque_solaire.html');

const html = fs.readFileSync(APP, 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const mb = script.split('// ==MATH-BEGIN==')[1].split('// ==MATH-END==')[0];
const M = new Function('const DEG=Math.PI/180, R2D=180/Math.PI;\n' + mb + `
return {sunPos, pixelToAzAlt, azAltToPixel, calibFromHorizon, makeCam, focalFromHfov,
        hfovFromF35, f35FromHfov, sampleGrid, gridCellIndex, norm360, norm180, clamp,
        dayOfYear, dateFromDoy, cellSolidAngle,
        asciiToOffset, tzFromExif, orientNotApplied, opennessColor,
        skyHatchPeriod, skyHatchOn};`)();

let ok = 0, ko = 0;
function t(name, cond, info){
  if (cond){ ok++; console.log('  ok   ' + name + (info ? '   ' + info : '')); }
  else { ko++; console.log('  FAIL ' + name + '   ' + (info || '')); }
}
function near(a, b, tol){ return Math.abs(a - b) <= tol; }

console.log('\n== Astronomie (position du soleil) ==');
{
  // Paris, solstice d'été, 12 h heure standard (= 13 h légale)
  const s = M.sunPos(48.8530, 2.3499, 1, 2026, 6, 21, 12, 0);
  t('Paris 21/06 12h std : hauteur ~62.6', near(s.alt, 62.6, 0.4), 'alt=' + s.alt.toFixed(2));
  t('Paris 21/06 12h std : azimut ~153 (SE)', near(s.az, 153.4, 0.8), 'az=' + s.az.toFixed(2));

  const s2 = M.sunPos(48.8530, 2.3499, 1, 2026, 6, 21, 12, 52);   // midi solaire vrai
  t('Paris 21/06 midi solaire : hauteur ~64.6', near(s2.alt, 64.6, 0.4), 'alt=' + s2.alt.toFixed(2));
  t('Paris 21/06 midi solaire : azimut ~180', near(s2.az, 180, 1.5), 'az=' + s2.az.toFixed(2));

  const s3 = M.sunPos(48.8530, 2.3499, 1, 2026, 3, 20, 12, 52);   // équinoxe : 90 - lat
  t('Paris 20/03 midi solaire : hauteur ~41', near(s3.alt, 41.15, 0.5), 'alt=' + s3.alt.toFixed(2));

  const s4 = M.sunPos(-33.87, 151.21, 10, 2026, 6, 21, 12, 0);    // hémisphère sud
  t('Sydney 21/06 12h : hauteur ~32', near(s4.alt, 32.7, 0.6), 'alt=' + s4.alt.toFixed(2));
  const dAz = Math.min(Math.abs(s4.az), 360 - Math.abs(s4.az));
  t('Sydney 21/06 12h : soleil au nord', dAz < 15, 'az=' + s4.az.toFixed(2));

  const s5 = M.sunPos(48.8530, 2.3499, 1, 2026, 3, 20, 6, 15);    // petit matin
  t('lever 20/03 : azimut proche Est', s5.az > 80 && s5.az < 100, 'az=' + s5.az.toFixed(2));
}

console.log('\n== Projection sténopé ==');
{
  const W = 1600, H = 1200, hfov = 65;
  const f = M.focalFromHfov(hfov, W);
  t('focale px cohérente', near(2*Math.atan((W/2)/f)*180/Math.PI, hfov, 1e-9), 'f=' + f.toFixed(1));
  t('focale <-> 35mm (aller-retour)', near(M.f35FromHfov(M.hfovFromF35(26, W, H), W, H), 26, 1e-9));
  // 13 mm eq. -> diagonale 118°, soit ~106° en horizontal pour du 4:3
  t('0,5x (13mm) ~ 106° de champ', near(M.hfovFromF35(13, W, H), 106, 2), M.hfovFromF35(13, W, H).toFixed(1) + '°');
  t('2x (52mm) ~ 38° de champ', near(M.hfovFromF35(52, W, H), 38, 3), M.hfovFromF35(52, W, H).toFixed(1) + '°');

  const cam = M.makeCam({ f, cx: W/2, cy: H/2, psi: 0, pitch: 0, azCenter: 0 });
  let d = M.pixelToAzAlt(cam, W/2, H/2);
  t('centre image -> az 0 / alt 0', near(d.az, 0, 1e-6) && near(d.alt, 0, 1e-6), 'az=' + d.az + ' alt=' + d.alt);
  d = M.pixelToAzAlt(cam, W/2 + f*Math.tan(10*Math.PI/180), H/2);
  t('pixel droite 10° -> az +10 (est)', near(d.az, 10, 1e-6) && near(d.alt, 0, 1e-6), 'az=' + d.az.toFixed(4));
  d = M.pixelToAzAlt(cam, W/2, H/2 - f);
  t('pixel haut (45° de champ) -> alt +45', near(d.alt, 45, 1e-6) && near(d.az, 0, 1e-6), 'alt=' + d.alt.toFixed(4));
  d = M.pixelToAzAlt(cam, W/2 + f, H/2 - f);
  t('pixel diagonale -> az 45 / alt 35.2644', near(d.az, 45, 1e-6) && near(d.alt, 35.26439, 1e-4),
    'az=' + d.az.toFixed(3) + ' alt=' + d.alt.toFixed(3));
  const p = M.azAltToPixel(cam, 20, 15);
  d = M.pixelToAzAlt(cam, p.x, p.y);
  t('aller-retour azimut/hauteur', near(d.az, 20, 1e-6) && near(d.alt, 15, 1e-6));
  const cam2 = M.makeCam({ f, cx: W/2, cy: H/2, psi: 0, pitch: 0, azCenter: 90 });
  d = M.pixelToAzAlt(cam2, W/2, H/2);
  t('centre optique az 90 -> az 90', near(d.az, 90, 1e-6), 'az=' + d.az.toFixed(4));
  d = M.pixelToAzAlt(cam2, W/2 - f*Math.tan(10*Math.PI/180), H/2);
  t('à gauche du centre -> az 80 (nord)', near(d.az, 80, 1e-6), 'az=' + d.az.toFixed(4));
  t('direction arrière -> null', M.azAltToPixel(cam, 180, 10) === null);
}

console.log('\n== Calibrage par la ligne d\'horizon ==');
{
  const W = 1600, H = 1200, f = M.focalFromHfov(65, W), cx = W/2, cy = H/2;
  let c = M.calibFromHorizon(f, cx, cy, { x1: 100, y1: 720, x2: 1500, y2: 720 });
  t('horizon sous le centre -> pitch > 0', c.pitch > 0, 'pitch=' + (c.pitch*180/Math.PI).toFixed(2) + '°');
  t('pitch exact', near(c.pitch*180/Math.PI, Math.atan(120/f)*180/Math.PI, 1e-9));
  let cam = M.makeCam({ f, cx, cy, psi: c.psi, pitch: c.pitch, azCenter: 0 });
  t('pixel sur l\'horizon -> alt 0', near(M.pixelToAzAlt(cam, 800, 720).alt, 0, 1e-9));
  t('centre image -> alt = pitch', near(M.pixelToAzAlt(cam, cx, cy).alt, c.pitch*180/Math.PI, 1e-9));

  const hz = { x1: 300, y1: 500, x2: 1200, y2: 700 };            // horizon incliné (roulis 18,4°)
  c = M.calibFromHorizon(f, cx, cy, hz);
  cam = M.makeCam({ f, cx, cy, psi: c.psi, pitch: c.pitch, azCenter: 180 });
  t('horizon incliné : p1 -> alt 0', near(M.pixelToAzAlt(cam, hz.x1, hz.y1).alt, 0, 1e-6),
    'alt=' + M.pixelToAzAlt(cam, hz.x1, hz.y1).alt.toFixed(6));
  t('horizon incliné : p2 -> alt 0', near(M.pixelToAzAlt(cam, hz.x2, hz.y2).alt, 0, 1e-6));
  t('horizon incliné : point milieu -> alt 0', near(M.pixelToAzAlt(cam, 750, 600).alt, 0, 1e-6));
  const c2 = M.calibFromHorizon(f, cx, cy, { x1: hz.x2, y1: hz.y2, x2: hz.x1, y2: hz.y1 });
  t('ordre des points sans influence', near(c.psi, c2.psi, 1e-12) && near(c.pitch, c2.pitch, 1e-12));
  const pUp = { x: 750 + 200*Math.sin(c.psi), y: 600 - 200*Math.cos(c.psi) };
  t('perpendiculaire vers le haut -> alt > 0', M.pixelToAzAlt(cam, pUp.x, pUp.y).alt > 0,
    'alt=' + M.pixelToAzAlt(cam, pUp.x, pUp.y).alt.toFixed(2));
  const pDown = { x: 750 - 200*Math.sin(c.psi), y: 600 + 200*Math.cos(c.psi) };
  t('perpendiculaire vers le bas -> alt < 0', M.pixelToAzAlt(cam, pDown.x, pDown.y).alt < 0);
  t('azimut centre optique conservé', near(M.pixelToAzAlt(cam, cx, cy).az, 180, 1e-9));
}

console.log('\n== Grille de masque ==');
{
  // somme des angles solides du demi-ciel = 2*pi, quelle que soit la finesse
  for (const as of [1, 5, 10, 15, 30]){
    const naz = Math.round(360/as), nalt = Math.round(90/as) + 1;
    let s = 0;
    for (let il = 0; il < nalt; il++){
      const a0 = Math.max(0, il*as - as/2), a1 = Math.min(90, il*as + as/2);
      s += (Math.sin(a1*Math.PI/180) - Math.sin(a0*Math.PI/180)) * (360/naz) * Math.PI/180;
    }
    const tot = s * naz;
    t('angle solide du demi-ciel = 2π sr (pas ' + as + '°)', near(tot, 2*Math.PI, 0.01), tot.toFixed(4));
  }

  const g = { azStep: 10, altStep: 10, naz: 36, nalt: 10, openness: new Float32Array(360).fill(0.4),
              covered: new Uint8Array(360) };
  t('échantillonnage constant', near(M.sampleGrid(g, 137, 33), 0.4, 1e-6));
  g.openness[0] = 1;                                   // cellule azimut 0 / hauteur 0
  t('repli circulaire azimut 359°', near(M.sampleGrid(g, 359, 0), 0.94, 1e-6),
    M.sampleGrid(g, 359, 0).toFixed(4));
  t('cellule la plus proche (az 359 -> 0)', M.gridCellIndex(g, 359, 3) === 0, String(M.gridCellIndex(g, 359, 3)));
  t('cellule la plus proche (az 3 -> 0)', M.gridCellIndex(g, 3, 3) === 0, String(M.gridCellIndex(g, 3, 3)));
  t('hauteur bornée à 90°', M.sampleGrid(g, 45, 95) >= 0);
}

console.log('\n== Métadonnées EXIF (analyse) ==');
{
  t('décalage "+02:00" -> 2', M.asciiToOffset('+02:00') === 2);
  t('décalage "-05:30" -> -5.5', M.asciiToOffset('-05:30') === -5.5);
  t('décalage "0100" -> 1', M.asciiToOffset('0100') === 1);
  t('décalage "-0000" -> -0', Math.abs(M.asciiToOffset('-0000')) === 0);
  t('décalage illisible -> null', M.asciiToOffset('nord') === null && M.asciiToOffset('') === null
    && M.asciiToOffset(null) === null);
  t('décalage hors bornes -> null', M.asciiToOffset('+25:00') === null);

  // OffsetTimeOriginal prioritaire
  const e1 = { offset: 2, date: '2026:10:18 10:14:48',
               utc: '2026-10-18T08:13:37Z' };
  t('OffsetTime prioritaire et exact', M.tzFromExif(e1).tz === 2 && M.tzFromExif(e1).exact === true);
  // sinon : heure locale − heure UTC GPS (horloge GPS légèrement en retard -> arrondi au 1/4 h)
  const e2 = { offset: null, date: '2026:10:18 10:14:48', utc: '2026-10-18T08:13:37Z' };
  t('déduction par le GPS : +2 arrondi', M.tzFromExif(e2).tz === 2 && M.tzFromExif(e2).exact === false,
    JSON.stringify(M.tzFromExif(e2)));
  // passage de minuit : local 01:00 le 19, UTC 20:00 le 18 -> +5 h
  const e3 = { offset: null, date: '2026:06:19 01:00:00', utc: '2026-06-18T20:00:00Z' };
  t('déduction : changement de jour', M.tzFromExif(e3).tz === 5, JSON.stringify(M.tzFromExif(e3)));
  // fuseau négatif
  const e4 = { offset: null, date: '2026:01:10 07:30:00', utc: '2026-01-10T12:30:00Z' };
  t('déduction : fuseau négatif (-5)', M.tzFromExif(e4).tz === -5, JSON.stringify(M.tzFromExif(e4)));
  t('données manquantes -> null', M.tzFromExif({ offset: null }) === null
    && M.tzFromExif(null) === null);
  // décalage incohérent (GPS d'un autre jour) -> rejeté
  const e5 = { offset: null, date: '2026:01:10 07:30:00', utc: '2026-01-12T12:30:00Z' };
  t('décalage incohérent -> null', M.tzFromExif(e5) === null);

  t('orientation 6 appliquée (portrait) -> pas d\'alerte',
    M.orientNotApplied(6, 800, 600, 600, 800) === false);
  t('orientation 6 non appliquée -> alerte',
    M.orientNotApplied(6, 800, 600, 800, 600) === true);
  t('orientation 1 -> jamais d\'alerte', M.orientNotApplied(1, 800, 600, 800, 600) === false);
  t('sans dimensions EXIF -> pas d\'alerte', M.orientNotApplied(6, null, null, 800, 600) === false);
  t('image carrée -> pas d\'alerte', M.orientNotApplied(6, 800, 800, 800, 800) === false);
}

console.log('\n== Échelle de couleur du masque ==');
{
  const lum = (c) => {                       // luminance relative approximative
    const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(c);
    return 0.2126*+m[1] + 0.7152*+m[2] + 0.0722*+m[3];
  };
  const rgb = (c) => /rgb\((\d+),(\d+),(\d+)\)/.exec(c).slice(1).map(Number);
  t('extrémité 0 % = indigo sombre', M.opennessColor(0) === 'rgb(13,8,135)', M.opennessColor(0));
  t('extrémité 100 % = jaune vif', M.opennessColor(1) === 'rgb(240,249,33)', M.opennessColor(1));
  t('bornes respectées', M.opennessColor(-3) === M.opennessColor(0) && M.opennessColor(4) === M.opennessColor(1));
  let mono = true, noGreen = true, noWhite = true, dark = true, bright = true;
  let prev = -1;
  for (let k = 0; k <= 100; k++){
    const o = k/100, c = M.opennessColor(o), [r, g, b] = rgb(c), L = lum(c);
    if (L < prev - 0.5) mono = false;                 // luminosité croissante
    prev = L;
    if (g > r + 20) noGreen = false;                  // jamais franchement vert
    if (Math.max(r, g, b) - Math.min(r, g, b) < 60) noWhite = false;   // jamais proche du blanc/gris
    if (k === 0 && L > 60) dark = false;
    if (k === 100 && L < 180) bright = false;
  }
  t('luminosité croissante avec l\'ouverture', mono);
  t('aucune teinte verte', noGreen);
  t('aucune teinte blanche ou grise', noWhite);
  t('masqué bien sombre / ouvert bien clair', dark && bright);
  t('progressivité (3 paliers distincts)', new Set([0.33, 0.66, 0.99].map(M.opennessColor)).size === 3,
    ['0.33', '0.66', '0.99'].map((x) => M.opennessColor(+x)).join(' | '));
}

console.log('\n== Hachures du calque ciel ==');
{
  t('période proportionnelle à la largeur de l\'image', M.skyHatchPeriod(1600) > M.skyHatchPeriod(1200)
    && M.skyHatchPeriod(1200) > M.skyHatchPeriod(400),
    [400, 1200, 1600, 4000].map((w) => w + '→' + M.skyHatchPeriod(w) + ' px').join('  '));
  t('période jamais illisible (≥ 12 px)', [50, 100, 320].every((w) => M.skyHatchPeriod(w) >= 12),
    [50, 100, 320].map((w) => w + '→' + M.skyHatchPeriod(w)).join('  '));
  const per = 20, th = 6;
  t('direction diagonale (x + y) : (0,0) et (10,10) sur un trait, (10,0) non',
    M.skyHatchOn(0, 0, per, th) && M.skyHatchOn(10, 10, per, th) && !M.skyHatchOn(10, 0, per, th));
  t('répétition régulière : (x, y) et (x + per, y) identiques',
    [0, 3, 7, 13, 19, 23].every((x) => M.skyHatchOn(x, 5, per, th) === M.skyHatchOn(x + per, 5, per, th)));
  let on = 0, tot = 0;
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++){ tot++; if (M.skyHatchOn(x, y, per, th)) on++; }
  t('taux de couverture conforme à l\'épaisseur du trait (~30 %)',
    Math.abs(on/tot - th/per) < 0.01, (100*on/tot).toFixed(1) + ' % pour th/per = ' + (100*th/per).toFixed(0) + ' %');
  t('coordonnées négatives sans exception', typeof M.skyHatchOn(-3, -4, per, th) === 'boolean',
    String(M.skyHatchOn(-3, -4, per, th)));
}

console.log('\n== Dates ==');
{
  t('jour de l\'année 01/01', M.dayOfYear(2025, 1, 1) === 1);
  t('jour de l\'année 31/12/2025', M.dayOfYear(2025, 12, 31) === 365);
  t('jour de l\'année 31/12/2024 (bissextile)', M.dayOfYear(2024, 12, 31) === 366);
  const d = M.dateFromDoy(2025, 61);
  t('doy 61 / 2025 -> 2 mars', d.m === 3 && d.d === 2, JSON.stringify(d));
}

console.log('\n' + (ko ? 'ECHECS : ' + ko : 'tous les tests passent') + '  (' + ok + ' ok, ' + ko + ' ko)\n');
process.exit(ko ? 1 : 0);

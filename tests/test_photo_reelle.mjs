/**
 * Test sur une photo réelle (par défaut : la première trouvée dans le dossier du projet).
 * Vérifie le décodage, la lecture EXIF, la détection du ciel et le calcul du masque,
 * puis écrit dans tests/.build/ : le masque en JSON, le diagramme PNG et un aperçu de
 * la photo annotée — de quoi juger le résultat sans ouvrir l'outil.
 *
 * Usage :  node tests/test_photo_reelle.mjs [chemin/photo.jpg]
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeTestPage, collectResult, SCENE_JS, JPEG_WITH_EXIF_JS, SEND_JS, CAPTURE_JS,
         DIR, BUILD, ensureBuild } from './harness.mjs';

/* ------------------------------------------------------------------ */
/* 1. trouver la photo                                                  */
/* ------------------------------------------------------------------ */
const EXT = ['.jpg', '.jpeg', '.png', '.webp'];
let photo = process.argv[2];
if (!photo){
  photo = fs.readdirSync(path.resolve(DIR, '..'))
    .filter((f) => EXT.includes(path.extname(f).toLowerCase()))
    .map((f) => path.resolve(DIR, '..', f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}
if (!photo || !fs.existsSync(photo)){
  console.error('Aucune photo trouvée. Usage : node tests/test_photo_reelle.mjs [chemin/photo.jpg]');
  process.exit(2);
}
const name = path.basename(photo);
const b64 = fs.readFileSync(photo).toString('base64');
const mo = (fs.statSync(photo).size/1048576).toFixed(2);
console.log('\nPhoto testée : ' + photo + '  (' + mo + ' Mo)');

const PORT = 8767;
const scenario = `
${SCENE_JS}
${JPEG_WITH_EXIF_JS}
${SEND_JS}
${CAPTURE_JS}
window.alert = (m) => { window.__alert = (window.__alert || '') + m; };
window.addEventListener('error', (e) => { window.__onerror = String(e.message); });
window.addEventListener('unhandledrejection', (e) => { window.__onerror = 'rejection ' + e.reason; });
(async () => {
  const out = {};
  const probe = (fx, fy) => {
    const x = Math.round(S.W*fx), y = Math.round(S.H*fy), d = pixelToAzAlt(S.cam, x, y);
    return { x, y, az: +d.az.toFixed(1), alt: +d.alt.toFixed(1),
             auto: S.auto[y*S.W + x], open: +sampleGrid(S.grid, d.az, d.alt).toFixed(3) };
  };
  try {
    const f = await fileFromB64("${b64}", ${JSON.stringify(name)}, 'image/jpeg');
    await loadFile(f);
    out.image = { nom: ${JSON.stringify(name)}, source: [S.srcW, S.srcH], travail: [S.W, S.H] };
    out.exif = S.exif;
    out.exifInfo = document.getElementById('exifInfo').innerHTML;
    out.hints = {
      geo: document.getElementById('geoHint').innerHTML,
      tz: document.getElementById('tzHint').innerHTML.replace(/<span[^>]*>|<\\/span>/g, ''),
      az: document.getElementById('azHint').innerHTML.slice(0, 200),
      zoom: document.getElementById('zoomHint').style.display !== 'none'
    };
    out.geo = { lat: S.lat, lon: S.lon, tz: S.tz, azCentre: S.azCenter, date: S.date, heure: S.time,
      hfov: +S.hfov.toFixed(2) };
    // réglage par défaut : horizon au centre vertical -> inclinaison 0 (l'horizon réel est caché
    // par la colline sur cette photo, d'où l'hypothèse « appareil d'aplomb »)
    out.defaut = { yRelatif: +(S.hz.y1/S.H).toFixed(4), pitch: +S.cam.pitchDeg.toFixed(3),
      focale: +focalFromHfov(S.hfov, S.W).toFixed(1) };
    const sun = sunAtMarker();
    out.soleil_prise_de_vue = { az: +sun.az.toFixed(1), alt: +sun.alt.toFixed(1) };

    // calibrage : appareil supposé tenu d'aplomb (l'horizon vrai n'est pas visible sur la photo),
    // azimut repris du cap EXIF (corrigé de la déclinaison magnétique)
    S.manual = true; $('manualCalib').checked = true;
    S.manPitch = 0; S.manPsi = 0;
    $('manualRow').style.display = 'flex';
    updateCam();

    detectSky(false);
    out.part_ciel_pixels = +((S.auto.reduce((a, b) => a + b, 0))/(S.W*S.H)).toFixed(3);
    computeMask();
    out.masque = { naz: S.grid.naz, nalt: S.grid.nalt,
      couverture: +S.grid.metrics.coverage.toFixed(4),
      svf_couvert: +S.grid.metrics.svfCov.toFixed(4),
      svf_estime: +S.grid.metrics.svfEst.toFixed(4) };
    out.sondes = {
      ciel: probe(0.55, 0.12),
      colline: probe(0.12, 0.40),
      toiture: probe(0.68, 0.45),
      maison_droite: probe(0.90, 0.45),
      camionnette_blanche: probe(0.062, 0.625)
    };

    const h = computeHourly();
    const day = h.filter((x) => x.alt > 0);
    out.annee = { heures_soleil: day.length,
      ouverture_moyenne: +(day.reduce((a, x) => a + x.open, 0)/day.length).toFixed(4),
      heures_masquees: day.filter((x) => x.open < 0.5).length,
      heures_plein_soleil: day.filter((x) => x.open > 0.98).length };
    out.mois = S.monthly.map((m, i) => ({ mois: i + 1, heures_soleil: m.nSun,
      ouverture: m.nSun ? +(m.sunOpen/m.nSun).toFixed(3) : null,
      plein_soleil: m.fullSun }));

    // exports : contenu + fichiers pour inspection
    document.getElementById('btnJson').onclick();
    out.json_masque = await lastExportText();
    document.getElementById('btnCsv8760').onclick();
    const csv = await lastExportText();
    out.csv_lignes = csv.split('\\n').filter((l) => l.length).length;
    out.csv_entete = csv.split('\\n').slice(0, 5);
    drawChart();
    out.diagramme_png = chart.toDataURL('image/png').split(',')[1];
    setChartMode('photo');                       // diagramme en mode « photo dépliée »
    out.diagramme_photo_png = chart.toDataURL('image/png').split(',')[1];
    const rp = buildReproj(chart.width - 80, chart.height - 70);
    const rc = rp.getContext('2d');
    const px = (az, alt) => Array.from(rc.getImageData(
      Math.min(rp.width - 1, Math.round(az/360*rp.width)),
      Math.min(rp.height - 1, Math.round((90 - alt)/90*rp.height)), 1, 1).data.slice(0, 3));
    out.reproj = { colline: px(245, 8), ciel: px(300, 35), toiture: px(317, 5), hors_photo: px(60, 60) };
    setChartMode('mask');
    const pc = document.createElement('canvas');            // aperçu allégé de la photo annotée
    pc.width = 1200; pc.height = Math.round(1200*S.H/S.W);
    pc.getContext('2d').drawImage(view, 0, 0, pc.width, pc.height);
    out.apercu_jpg = canvasToJpegB64(pc, 0.82);
  } catch (e) {
    out.exception = e.message + ' @ ' + (e.stack || '').split('\\n')[1];
  }
  out.alert = window.__alert || null;
  out.onerror = window.__onerror || null;
  await sendResult(out, ${PORT});
})();
`;

ensureBuild();
const page = makeTestPage(scenario, path.join(BUILD, 'test_photo_reelle.html'));
const r = await collectResult(page, { port: PORT, timeoutMs: 90000 });

/* ------------------------------------------------------------------ */
/* 2. rapport                                                           */
/* ------------------------------------------------------------------ */
console.log('\n--- EXIF lues ---');
console.log(JSON.stringify(r.exif, null, 1));
console.log('\n' + String(r.exifInfo).replace(/<[^>]*>/g, ''));
console.log('coord. utilisées : ' + JSON.stringify(r.geo));
console.log('soleil à l\'heure de prise de vue : ' + JSON.stringify(r.soleil_prise_de_vue));

/* ------------------------------------------------------------------ */
/* 3. fichiers de sortie                                                */
/* ------------------------------------------------------------------ */
const base = path.join(BUILD, path.basename(name, path.extname(name)));
if (r.json_masque) fs.writeFileSync(base + '_masque.json', r.json_masque);
if (r.diagramme_png) fs.writeFileSync(base + '_diagramme.png', Buffer.from(r.diagramme_png, 'base64'));
if (r.apercu_jpg) fs.writeFileSync(base + '_photo_annotee.jpg', Buffer.from(r.apercu_jpg, 'base64'));
if (r.diagramme_photo_png) fs.writeFileSync(base + '_diagramme_photo.png', Buffer.from(r.diagramme_photo_png, 'base64'));
for (const f of ['_masque.json', '_diagramme.png', '_diagramme_photo.png', '_photo_annotee.jpg'])
  if (fs.existsSync(base + f)) console.log('écrit : ' + base + f);
if (!r.exception && r.mois){
  console.log('\n--- masque obtenu ---');
  console.log('couverture du demi-ciel : ' + (r.masque.couverture*100).toFixed(1) + ' %   SVF zone couverte : '
    + (r.masque.svf_couvert*100).toFixed(1) + ' %   SVF estimé : ' + (r.masque.svf_estime*100).toFixed(1) + ' %');
  console.log('heures de soleil : ' + r.annee.heures_soleil + '   ouverture moyenne : '
    + (r.annee.ouverture_moyenne*100).toFixed(1) + ' %   heures masquées (>50%) : ' + r.annee.heures_masquees);
  const noms = ['janv','févr','mars','avr','mai','juin','juil','août','sept','oct','nov','déc'];
  console.log('mois   heures_soleil  ouverture  plein_soleil');
  r.mois.forEach((m, i) => console.log(String(i + 1).padStart(2) + ' ' + noms[i].padEnd(7)
    + String(m.heures_soleil).padStart(4) + '        '
    + (m.ouverture === null ? '  –  ' : (m.ouverture*100).toFixed(1) + ' %').padStart(7) + '      ' + m.plein_soleil));
}

/* ------------------------------------------------------------------ */
/* 4. assertions                                                        */
/* ------------------------------------------------------------------ */
let ko = 0;
const t = (n, c, i) => {
  console.log((c ? '  ok   ' : '  FAIL ') + n + (i ? '   ' + i : ''));
  if (!c) ko++;
};
console.log('\n== Photo réelle : ' + name + ' ==');
t('pas d\'exception', !r.exception, r.exception || '');
t('aucune alerte ni erreur', !r.alert && !r.onerror, (r.alert || '') + (r.onerror || ''));
t('image décodée', r.image.source[0] > 0 && r.image.source[1] > 0, JSON.stringify(r.image));
t('EXIF exploitable (focale lue)', typeof r.exif.f35 === 'number', 'f35=' + r.exif.f35);
t('GPS lu', r.exif.lat !== null && r.exif.lon !== null, r.exif.lat + ', ' + r.exif.lon);
t('décalage horaire lu', r.exif.offset !== null, 'offset=' + r.exif.offset);
t('date de prise de vue lue', !!r.exif.date, String(r.exif.date));
t('appareil identifié', !!r.exif.model, [r.exif.make, r.exif.model].filter(Boolean).join(' '));
t('horizon par défaut au centre vertical (50 %)', Math.abs(r.defaut.yRelatif - 0.5) < 1e-6, String(r.defaut.yRelatif));
t('inclinaison par défaut = 0°', Math.abs(r.defaut.pitch) < 1e-9, String(r.defaut.pitch));
t('ciel détecté (20-70 % des pixels)', r.part_ciel_pixels > 0.2 && r.part_ciel_pixels < 0.7, String(r.part_ciel_pixels));
t('couverture du demi-ciel plausible (5-40 %)', r.masque.couverture > 0.05 && r.masque.couverture < 0.4,
  (r.masque.couverture*100).toFixed(1) + ' %');
t('SVF de la zone couverte plausible (0,3-0,95)', r.masque.svf_couvert > 0.3 && r.masque.svf_couvert < 0.95,
  (r.masque.svf_couvert*100).toFixed(1) + ' %');
t('ciel du haut de l\'image classé ciel', r.sondes.ciel.auto === 1 && r.sondes.ciel.open > 0.8,
  JSON.stringify(r.sondes.ciel));
t('colline boisée classée obstacle', r.sondes.colline.auto === 0 && r.sondes.colline.open < 0.3,
  JSON.stringify(r.sondes.colline));
t('toiture grise classée obstacle', r.sondes.toiture.auto === 0 && r.sondes.toiture.open < 0.3,
  JSON.stringify(r.sondes.toiture));
t('maison de droite classée obstacle', r.sondes.maison_droite.auto === 0 && r.sondes.maison_droite.open < 0.3,
  JSON.stringify(r.sondes.maison_droite));
t('camionnette blanche NON prise pour du ciel (connexité)',
  r.sondes.camionnette_blanche.auto === 0, JSON.stringify(r.sondes.camionnette_blanche));
t('8760 + 5 lignes de sortie horaire', r.csv_lignes === 8765, String(r.csv_lignes));
t('en-tête horaire datée par l\'EXIF', /prise de vue/.test(r.csv_entete.join(' ')), '');
t('JSON : masque 19 x 72', (() => { try { const j = JSON.parse(r.json_masque);
  return j.mask.openness_pct.length === 19 && j.mask.openness_pct[0].length === 72; } catch (e) { return false; } })());
t('diagramme et aperçu produits', r.diagramme_png.length > 5000 && r.apercu_jpg.length > 5000,
  'png=' + Math.round(r.diagramme_png.length/1024) + ' Ko, jpg=' + Math.round(r.apercu_jpg.length/1024) + ' Ko');
t('12 mois de statistiques', Array.isArray(r.mois) && r.mois.length === 12);
t('diagramme mode photo : produit', r.diagramme_photo_png.length > 5000,
  Math.round(r.diagramme_photo_png.length/1024) + ' Ko');
t('diagramme mode photo : colline -> couleur sombre/verte de la photo', (() => {
  const [R, G, B] = r.reproj.colline; return G >= R && B < R + 40 && R < 150;
})(), JSON.stringify(r.reproj.colline));
t('diagramme mode photo : ciel -> bleu-gris clair', (() => {
  const [R, G, B] = r.reproj.ciel; return B > R && R > 120;
})(), JSON.stringify(r.reproj.ciel));
t('diagramme mode photo : directions hors photo -> fond sombre', (() => {
  const [R, G, B] = r.reproj.hors_photo; return R < 60 && G < 60 && B < 70;
})(), JSON.stringify(r.reproj.hors_photo));
console.log('\n' + (ko ? 'ECHECS : ' + ko : 'tous les tests sur photo réelle passent') + '\n');
process.exit(ko ? 1 : 0);

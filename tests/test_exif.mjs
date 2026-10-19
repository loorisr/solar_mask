/**
 * Test du chemin « vrai fichier JPEG » : décodage, lecture EXIF complète
 * (focale 35 mm, GPS + altitude + précision, cap boussole, décalage horaire,
 * zoom numérique, objectif, contrôle d'orientation) et contenu des exports.
 * Le JPEG est fabriqué dans la page (canvas -> JPEG) puis complété par un bloc
 * EXIF construit côté Node : aucun fichier ni bibliothèque externe nécessaire.
 *
 * Usage :  node tests/test_exif.mjs
 */
import path from 'node:path';
import { makeTestPage, collectResult, buildExifApp1, buildXmpApp1, SCENE_JS, JPEG_WITH_EXIF_JS,
         SEND_JS, CAPTURE_JS, BUILD, ensureBuild } from './harness.mjs';

const PORT = 8766;

// --- deux jeux de métadonnées : complet, puis avec zoom numérique et sans OffsetTime ---
const exifFull = buildExifApp1({
  f35: 12, focal: 2.23, lat: 48.8530, lon: 2.3499, latRef: 'N', lonRef: 'E',
  alt: 35.0, gpsAcc: 10, heading: 290, headingRef: 'M',
  date: '2026:10:18 10:14:48', utcDate: '2026:10:18', utcTime: [8, 13, 37],
  offset: '+02:00', make: 'Google', model: 'Pixel 8 Pro',
  lens: 'Pixel 8 Pro back camera 2.23mm f/1.95'
});
const exifZoom = buildExifApp1({
  f35: 12, lat: 48.8530, lon: 2.3499, offset: null, digitalZoom: 2,
  date: '2026:10:18 14:12:00', utcDate: '2026:10:18', utcTime: [12, 12, 0],
  heading: null, alt: null, gpsAcc: null, make: 'TestCam', model: 'ZoomPhone', lens: 'wide'
});

/* --- XMP de test : photosphère GPano (panorama recadré) et drone DJI --- */
const xmpPano = buildXmpApp1(
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
  + '  <rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/">\n'
  + '   <GPano:ProjectionType>equirectangular</GPano:ProjectionType>\n'
  + '   <GPano:UsePanoramaViewer>True</GPano:UsePanoramaViewer>\n'
  + '   <GPano:PoseHeadingDegrees>225.0</GPano:PoseHeadingDegrees>\n'
  + '   <GPano:PosePitchDegrees>0.0</GPano:PosePitchDegrees>\n'
  + '   <GPano:PoseRollDegrees>0.0</GPano:PoseRollDegrees>\n'
  + '   <GPano:CroppedAreaImageWidthPixels>800</GPano:CroppedAreaImageWidthPixels>\n'
  + '   <GPano:CroppedAreaImageHeightPixels>600</GPano:CroppedAreaImageHeightPixels>\n'
  + '   <GPano:FullPanoWidthPixels>1200</GPano:FullPanoWidthPixels>\n'
  + '   <GPano:FullPanoHeightPixels>600</GPano:FullPanoHeightPixels>\n'
  + '   <GPano:CroppedAreaLeftPixels>200</GPano:CroppedAreaLeftPixels>\n'
  + '   <GPano:CroppedAreaTopPixels>0</GPano:CroppedAreaTopPixels>\n'
  + '  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>');
const xmpDji = buildXmpApp1(
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
  + '  <rdf:Description rdf:about="" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/">\n'
  + '   <drone-dji:GimbalYawDegree>137.4</drone-dji:GimbalYawDegree>\n'
  + '   <drone-dji:GimbalPitchDegree>-12.5</drone-dji:GimbalPitchDegree>\n'
  + '   <drone-dji:GimbalRollDegree>1.5</drone-dji:GimbalRollDegree>\n'
  + '   <drone-dji:FlightYawDegree>140.0</drone-dji:FlightYawDegree>\n'
  + '  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>');

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
  try {
    // ---------- 1. JPEG + EXIF complet ----------
    const f1 = await jpegWithExif("${exifFull.toString('base64')}", 800, 600, 'photo_exif.jpg');
    await loadFile(f1);
    out.src = [S.srcW, S.srcH];
    out.exif = S.exif;
    out.hfov = +S.hfov.toFixed(2);
    out.hfov_attendu = +hfovFromF35(12, S.srcW, S.srcH).toFixed(2);
    out.lat = S.lat; out.lon = S.lon; out.tz = S.tz;
    out.date = S.date; out.time = S.time; out.az = S.azCenter;
    out.exifInfo = document.getElementById('exifInfo').innerHTML;
    out.geoHint = document.getElementById('geoHint').innerHTML;
    out.tzHint = document.getElementById('tzHint').innerHTML;
    out.azHint = document.getElementById('azHint').innerHTML;
    out.zoomHint_visible = document.getElementById('zoomHint').style.display !== 'none';
    const sun = sunAtMarker();
    out.soleil = { az: +sun.az.toFixed(1), alt: +sun.alt.toFixed(1) };
    // coordonnées de test (Paris), 18/10/2026 10:14 (UTC+2)
    out.soleil_attendu = (() => { const s = sunPos(48.8530, 2.3499, 2, 2026, 10, 18, 10, 14);
      return { az: +s.az.toFixed(1), alt: +s.alt.toFixed(1) }; })();

    // correction « heure d'été » proposée par l'indice
    document.getElementById('tzFix').onclick();
    out.tz_apres_correction = S.tz;
    out.dst_apres_correction = S.dst;

    // ---------- 2. masque + exports, contenu vérifié ----------
    S.hz = { x1: S.W*0.05, y1: S.H*0.62, x2: S.W*0.95, y2: S.H*0.62 };
    S.manual = false; updateCam();
    S.border = 2; detectSky(false); computeMask();
    out.masque = { naz: S.grid.naz, nalt: S.grid.nalt,
      svf: +S.grid.metrics.svfEst.toFixed(3), couverture: +S.grid.metrics.coverage.toFixed(3) };
    document.getElementById('btnJson').onclick();
    const js = JSON.parse(await lastExportText());
    out.json = {
      exif_gps: js.exif && js.exif.gps, cap: js.exif && js.exif.camera_heading_deg,
      offset: js.exif && js.exif.offset_time_original_h,
      lignes: js.mask.openness_pct.length, colonnes: js.mask.openness_pct[0].length,
      version: js.version
    };
    document.getElementById('btnCsv8760').onclick();
    const csv = await lastExportText();
    const lignesCsv = csv.split('\\n').filter((l) => l.length);
    out.csv8760 = { total: lignesCsv.length, entetes: lignesCsv.filter((l) => l[0] === '!').length,
      premiere: lignesCsv.filter((l) => l[0] !== '!')[0], derniere: lignesCsv[lignesCsv.length - 1],
      rowsToSkip: (document.getElementById('epSnippet').value.match(/(\\d+),\\s*!- Rows to Skip at Top/) || [])[1] };

    // ---------- 3. zoom numérique + décalage horaire déduit du GPS ----------
    const f2 = await jpegWithExif("${exifZoom.toString('base64')}", 800, 600, 'photo_zoom.jpg');
    await loadFile(f2);
    out.zoom_hint_visible = document.getElementById('zoomHint').style.display !== 'none';
    out.tz_estime = S.tz;
    out.tz_hint_estime = /estim/.test(document.getElementById('tzHint').innerHTML);
    out.hfov_avant_zoom = +S.hfov.toFixed(2);
    document.getElementById('zoomFix').onclick();
    out.hfov_apres_zoom = +S.hfov.toFixed(2);
    out.hfov_zoom_attendu = +(2*Math.atan(Math.tan(out.hfov_avant_zoom*Math.PI/360)/2)*180/Math.PI).toFixed(2);
    out.cap_absent = document.getElementById('azHint').style.display === 'none';

    // ---------- 4. XMP : photosphère GPano (bascule automatique) ----------
    const fp = await jpegWithSegments(["${exifFull.toString('base64')}", "${xmpPano.toString('base64')}"],
      800, 600, 'photosphere.jpg');
    await loadFile(fp);
    out.pano = {
      projection: S.proj, azSpan: S.azSpan, altTop: S.altTop, altBottom: S.altBottom,
      azLeft: +S.cam.azLeft.toFixed(2), azCenter: S.azCenter,
      hint: /Photosphère détectée/.test(document.getElementById('projHint').innerHTML),
      hintTexte: document.getElementById('projHint').textContent.slice(0, 120),
      azHint: document.getElementById('azHint').innerHTML.slice(0, 160),
      direction: (() => { const d = pixelToAzAlt(S.cam, S.W*0.5, S.H*0.25);
        return { az: +d.az.toFixed(1), alt: +d.alt.toFixed(1) }; })(),
      horizonMasque: document.getElementById('btnHorizReset').style.display === 'none'
    };
    S.border = 0; detectSky(false); computeMask();
    out.pano.couverture = +S.grid.metrics.coverage.toFixed(3);

    // retour au rectiligne pour la suite
    setProjection('rect'); setAz(180);

    // ---------- 5. XMP : drone DJI (proposition d'inclinaison) ----------
    const fd = await jpegWithSegments(["${exifFull.toString('base64')}", "${xmpDji.toString('base64')}"],
      800, 600, 'drone.jpg');
    await loadFile(fd);
    out.dji = {
      projection: S.proj, az: S.azCenter,
      hintVisible: document.getElementById('poseHint').style.display !== 'none',
      hint: document.getElementById('poseHint').textContent.slice(0, 130),
      pitchAvant: S.manPitch, manuelAvant: S.manual
    };
    document.getElementById('poseFix').onclick();
    out.dji.pitchApres = S.manPitch;
    out.dji.rollApres = S.manPsi;
    out.dji.manuelApres = S.manual;
    out.dji.pitchApplique = +S.cam.pitchDeg.toFixed(2);
    out.dji.hintApres = document.getElementById('poseHint').style.display === 'none';

    // ---------- 6. fichiers sans EXIF exploitable ----------
    const f3 = await jpegWithExif('', 400, 300, 'sans_exif.jpg');
    await loadFile(f3);
    out.sans_exif = { f35: S.exif.f35, lat: S.exif.lat, render: document.getElementById('exifInfo').textContent.slice(0, 40) };
    const ex4 = await readExif(new File([new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12])], 'x.bin'));
    out.binaire = { f35: ex4.f35, lat: ex4.lat, err: ex4.err };
    const ex5 = await readExif(new File([], 'vide.jpg'));
    out.vide = { f35: ex5.f35, lat: ex5.lat, err: ex5.err };
    // orientation déclarée mais non appliquée par le navigateur -> avertissement attendu
    const exifRot = "${buildExifApp1({ f35: 12, orient: 6, pxW: 800, pxH: 600 }).toString('base64')}";
    const f6 = await jpegWithExif(exifRot, 800, 600, 'pivotee.jpg');
    await loadFile(f6);
    // le navigateur applique la rotation EXIF (6 = 90°) : l'image de travail devient 600 x 800
    // et aucun avertissement ne doit apparaître
    out.orientation = { src: [S.srcW, S.srcH], orient: S.exif.orient,
      avertissement: /orientation EXIF non appliquée/.test(document.getElementById('exifInfo').innerHTML) };
  } catch (e) {
    out.exception = e.message + ' @ ' + (e.stack || '').split('\\n')[1];
  }
  out.alert = window.__alert || null;
  out.onerror = window.__onerror || null;
  await sendResult(out, ${PORT});
})();
`;

ensureBuild();
const page = makeTestPage(scenario, path.join(BUILD, 'test_exif.html'));
const r = await collectResult(page, { port: PORT });

const { exifInfo, geoHint, tzHint, azHint, ...printable } = r;
console.log(JSON.stringify(printable, null, 1));
console.log('exifInfo  : ' + String(r.exifInfo).replace(/<[^>]*>/g, ''));
console.log('geoHint   : ' + String(r.geoHint).replace(/<[^>]*>/g, ''));
console.log('tzHint    : ' + String(r.tzHint).replace(/<[^>]*>/g, '').slice(0, 220));
console.log('azHint    : ' + String(r.azHint).replace(/<[^>]*>/g, '').slice(0, 220));

let ko = 0;
const t = (n, c, i) => {
  console.log((c ? '  ok   ' : '  FAIL ') + n + (i ? '   ' + i : ''));
  if (!c) ko++;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('\n== Chargement d\'un JPEG avec EXIF complet ==');
t('pas d\'exception', !r.exception, r.exception || '');
t('pas d\'alerte ni d\'erreur globale', r.alert === null && r.onerror === null, (r.alert || '') + (r.onerror || ''));
t('image décodée 800 x 600', r.src[0] === 800 && r.src[1] === 600, JSON.stringify(r.src));
t('focale équivalente 35 mm = 12 (ultra grand-angle)', r.exif.f35 === 12, String(r.exif.f35));
t('champ déduit de la focale', near(r.hfov, r.hfov_attendu, 0.01), r.hfov + ' vs ' + r.hfov_attendu);
t('champ ~ 110° pour 12 mm en 4:3', r.hfov > 105 && r.hfov < 115, String(r.hfov));
t('latitude GPS parsée', near(r.exif.lat, 48.8530, 1e-4), String(r.exif.lat));
t('longitude GPS parsée', near(r.exif.lon, 2.3499, 1e-4), String(r.exif.lon));
t('latitude appliquée dans le champ', near(r.lat, 48.8530, 1e-4), String(r.lat));
t('altitude GPS', near(r.exif.alt, 35.0, 0.2), String(r.exif.alt));
t('précision GPS', near(r.exif.gpsAcc, 10, 0.1), String(r.exif.gpsAcc));
t('précision affichée', /précision ±10 m/.test(r.geoHint), r.geoHint.replace(/<[^>]*>/g, '').slice(0, 80));
t('cap boussole 290°', r.exif.heading === 290 && r.exif.headingRef === 'M',
  r.exif.heading + ' ' + r.exif.headingRef);
t('cap appliqué comme azimut', r.az === 290, String(r.az));
t('cap signalé comme magnétique', /magnétique/.test(r.azHint), '');
t('objectif et appareil lus', r.exif.make === 'Google' && /Pixel 8 Pro/.test(r.exif.model),
  r.exif.make + ' / ' + r.exif.model);
t('objectif affiché dans le résumé', /Pixel 8 Pro back camera/.test(r.exifInfo), '');
t('décalage horaire lu (OffsetTimeOriginal +02:00)', r.exif.offset === 2 && r.tz === 2, 'offset=' + r.exif.offset + ' tz=' + r.tz);
t('fuseau signalé comme lu, pas estimé', /lu/.test(r.tzHint) && !/estim/.test(r.tzHint), '');
t('date/heure de prise de vue appliquées', r.date === '2026-10-18' && r.time === '10:14',
  r.date + ' ' + r.time);
t('marqueur soleil à la position réelle attendue',
  near(r.soleil.az, r.soleil_attendu.az, 0.2) && near(r.soleil.alt, r.soleil_attendu.alt, 0.2),
  JSON.stringify(r.soleil) + ' vs ' + JSON.stringify(r.soleil_attendu));
t('correction « heure d\'été » -> UTC+1', r.tz_apres_correction === 1 && r.dst_apres_correction === true,
  r.tz_apres_correction + ' / ' + r.dst_apres_correction);
t('pas d\'indice de zoom numérique', r.zoomHint_visible === false);

console.log('\n== Contenu des exports ==');
t('JSON : version et dimensions de la matrice', r.json.version === '1.0' && r.json.lignes === 19 && r.json.colonnes === 72,
  r.json.lignes + ' x ' + r.json.colonnes);
t('JSON : bloc EXIF GPS repris', r.json.exif_gps && near(r.json.exif_gps.latitude, 48.8530, 1e-4),
  JSON.stringify(r.json.exif_gps));
t('JSON : cap et décalage repris', r.json.cap === 290 && r.json.offset === 2, r.json.cap + ' / ' + r.json.offset);
t('CSV 8760 : 8760 lignes de données + 5 en-têtes', r.csv8760.total === 8765 && r.csv8760.entetes === 5,
  r.csv8760.total + ' lignes dont ' + r.csv8760.entetes + ' en-têtes');
t('CSV 8760 : format des valeurs', /^[01]\.\d{3},[01]\.\d{3}$/.test(r.csv8760.premiere), r.csv8760.premiere);
t('CSV 8760 : dernières heures = nuit (1 / 0)', r.csv8760.derniere === '1.000,0.000', r.csv8760.derniere);
t('CSV 8760 : Rows to Skip cohérent avec l\'en-tête', r.csv8760.rowsToSkip === '5', JSON.stringify(r.csv8760.rowsToSkip));

console.log('\n== Zoom numérique, fuseau estimé, cap absent ==');
t('indice de zoom numérique affiché', r.zoom_hint_visible === true);
t('fuseau marqué comme estimé (pas d\'OffsetTime)', r.tz_estime === 2 && r.tz_hint_estime === true,
  String(r.tz_estime));
t('correction du champ par le zoom (facteur 2)', near(r.hfov_apres_zoom, r.hfov_zoom_attendu, 0.01),
  r.hfov_avant_zoom + '° -> ' + r.hfov_apres_zoom + '° (attendu ' + r.hfov_zoom_attendu + '°)');
t('cap absent : indice masqué', r.cap_absent === true);

console.log('\n== XMP : photosphère et drone ==');
t('photosphère : projection équirectangulaire activée', r.pano.projection === 'equirect', String(r.pano.projection));
t('photosphère : étendue azimutale recadrée (800/1200 -> 240°)', Math.abs(r.pano.azSpan - 240) < 0.01,
  String(r.pano.azSpan));
t('photosphère : plage de hauteur déduite', Math.abs(r.pano.altTop - 90) < 0.01 && Math.abs(r.pano.altBottom + 90) < 0.01,
  r.pano.altTop + ' / ' + r.pano.altBottom);
t('photosphère : azimut du bord gauche', Math.abs(r.pano.azLeft - 105) < 0.01, String(r.pano.azLeft));
t('photosphère : cap GPano appliqué (225°)', Math.abs(r.pano.azCenter - 225) < 0.01, String(r.pano.azCenter));
t('photosphère : cap signalé comme vrai', /vrai/.test(r.pano.azHint), '');
t('photosphère : indice affiché', r.pano.hint === true, r.pano.hintTexte);
t('photosphère : calibrage d’horizon masqué', r.pano.horizonMasque === true);
t('photosphère : direction du pixel centre-haut = az 225 / haut 45',
  Math.abs(r.pano.direction.az - 225) < 0.5 && Math.abs(r.pano.direction.alt - 45) < 0.5,
  JSON.stringify(r.pano.direction));
t('photosphère : masque calculable, couverture partielle (240° d’azimut)',
  r.pano.couverture > 0.4 && r.pano.couverture < 0.7, String(r.pano.couverture));
t('drone DJI : reste en projection rectiligne', r.dji.projection === 'rect', String(r.dji.projection));
t('drone DJI : cap gimbal appliqué (137°)', Math.abs(r.dji.az - 137.4) < 0.01, String(r.dji.az));
t('drone DJI : inclinaison proposée, pas imposée',
  r.dji.hintVisible === true && r.dji.pitchAvant === 0 && r.dji.manuelAvant === false, r.dji.hint);
t('drone DJI : application au clic', Math.abs(r.dji.pitchApres + 12.5) < 0.01
  && Math.abs(r.dji.rollApres - 1.5) < 0.01 && r.dji.manuelApres === true,
  r.dji.pitchApres + ' / ' + r.dji.rollApres);
t('drone DJI : inclinaison prise en compte dans le calibrage', Math.abs(r.dji.pitchApplique + 12.5) < 0.01,
  String(r.dji.pitchApplique));
t('drone DJI : indice refermé après application', r.dji.hintApres === true);

console.log('\n== Fichiers sans métadonnées ==');
t('JPEG sans EXIF : focale nulle', r.sans_exif.f35 === null, String(r.sans_exif.f35));
t('JPEG sans EXIF : message explicite', /Aucune donnée EXIF/.test(r.sans_exif.render), r.sans_exif.render);
t('fichier binaire : pas de plantage', r.binaire.f35 === null && !r.binaire.err, JSON.stringify(r.binaire));
t('fichier vide : pas de plantage', r.vide.f35 === null, JSON.stringify(r.vide));
t('orientation EXIF 6 appliquée par le navigateur (image 600 x 800)', r.orientation.src[0] === 600 && r.orientation.src[1] === 800,
  JSON.stringify(r.orientation.src));
t('orientation appliquée : aucun avertissement', r.orientation.avertissement === false);

console.log('\n' + (ko ? 'ECHECS : ' + ko : 'tous les tests EXIF passent') + '\n');
process.exit(ko ? 1 : 0);

/**
 * Validation de bout en bout du calage sur le relief, avec l'API IGN RÉELLE.
 * -------------------------------------------------------------------------
 * Chaîne complète dans le navigateur : photo réelle -> détection du ciel -> repères posés
 * automatiquement sur la frontière ciel/obstacle -> profil MNT (appel IGN) -> ajustement.
 * Hors de la campagne automatique (elle nécessite le réseau) :
 *
 *   node tests/test_dem_live.mjs [chemin/photo.jpg]
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeTestPage, collectResult, SCENE_JS, JPEG_WITH_EXIF_JS, SEND_JS,
         DIR, BUILD, ensureBuild } from './harness.mjs';

const EXT = ['.jpg', '.jpeg', '.png'];
let photo = process.argv[2];
if (!photo){
  photo = fs.readdirSync(path.resolve(DIR, '..'))
    .filter((f) => EXT.includes(path.extname(f).toLowerCase()))
    .map((f) => path.resolve(DIR, '..', f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}
if (!photo || !fs.existsSync(photo)){ console.error('Aucune photo trouvée.'); process.exit(2); }
const name = path.basename(photo);
const b64 = fs.readFileSync(photo).toString('base64');
console.log('\nValidation relief en direct sur : ' + photo);

const PORT = 8768;
const scenario = `
${SCENE_JS}
${JPEG_WITH_EXIF_JS}
${SEND_JS}
window.alert = (m) => { window.__alert = (window.__alert || '') + m; };
window.confirm = () => true;          // l'outil demande confirmation avant l'appel IGN
window.addEventListener('error', (e) => { window.__onerror = String(e.message); });
(async () => {
  const out = {};
  try {
    await loadFile(await fileFromB64("${b64}", ${JSON.stringify(name)}, 'image/jpeg'));
    out.geo = { lat: S.lat, lon: S.lon, az: S.azCenter, tz: S.tz, f35: S.exif.f35 };
    // calibrage de départ : appareil d'aplomb, azimut du cap EXIF
    S.manual = true; S.manPitch = 0; S.manPsi = 0; updateCam();
    S.border = 3; detectSky(false); computeMask();
    out.avant = { pitch: +S.cam.pitchDeg.toFixed(2), couverture: +S.grid.metrics.coverage.toFixed(3) };

    // profil MNT réel (appel IGN)
    const t0 = performance.now();
    await demFetch();
    out.duree_s = +((performance.now() - t0)/1000).toFixed(1);
    const pr = S.dem.profile;
    out.profil = pr ? {
      nAz: pr.az.length, zSol: +pr.zSol.toFixed(1), zCam: +pr.zCam.toFixed(1), step: pr.step,
      crides: pr.alt.map((v, i) => ({ az: pr.az[i], alt: +v.toFixed(2), km: +(pr.dist[i]/1000).toFixed(1) }))
        .sort((a, b) => b.alt - a.alt).slice(0, 5)
    } : null;
    out.status = document.getElementById('demStatus').textContent.trim();

    // repères : frontière ciel/obstacle pour quelques azimuts de terrain naturel
    const azCibles = [242, 252, 262, 272, 282, 292];
    for (const a of azCibles){
      const p = azAltToPixel(S.cam, a, 0);                   // ligne d'horizon -> on balaie la colonne
      if (!p) continue;
      const x = Math.round(p.x);
      if (x < 2 || x > S.W - 2) continue;
      for (let y = Math.round(S.H*0.15); y < Math.round(S.H*0.75); y++){
        const i = y*S.W + x;
        if (S.auto[i] === 0){ S.dem.points.push({ x, y }); break; }
      }
    }
    out.reperes = S.dem.points.map((c) => {
      const d = pixelToAzAlt(S.cam, c.x, c.y);
      return { az: +d.az.toFixed(1), alt: +d.alt.toFixed(2) };
    });

    // ajustement
    S.dem.points.forEach((c, i) => { c.i = i; });
    demFitPose();
    const f = S.dem.fit;
    out.fit = f ? { pitch: +f.pitch.toFixed(2), roll: +f.roll.toFixed(2), n: f.n,
      rej: f.rejected, rms: f.rms, sigPitch: f.sigPitch, sigRoll: f.sigRoll,
      dof: f.dof, singular: f.singular, meanDist_km: +(f.meanDist/1000).toFixed(1),
      pts: f.pts.map((q) => ({ az: +q.az.toFixed(1), obs: +q.obs.toFixed(2), pred: +q.pred.toFixed(2),
                               res: +q.res.toFixed(2), km: +(q.dist/1000).toFixed(1) })) } : null;
    out.demFitHtml = document.getElementById('demFit').textContent.replace(/\\s+/g, ' ').slice(0, 300);
    // effet sur le masque après application
    if (f){ demApply();
      out.apres = { pitch: +S.cam.pitchDeg.toFixed(2), couverture: +S.grid.metrics.coverage.toFixed(3),
                    svf: +S.grid.metrics.svfEst.toFixed(3) }; }
  } catch (e) {
    out.exception = e.message + ' @ ' + (e.stack || '').split('\\n')[1];
  }
  out.alert = window.__alert || null;
  out.onerror = window.__onerror || null;
  await sendResult(out, ${PORT});
})();
`;

ensureBuild();
const page = makeTestPage(scenario, path.join(BUILD, 'test_dem_live.html'));
const r = await collectResult(page, { port: PORT, timeoutMs: 120000 });

console.log('\n--- coordonnées ---');      console.log(JSON.stringify(r.geo));
console.log('--- repères posés sur la silhouette ---'); console.log(JSON.stringify(r.reperes));
console.log('--- profil MNT (appel IGN, ' + r.duree_s + ' s) ---');
if (r.profil){
  console.log('sol ' + r.profil.zSol + ' m (NGF) -> caméra ' + r.profil.zCam + ' m ; '
    + r.profil.nAz + ' azimuts');
  for (const c of r.profil.crides) console.log('   crête ' + c.alt + '° à ' + c.km + ' km (az ' + c.az + '°)');
} else console.log('   (aucun profil — ' + (r.status || '') + ')');
console.log('--- ajustement ---');
if (r.fit){
  console.log('   inclinaison ' + r.fit.pitch + '°   roulis ' + r.fit.roll + '°');
  console.log('   repères ' + r.fit.n + (r.fit.rej ? ' (+' + r.fit.rej + ' écarté)' : '')
    + '   résidu RMS ' + r.fit.rms + '°   crêtes à ' + r.fit.meanDist_km + ' km en moyenne');
  console.log('   incertitudes : ±' + r.fit.sigPitch + '° incl., ±' + r.fit.sigRoll + '° roulis'
    + (r.fit.singular ? '   [matrice singulière]' : ''));
  for (const q of r.fit.pts)
    console.log('   az ' + String(q.az).padStart(6) + '°  observé ' + String(q.obs).padStart(6)
      + '°  prédit ' + String(q.pred).padStart(6) + '°  écart ' + String(q.res).padStart(6)
      + '°  (' + q.km + ' km)');
} else console.log('   (pas d\'ajustement : ' + (r.alert || r.exception || '?') + ')');
if (r.apres) console.log('--- après application ---\n   inclinaison ' + r.apres.pitch
  + '°, couverture ' + (r.apres.couverture*100).toFixed(1) + ' %, SVF estimé '
  + (r.apres.svf*100).toFixed(1) + ' %');
if (r.exception) console.log('\nEXCEPTION : ' + r.exception);

let ko = 0;
const t = (n, c, i) => { console.log((c ? '  ok   ' : '  FAIL ') + n + (i ? '   ' + i : '')); if (!c) ko++; };
console.log('\n== Validation relief en direct ==');
t('pas d\'exception', !r.exception, r.exception || '');
t('pas d\'erreur globale', !r.onerror, r.onerror || '');
t('au moins 4 repères posés sur la silhouette', Array.isArray(r.reperes) && r.reperes.length >= 4,
  String(r.reperes && r.reperes.length));
t('profil MNT obtenu du serveur IGN', !!r.profil, r.status || '');
t('altitude du sol plausible (200-400 m)', r.profil && r.profil.zSol > 200 && r.profil.zSol < 400,
  r.profil ? String(r.profil.zSol) : '');
t('au moins une crête au-dessus de 5°', r.profil && r.profil.crides[0] && r.profil.crides[0].alt > 5,
  r.profil && r.profil.crides[0] ? JSON.stringify(r.profil.crides[0]) : '');
t('ajustement produit', !!r.fit, '');
t('inclinaison proposée dans une plage plausible (±15°)', r.fit && Math.abs(r.fit.pitch) < 15,
  r.fit ? String(r.fit.pitch) : '');
// RMS réaliste : couvert forestier (10-20 m) sur des crêtes à 5-9 km + accrochage du clic (~0,5°)
t('résidu RMS < 2°', r.fit && r.fit.rms < 2, r.fit ? String(r.fit.rms) : '');
t('incertitude sur l\'inclinaison < 1° (ou non estimable)', r.fit && (r.fit.sigPitch === null || r.fit.sigPitch < 1),
  r.fit ? String(r.fit.sigPitch) : '');
t('application au calibrage effective', r.apres && Math.abs(r.apres.pitch - r.fit.pitch) < 0.01,
  r.apres ? String(r.apres.pitch) : '');
console.log('\n' + (ko ? 'ECHECS : ' + ko : 'validation en direct concluante') + '\n');
process.exit(ko ? 1 : 0);

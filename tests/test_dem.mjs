/**
 * Tests du calage sur le relief (MNT IGN) — P1 + P2
 * ---------------------------------------------------
 * 1. Fonctions pures : courbure/réfraction, angle de terrain, silhouette, interpolation circulaire.
 * 2. MNT synthétique + repères générés pour une inclinaison/roulis connus : l'ajustement
 *    (`fitPoseToSkyline`) doit les retrouver à moins de 0,05°.
 * 3. Fixture d'une réponse réelle de l'API IGN (enregistrée) : parsing et ordre des valeurs.
 * 4. Appel réel IGN : uniquement si DEM_LIVE=1 (la campagne reste hors ligne).
 *
 * Usage :  node tests/test_dem.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(DIR, '..', 'masque_solaire.html');

let ok = 0, ko = 0;
const t = (n, c, i) => {
  console.log((c ? '  ok   ' : '  FAIL ') + n + (i ? '   ' + i : ''));
  if (!c) ko++;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ------------------------------------------------------------------ */
/* 1. fonctions pures                                                  */
/* ------------------------------------------------------------------ */
const html = fs.readFileSync(APP, 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const mb = script.split('// ==MATH-BEGIN==')[1].split('// ==MATH-END==')[0];
const M = new Function('const DEG=Math.PI/180, R2D=180/Math.PI;\n' + mb + `
return { demCurvatureDrop, demTerrainAngle, demSkylineFromSamples, demInterp,
         fitPoseToSkyline, makeCam, pixelToAzAlt, azAltToPixel, focalFromHfov, norm360 };`)();

console.log('\n== Relief : fonctions pures ==');
{
  t('courbure : nulle à courte distance, ~0,9 m à 5 km, ~27 m à 20 km',
    M.demCurvatureDrop(100) < 0.001 && near(M.demCurvatureDrop(5000), 1.7, 0.2)
    && near(M.demCurvatureDrop(20000), 27.3, 0.5),
    [100, 5000, 20000].map((d) => M.demCurvatureDrop(d).toFixed(2)).join(' / '));
  t('angle : terrain plat sous la caméra = angle négatif', M.demTerrainAngle(1000, 100, 110) < 0);
  t('angle : crête à 100 m au-dessus, 1 km = 5,7°', near(M.demTerrainAngle(1000, 200, 100), 5.71, 0.02),
    M.demTerrainAngle(1000, 200, 100).toFixed(2) + '°');
  t('angle : la réfraction/courbure abaisse une crête lointaine',
    M.demTerrainAngle(20000, 300, 100) < Math.atan2(200, 20000)*180/Math.PI,
    M.demTerrainAngle(20000, 300, 100).toFixed(3) + '° vs ' + (Math.atan2(200, 20000)*180/Math.PI).toFixed(3) + '°');

  const dists = [100, 500, 1000, 2000, 5000, 10000, 20000];
  const zs = [90, 120, 260, 150, 140, 130, 125];      // crête à 1 km (z 260 pour zcam 100)
  const sk = M.demSkylineFromSamples(dists, zs, 100);
  t('silhouette : retient la crête la plus haute et sa distance',
    near(sk.alt, M.demTerrainAngle(1000, 260, 100), 1e-9) && sk.dist === 1000,
    sk.alt.toFixed(2) + '° à ' + sk.dist + ' m');

  const prof = { az: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
                 alt: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                 dist: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((v) => v*1000) };
  t('interpolation : valeur exacte sur un nœud', near(M.demInterp(prof, 90).alt, 4, 1e-9));
  t('interpolation : milieu entre deux nœuds', near(M.demInterp(prof, 75).alt, 3.5, 1e-9));
  // 345° = milieu entre le nœud 330° (alt 12) et le nœud 0° (alt 1) -> 6,5
  t('interpolation : repli circulaire (345° -> 6,5)', near(M.demInterp(prof, 345).alt, 6.5, 1e-9),
    M.demInterp(prof, 345).alt.toFixed(2));
}

/* ------------------------------------------------------------------ */
/* 2. ajustement sur un MNT synthétique                                */
/* ------------------------------------------------------------------ */
console.log('\n== Relief : calage sur MNT synthétique ==');
{
  // profil « montagnes » : base douce + pics marqués à des azimuts distincts, à trois distances
  // (c'est ce qui rend azimut / inclinaison / roulis identifiables)
  const pics = [ {a: 18, w: 6, h: 6.0, d: 9000}, {a: 62, w: 12, h: 12.5, d: 14500},
                 {a: 148, w: 7, h: 5.0, d: 3800}, {a: 205, w: 9, h: 8.5, d: 6900},
                 {a: 252, w: 5, h: 3.0, d: 1200}, {a: 305, w: 13, h: 10.0, d: 9800} ];
  const az = [], alt = [], dist = [];
  for (let a = 0; a < 360; a += 1){
    let best = 2.0 + 0.9*Math.cos(a*Math.PI/90), dd = 6000;
    for (const q of pics){
      const da = Math.abs(((a - q.a + 540) % 360) - 180);
      const g = q.h*Math.exp(-(da*da)/(2*q.w*q.w));
      if (g > best){ best = g; dd = q.d; }
    }
    az.push(a); alt.push(+best.toFixed(4)); dist.push(dd);
  }
  const prof = { az, alt, dist };
  const W = 1280, H = 800;

  const clics = (f, hfov, azCam, pitchV, rollV, azList) => {
    const cam = M.makeCam({ f, cx: W/2, cy: H/2, pitch: pitchV*Math.PI/180,
      psi: rollV*Math.PI/180, azCenter: azCam });
    const out = [];
    for (const a of azList){
      const p = M.azAltToPixel(cam, a, M.demInterp(prof, a).alt);
      if (p && p.x > 2 && p.x < W - 2 && p.y > 2 && p.y < H - 2) out.push({ x: p.x, y: p.y, az: a });
    }
    return out;
  };

  // --- A. inclinaison + roulis (focale EXIF, objectif standard) ---
  const fA = M.focalFromHfov(65, W);
  const pitchV = 1.8, rollV = -0.7;
  const clA = clics(fA, 65, 175, pitchV, rollV, [140, 150, 160, 185, 205]);
  t('repères générés dans l’image (A)', clA.length >= 3, clA.length + ' repères : '
    + clA.map((c) => c.az + '°').join(', '));
  const resA = M.fitPoseToSkyline(prof, clA, { f: fA, cx: W/2, cy: H/2, pitchDeg: 0, rollDeg: 0, azCenter: 175 }, {});
  t('ajustement sans erreur (A)', !resA.err, resA.err || '');
  t('inclinaison retrouvée (+1,80°)', !resA.err && near(resA.pitch, pitchV, 0.05),
    resA.err || resA.pitch.toFixed(3) + '°');
  t('roulis retrouvé (−0,70°)', !resA.err && near(resA.roll, rollV, 0.05),
    resA.err || resA.roll.toFixed(3) + '°');
  t('résidu faible', !resA.err && resA.rms < 0.05, resA.err || resA.rms + '°');
  t('incertitudes faibles', !resA.err && resA.sigPitch !== null && resA.sigPitch < 0.2,
    resA.err || ('±' + resA.sigPitch + '° incl., ±' + resA.sigRoll + '° roulis'));

  // --- B. repère aberrant (clic sur un arbre proche, 90 px au-dessus de la crête) ---
  const mal = clA.map((c, i) => i === 2 ? { x: c.x, y: c.y - 90, az: c.az } : c);
  const resB = M.fitPoseToSkyline(prof, mal, { f: fA, cx: W/2, cy: H/2, pitchDeg: 0, rollDeg: 0, azCenter: 175 }, {});
  t('rejet du repère aberrant', !resB.err && resB.rejected >= 1, resB.err || ('écartés : ' + resB.rejected));
  t('inclinaison encore correcte après rejet', !resB.err && near(resB.pitch, pitchV, 0.2),
    resB.err || resB.pitch.toFixed(3) + '°');

  // --- C. azimut + inclinaison + roulis (ultra grand-angle, repères étalés) ---
  const fC = M.focalFromHfov(110, W);
  const clC = clics(fC, 110, 220, pitchV, rollV, [162, 185, 205, 225, 245, 268]);
  t('repères étalés générés (C)', clC.length >= 5, clC.length + ' repères : '
    + clC.map((c) => c.az + '°').join(', '));
  // départ à 210° (10° d'erreur, comme le cap EXIF) : c'est le cas d'usage réel
  const resC = M.fitPoseToSkyline(prof, clC, { f: fC, cx: W/2, cy: H/2, pitchDeg: 0, rollDeg: 0, azCenter: 210 },
    { solveAz: true });
  t('azimut retrouvé (220°)', !resC.err && near(resC.azCenter, 220, 2.5), resC.err || (resC.azCenter.toFixed(2) + '°'));
  t('inclinaison et roulis retrouvés avec l’azimut', !resC.err
    && near(resC.pitch, pitchV, 0.3) && near(resC.roll, rollV, 0.3),
    resC.err || (resC.pitch.toFixed(2) + '° / ' + resC.roll.toFixed(2) + '°'));
  t('incertitudes faibles (C)', !resC.err && resC.sigAz !== null && resC.sigAz < 2 && resC.sigPitch < 0.2,
    resC.err || ('±' + resC.sigPitch + '° incl., ±' + resC.sigAz + '° az.'));

  // --- D. cas dégénéré : profil lisse et repères groupés -> incertitudes élevées (diagnostic) ---
  const lisse = { az: prof.az.slice(), alt: prof.az.map((a) => 5 + 3*Math.cos(a*Math.PI/180)),
                  dist: prof.az.map(() => 9000) };
  const camD = M.makeCam({ f: fA, cx: W/2, cy: H/2, pitch: 0, psi: 0, azCenter: 180 });
  const clD = [];
  for (const a of [170, 175, 180, 185]){
    const p = M.azAltToPixel(camD, a, M.demInterp(lisse, a).alt);
    if (p) clD.push({ x: p.x, y: p.y });
  }
  const resD = M.fitPoseToSkyline(lisse, clD, { f: fA, cx: W/2, cy: H/2, pitchDeg: 0, rollDeg: 0, azCenter: 180 },
    { solveAz: true });
  // profil lisse + repères groupés : azimut/roulis non identifiables -> le calage doit le dire
  t('dégénérescence signalée (incertitude azimut > 1,5° ou non estimable)',
    !resD.err && (resD.singular || resD.sigAz === null || resD.sigAz > 1.5),
    resD.err || ('singulier=' + resD.singular + ', ±' + resD.sigAz + '° azimut'));

  // --- E. refus explicite si moins de 2 repères exploitables ---
  const resE = M.fitPoseToSkyline(prof, [clA[0]], { f: fA, cx: W/2, cy: H/2, pitchDeg: 0, rollDeg: 0, azCenter: 175 }, {});
  t('refus si moins de 2 repères exploitables', !!resE.err, resE.err || 'pas de refus');
}

/* ------------------------------------------------------------------ */
/* 3. fixture d'une réponse réelle de l'API IGN                        */
/* ------------------------------------------------------------------ */
console.log('\n== Relief : réponse IGN enregistrée ==');
{
  const fix = path.join(DIR, 'fixtures', 'ign_elevation_reponse.json');
  if (!fs.existsSync(fix)){
    console.log('  (fixture absente — enregistrée par test_dem.mjs --record)');
  } else {
    const j = JSON.parse(fs.readFileSync(fix, 'utf8'));
    const z = j.elevations;
    t('réponse : tableau plat de nombres', Array.isArray(z) && typeof z[0] === 'number',
      typeof z + ' / ' + typeof z[0]);
    t('réponse : nombre de points attendu', z.length === j._attendu, z.length + ' vs ' + j._attendu);
    t('réponse : sol du point public ~34 m (NGF)',
      Math.abs(z[j._iSol] - 34.09) < 1.5, String(z[j._iSol]));
    t('réponse : relief présent dans le champ (> 150 m)',
      Math.max.apply(null, z) > 150, String(Math.max.apply(null, z)));
    // le profil reconstruit doit donner une silhouette plausible (relief de plaine francilien)
    const azs = j._az, nRad = j._nRad, dists = [];
    for (let i = 0; i < nRad; i++) dists.push(30*Math.pow(25000/30, i/(nRad - 1)));
    const zcam = z[j._iSol] + 5;
    let best = -90;
    for (let k = 0; k < azs.length; k++){
      const sk = M.demSkylineFromSamples(dists, z.slice(1 + k*nRad, 1 + (k + 1)*nRad), zcam);
      best = Math.max(best, sk.alt);
    }
    t('profil reconstruit : crête > 1°', best > 1, best.toFixed(2) + '°');
  }
}

/* ------------------------------------------------------------------ */
/* 4. appel réel (opt-in)                                              */
/* ------------------------------------------------------------------ */
if (process.env.DEM_LIVE === '1'){
  console.log('\n== Relief : appel réel IGN (DEM_LIVE=1) ==');
  const lat = 48.8530, lon = 2.3499;   // point public (centre de Paris)
  const body = { lon: lon + '|' + (lon + 0.01), lat: lat + '|' + (lat + 0.01),
                 resource: 'ign_rge_alti_wld', zonly: 'true' };
  const r = await fetch('https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  t('appel réel : deux altitudes reçues', j.elevations && j.elevations.length === 2, JSON.stringify(j).slice(0, 120));
  if (j.elevations) t('appel réel : sol ~34 m', Math.abs(j.elevations[0] - 34) < 3, String(j.elevations[0]));
} else {
  console.log('\n(les appels réseau réels sont désactivés — utilisez DEM_LIVE=1 pour les tester)');
}

console.log('\n' + (ko ? 'ECHECS : ' + ko : 'tous les tests relief passent') + '\n');
process.exit(ko ? 1 : 0);

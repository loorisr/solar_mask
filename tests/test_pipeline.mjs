/**
 * Test de bout en bout sur une scène de synthèse (aucun fichier externe nécessaire).
 * Vérifie : détection du ciel, grille de masque, sondes de directions, série horaire 8760,
 * exports, pinceaux, annulation, changements de paramètres.
 *
 * Usage :  node tests/test_pipeline.mjs
 */
import path from 'node:path';
import { makeTestPage, dumpDom, readResults, BUILD, ensureBuild } from './harness.mjs';

const scenario = `
window.__results = null;
window.addEventListener('load', () => {
  const out = {};
  const probe = (x, y) => {
    const d = pixelToAzAlt(S.cam, x, y);
    return { az: +d.az.toFixed(2), alt: +d.alt.toFixed(2),
             open: +sampleGrid(S.grid, d.az, d.alt).toFixed(3) };
  };
  try {
    const c = makeDemo();
    installImage(c, c.width, c.height, 'demo');
    setHfov(65, true);
    out.taille = [S.W, S.H];
    // réglage par défaut : horizon au centre vertical -> inclinaison nulle
    out.defaut = { yRelatif: +(S.hz.y1/S.H).toFixed(4), pitch: +S.cam.pitchDeg.toFixed(3) };

    // calibrage : horizon réel (y = 560/800) + façade au sud
    S.hz = { x1: S.W*0.08, y1: S.H*0.70, x2: S.W*0.92, y2: S.H*0.70 };
    setAz(180); updateCam();
    out.cal = { f: +S.cal.f.toFixed(2), pitch: +S.cam.pitchDeg.toFixed(3), roll: +S.cam.rollDeg.toFixed(3) };

    // détection automatique
    S.border = 0; detectSky(false);
    out.part_ciel_pixels = +((S.auto.reduce((a, b) => a + b, 0))/(S.W*S.H)).toFixed(3);

    // exclusion de bordure (cadre de fenêtre)
    S.border = 6; detectSky(false);
    out.part_ciel_avec_bordure = +((S.auto.reduce((a, b) => a + b, 0))/(S.W*S.H)).toFixed(3);
    const bx = Math.round(S.W*0.06), by = Math.round(S.H*0.06);
    let bordSky = 0;
    for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++)
      if ((y < by || y >= S.H - by || x < bx || x >= S.W - bx) && S.auto[y*S.W + x]) bordSky++;
    out.bordure_ciel_restant = bordSky;
    S.border = 0; detectSky(false);

    computeMask();
    const g = S.grid;
    out.grille = [g.naz, g.nalt];
    out.couverture = +g.metrics.coverage.toFixed(4);
    out.svf_couvert = +g.metrics.svfCov.toFixed(4);
    out.svf_estime = +g.metrics.svfEst.toFixed(4);
    out.sonde = {
      mur_immeuble: probe(220, 400),
      ciel_immeuble: probe(220, 180),
      arbre: probe(1100, 430),
      ciel_haut: probe(640, 60),
      ciel_droite: probe(1000, 120)
    };

    // série horaire annuelle
    const h = computeHourly();
    out.heures = h.length;
    out.hors_bornes = h.filter((x) => x.open < 0 || x.open > 1).length;
    out.nuit = h.filter((x) => x.alt <= 0).length;
    const day = h.filter((x) => x.alt > 0);
    out.heures_ensoleillees = day.length;
    out.ouverture_moy_annee = +(day.reduce((a, x) => a + x.open, 0)/day.length).toFixed(4);
    out.h_ombre_annee = day.filter((x) => x.open < 0.98).length;
    out.dec = { nSun: S.monthly[11].nSun, ouverture: +(S.monthly[11].sunOpen/S.monthly[11].nSun).toFixed(3) };
    out.juin = { nSun: S.monthly[5].nSun, ouverture: +(S.monthly[5].sunOpen/S.monthly[5].nSun).toFixed(3),
                 plein_soleil: S.monthly[5].fullSun };
    out.alt_max_annee = +Math.max.apply(null, h.map((x) => x.alt)).toFixed(2);
    out.alt_noel_midi = +h.filter((x) => x.m === 12 && x.d === 21 && x.hour === 12)[0].alt.toFixed(2);

    // exports (contenu intercepté, pas seulement absence d'erreur)
    document.getElementById('btnCsvMask').onclick();
    document.getElementById('btnJson').onclick();
    document.getElementById('btnCsv8760').onclick();
    document.getElementById('btnCsvSolar').onclick();
    out.nb_exports = window.__blobs.length;
    out.snippets = document.getElementById('epSnippet').value.length;
    out.canvas_view = [view.width, view.height];
    out.canvas_view_non_vide = view.getContext('2d').getImageData(0, 0, 60, 60).data.some((v) => v > 0);
    out.canvas_chart_non_vide = chart.getContext('2d').getImageData(0, 0, 1400, 720).data.some((v) => v > 0);

    // pinceau obstacle puis annulation
    const pSky = pixelToAzAlt(S.cam, 640, 100);
    out.avant_pinceau = +sampleGrid(S.grid, pSky.az, pSky.alt).toFixed(3);
    setMode('brushObs');
    S.undo.push(S.brush.slice());
    paintCircle(640, 100, 110, 2);
    computeMask();
    out.apres_pinceau = +sampleGrid(S.grid, pSky.az, pSky.alt).toFixed(3);
    document.getElementById('btnUndo').onclick();
    out.apres_annulation = +sampleGrid(S.grid, pSky.az, pSky.alt).toFixed(3);

    // pinceau ciel sur une zone d'obstacle
    const pObs = pixelToAzAlt(S.cam, 220, 400);
    out.obstacle_avant = +sampleGrid(S.grid, pObs.az, pObs.alt).toFixed(3);
    setMode('brushSky');
    S.undo.push(S.brush.slice());
    paintCircle(220, 400, 110, 1);
    computeMask();
    out.obstacle_apres_pinceau_ciel = +sampleGrid(S.grid, pObs.az, pObs.alt).toFixed(3);

    // ---- calque ciel : voile bleu + hachures claires (lisibilité sur un ciel bleu) ----
    const ovd = S.ovData.data, ovW = S.W;
    let traits = 0, fond = 0, transparent = 0;
    for (let y = 20; y < 110; y++) for (let x = 520; x < 760; x++){
      const j = (y*ovW + x)*4;
      if (ovd[j+3] === 0){ transparent++; continue; }
      if (ovd[j] > 200 && ovd[j+3] >= 150) traits++; else fond++;
    }
    out.hachures = { traits: traits, fond: fond, transparent: transparent,
                     periode: S.ovPer, epaisseur: S.ovTh,
                     part: +(traits/Math.max(1, traits + fond)).toFixed(3) };

    // ---- gomme : la retouche est effacée, la détection automatique reprend la main ----
    document.getElementById('modeEraser').onclick();
    out.mode_gomme = S.mode;
    S.undo.push(S.brush.slice());
    paintCircle(220, 400, 110, 0);
    computeMask();
    out.gomme = { brush: S.brush[400*ovW + 220],
                  open: +sampleGrid(S.grid, pObs.az, pObs.alt).toFixed(3),
                  calque_alpha: S.ovData.data[(400*ovW + 220)*4 + 3] };
    setMode('brushSky');

    // ---- silhouette MNT : tracé continu et VISIBLE sur toute la largeur du champ ----
    // (le cas qui posait problème : crête proche -> pointillés si peu opaques qu'ils disparaissaient)
    {
      const azp = [], altp = [], distp = [];
      for (let a = 0; a < 360; a += 5){
        azp.push(a);
        altp.push(+(4.5 + 3.0*Math.cos((a - 180)*Math.PI/180)).toFixed(2));
        distp.push((a > 160 && a < 200) ? 800 : 6000);      // bande centrale proche, bords lointains
      }
      S.dem.profile = { az: azp, alt: altp, dist: distp, zSol: 254, zCam: 259,
                        lat: 48.85, lon: 2.35, step: 5 };
      S.dem.show = false; draw();
      const sans = view.getContext('2d').getImageData(0, 0, S.W, S.H).data.slice();
      S.dem.show = true; draw();
      const avec = view.getContext('2d').getImageData(0, 0, S.W, S.H).data;
      const diffCol = [];
      for (let x = 0; x < S.W; x++){
        let dmax = 0;
        for (let y = 0; y < S.H; y++){
          const j = (y*S.W + x)*4;
          const d = Math.abs(avec[j] - sans[j]) + Math.abs(avec[j + 1] - sans[j + 1])
                  + Math.abs(avec[j + 2] - sans[j + 2]);
          if (d > dmax) dmax = d;
        }
        diffCol.push(dmax);
      }
      // « trait franc » = écart de plus de 100 sur la somme des canaux (liseré sombre + couleur) ;
      // les trous de quelques pixels sont les pointillés de la crête proche.
      const fort = diffCol.map((d) => d > 100);
      let premier = -1, dernier = -1, trou = 0, cur = 0, contrasteMin = 1e9;
      for (let x = 0; x < S.W; x++) if (fort[x]){ if (premier < 0) premier = x; dernier = x; }
      for (let x = premier; x <= dernier; x++){
        if (fort[x]){ cur = 0; if (diffCol[x] < contrasteMin) contrasteMin = diffCol[x]; }
        else { cur++; if (cur > trou) trou = cur; }
      }
      out.silhouette = { premier: premier, dernier: dernier, largeur: S.W,
                         contraste_min: contrasteMin, trou_max: trou };
      S.dem.profile = null; S.dem.show = true; draw();
    }

    // ---- diagramme en mode photo : la couleur doit venir de la bonne direction ----
    setChartMode('photo');
    const rp = buildReproj(chart.width - 80, chart.height - 70);
    const rc = rp.getContext('2d');
    const px = (az, alt) => Array.from(rc.getImageData(
      Math.min(rp.width - 1, Math.round(az/360*rp.width)),
      Math.min(rp.height - 1, Math.round((90 - alt)/90*rp.height)), 1, 1).data.slice(0, 3));
    out.reproj = { immeuble: px(157, 8), ciel: px(180, 25), arbre: px(205, 7), hors_photo: px(60, 60) };
    out.reproj_taille = [rp.width, rp.height];
    const img = chart.getContext('2d').getImageData(0, 0, chart.width, chart.height).data;
    out.chart_photo_non_vide = img.some((v, i) => i % 4 === 3 && v > 0);
    setChartMode('mask');

    // ---- photosphère équirectangulaire synthétique ----
    const eq = document.createElement('canvas'); eq.width = 1600; eq.height = 800;
    const eg = eq.getContext('2d');
    eg.fillStyle = '#9fc7ea'; eg.fillRect(0, 0, 1600, 400);            // ciel (au-dessus de l'horizon)
    eg.fillStyle = '#6b6a60'; eg.fillRect(0, 400, 1600, 400);          // sol
    eg.fillStyle = '#3a3f45';                                          // obstacle : az 100-140, haut 10-30
    eg.fillRect(100/360*1600, 400 - 30/90*400, 40/360*1600, 20/90*400);
    installImage(eq, 1600, 800, 'photosphere_test.jpg');
    setAz(180); setProjection('equirect');
    S.border = 0; detectSky(false); computeMask();
    out.eq = {
      projection: S.proj,
      azSpan: S.azSpan,
      couverture: +S.grid.metrics.coverage.toFixed(4),
      direction_centre: (() => { const d = pixelToAzAlt(S.cam, S.W*0.5, S.H*0.25);
        return { az: +d.az.toFixed(1), alt: +d.alt.toFixed(1) }; })(),
      obstacle: +sampleGrid(S.grid, 120, 20).toFixed(3),
      ciel_oppose: +sampleGrid(S.grid, 300, 20).toFixed(3),
      ciel_haut: +sampleGrid(S.grid, 120, 70).toFixed(3),
      sous_horizon_ignore: +sampleGrid(S.grid, 120, 0).toFixed(3)
    };
    // retour au rectiligne pour la suite
    setProjection('rect');

    // changements de paramètres
    setMode('horizon'); setAz(90); updateCam(); draw(); drawChart();
    document.getElementById('azStepSel').onchange({ target: { value: '10' } });
    document.getElementById('altStepSel').onchange({ target: { value: '10' } });
    out.grille2 = [S.grid.naz, S.grid.nalt];
    document.getElementById('chkLeap').checked = true;
    out.heures_bissextile = computeHourly().length;
    document.getElementById('chkLeap').checked = false;
    out.rendu_ok = true;
  } catch (e) {
    out.exception = e.message + ' @ ' + (e.stack || '').split('\\n')[1];
  }
  const d = document.createElement('div');
  d.id = 'TESTOUT';
  d.textContent = 'RESULTS=' + JSON.stringify(out);
  document.body.appendChild(d);
});
`;

ensureBuild();
const page = makeTestPage(
  'window.alert = (m) => { window.__alert = (window.__alert || "") + m; };\n'
  + 'window.addEventListener("error", (e) => { window.__onerror = String(e.message); });\n'
  + 'window.addEventListener("unhandledrejection", (e) => { window.__onerror = "rejection " + e.reason; });\n'
  + 'window.__blobs = []; const __origCreate = URL.createObjectURL.bind(URL);'
  + 'URL.createObjectURL = (b) => { window.__blobs.push(b); return __origCreate(b); };\n'
  + scenario,
  path.join(BUILD, 'test_pipeline.html'));

const dom = dumpDom(page, 20000);
const r = readResults(dom);
if (!r){ console.log('PAS DE RÉSULTAT — extrait du DOM :\n' + dom.slice(0, 2000)); process.exit(1); }
console.log(JSON.stringify(r, null, 1));

let ko = 0;
const t = (name, cond, info) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (info ? '   ' + info : ''));
  if (!cond) ko++;
};
console.log('\n== Pipeline complet (scène de synthèse : immeuble à gauche, arbre à droite, façade sud) ==');
t('pas d\'exception', !r.exception, r.exception || '');
t('image 1280x800', r.taille[0] === 1280 && r.taille[1] === 800, JSON.stringify(r.taille));
t('horizon par défaut au centre vertical (50 %)', Math.abs(r.defaut.yRelatif - 0.5) < 1e-6, String(r.defaut.yRelatif));
t('inclinaison par défaut = 0°', Math.abs(r.defaut.pitch) < 1e-9, String(r.defaut.pitch));
t('pitch = 9.05° (horizon à 70 % de la hauteur)', Math.abs(r.cal.pitch - 9.05) < 0.1, JSON.stringify(r.cal));
t('roulis nul', Math.abs(r.cal.roll) < 1e-9);
t('ciel détecté entre 30 et 65 % des pixels', r.part_ciel_pixels > 0.3 && r.part_ciel_pixels < 0.65, String(r.part_ciel_pixels));
t('ciel encore détecté avec bordure exclue', r.part_ciel_avec_bordure > 0.3, String(r.part_ciel_avec_bordure));
t('aucun pixel de ciel dans la bordure exclue', r.bordure_ciel_restant === 0, String(r.bordure_ciel_restant));
t('grille 5° x 5° = 72 x 19', r.grille[0] === 72 && r.grille[1] === 19, JSON.stringify(r.grille));
t('couverture partielle du demi-ciel (5-40 %)', r.couverture > 0.05 && r.couverture < 0.4, String(r.couverture));
t('SVF zone couverte plausible (0,4-0,95)', r.svf_couvert > 0.4 && r.svf_couvert < 0.95, String(r.svf_couvert));
t('SVF demi-ciel estimé (0,5-1)', r.svf_estime > 0.5 && r.svf_estime <= 1, String(r.svf_estime));
t('mur de l\'immeuble -> masqué', r.sonde.mur_immeuble.open < 0.2, JSON.stringify(r.sonde.mur_immeuble));
t('ciel au-dessus de l\'immeuble -> dégagé', r.sonde.ciel_immeuble.open > 0.9, JSON.stringify(r.sonde.ciel_immeuble));
t('arbre -> masqué', r.sonde.arbre.open < 0.25, JSON.stringify(r.sonde.arbre));
t('ciel haut -> dégagé', r.sonde.ciel_haut.open > 0.95, JSON.stringify(r.sonde.ciel_haut));
t('ciel à droite du mât -> dégagé', r.sonde.ciel_droite.open > 0.9, JSON.stringify(r.sonde.ciel_droite));
t('8760 valeurs produites', r.heures === 8760, String(r.heures));
t('8784 valeurs si année bissextile', r.heures_bissextile === 8784, String(r.heures_bissextile));
t('aucune valeur hors [0,1]', r.hors_bornes === 0, String(r.hors_bornes));
t('~4380 h de nuit', r.nuit > 4200 && r.nuit < 4500, String(r.nuit));
t('hauteur max annuelle ~64.6° (Paris)', Math.abs(r.alt_max_annee - 64.59) < 0.5, String(r.alt_max_annee));
t('hauteur à midi le 21/12 ~17.7°', Math.abs(r.alt_noel_midi - 17.6) < 0.6, String(r.alt_noel_midi));
t('juin : 480 h de soleil, aucune ombre', r.juin.nSun === 480 && r.juin.ouverture === 1 && r.juin.plein_soleil === 480,
  JSON.stringify(r.juin));
t('décembre : ombres présentes (immeuble le matin)', r.dec.ouverture < 1 && r.dec.ouverture > 0.5, JSON.stringify(r.dec));
t('ouverture moyenne annuelle élevée mais < 1', r.ouverture_moy_annee > 0.9 && r.ouverture_moy_annee < 1, String(r.ouverture_moy_annee));
t('quelques heures ombragées dans l\'année', r.h_ombre_annee > 20, String(r.h_ombre_annee));
t('4 exports déclenchés', r.nb_exports === 4, String(r.nb_exports));
t('bloc EnergyPlus généré', r.snippets > 800, String(r.snippets));
t('vue photo rendue', r.canvas_view_non_vide === true && r.canvas_view[0] === 1280);
t('diagramme rendu', r.canvas_chart_non_vide === true);
t('pinceau obstacle masque une zone de ciel', r.avant_pinceau > 0.9 && r.apres_pinceau < 0.1,
  r.avant_pinceau + ' -> ' + r.apres_pinceau);
t('annulation restaure le masque', r.apres_annulation > 0.9, String(r.apres_annulation));
t('pinceau ciel rouvre une zone d\'obstacle', r.obstacle_avant < 0.2 && r.obstacle_apres_pinceau_ciel > 0.85,
  r.obstacle_avant + ' -> ' + r.obstacle_apres_pinceau_ciel);
t('calque ciel hachuré : traits clairs ET fond bleu présents', r.hachures.traits > 20 && r.hachures.fond > 20,
  JSON.stringify(r.hachures));
t('hachures : proportion des traits conforme à l\'épaisseur (~32 %)',
  r.hachures.part > 0.24 && r.hachures.part < 0.42, String(r.hachures.part));
t('hachures : période ≥ 12 px et trait ≥ 3 px', r.hachures.periode >= 12 && r.hachures.epaisseur >= 3,
  r.hachures.periode + ' px / ' + r.hachures.epaisseur + ' px');
t('gomme : outil actif et correction ramenée à l\'automatique', r.mode_gomme === 'eraser' && r.gomme.brush === 0,
  JSON.stringify([r.mode_gomme, r.gomme.brush]));
t('gomme : masque revenu à la valeur automatique', Math.abs(r.gomme.open - r.obstacle_avant) < 0.002,
  r.gomme.open + ' vs ' + r.obstacle_avant);
t('gomme : calque ciel remis à jour (obstacle -> transparent)', r.gomme.calque_alpha === 0,
  String(r.gomme.calque_alpha));
t('silhouette MNT : tracée jusqu\'aux deux bords du champ',
  r.silhouette.premier >= 0 && r.silhouette.premier <= 8 && r.silhouette.dernier >= r.silhouette.largeur - 9,
  JSON.stringify([r.silhouette.premier, r.silhouette.dernier, r.silhouette.largeur]));
t('silhouette MNT : trait franc sur toute la longueur (pas de segment translucide)',
  r.silhouette.contraste_min > 100, 'contraste minimal : ' + r.silhouette.contraste_min);
t('silhouette MNT : pas de trou (hors pointillés de la crête proche)',
  r.silhouette.trou_max <= 30, 'plus grand trou : ' + r.silhouette.trou_max + ' px');
t('changement de pas de grille (10° x 10°)', r.grille2[0] === 36 && r.grille2[1] === 10, JSON.stringify(r.grille2));
t('diagramme mode photo : rendu non vide', r.chart_photo_non_vide === true, JSON.stringify(r.reproj_taille));
t('diagramme mode photo : immeuble -> gris (pas de bleu)', (() => {
  const [R, G, B] = r.reproj.immeuble; return R > 100 && Math.abs(R - G) < 25 && B < R + 30;
})(), JSON.stringify(r.reproj.immeuble));
t('diagramme mode photo : ciel -> bleu', (() => {
  const [R, G, B] = r.reproj.ciel; return B > R + 20;
})(), JSON.stringify(r.reproj.ciel));
t('diagramme mode photo : arbre -> vert', (() => {
  const [R, G, B] = r.reproj.arbre; return G > R && G > B;
})(), JSON.stringify(r.reproj.arbre));
t('diagramme mode photo : directions hors photo -> fond sombre', (() => {
  const [R, G, B] = r.reproj.hors_photo; return R < 60 && G < 60 && B < 70;
})(), JSON.stringify(r.reproj.hors_photo));
t('photosphère : projection équirectangulaire active', r.eq.projection === 'equirect' && r.eq.azSpan === 360,
  JSON.stringify([r.eq.projection, r.eq.azSpan]));
t('photosphère : demi-ciel entièrement couvert', r.eq.couverture > 0.98, String(r.eq.couverture));
t('photosphère : direction du pixel centre-haut = az 180 / haut 45',
  Math.abs(r.eq.direction_centre.az - 180) < 0.5 && Math.abs(r.eq.direction_centre.alt - 45) < 0.5,
  JSON.stringify(r.eq.direction_centre));
t('photosphère : obstacle synthétique détecté', r.eq.obstacle < 0.3, String(r.eq.obstacle));
t('photosphère : ciel à l\'opposé', r.eq.ciel_oppose > 0.9, String(r.eq.ciel_oppose));
t('photosphère : ciel au zénith', r.eq.ciel_haut > 0.9, String(r.eq.ciel_haut));
t('rendus sans erreur', r.rendu_ok === true);
console.log('\n' + (ko ? 'ECHECS : ' + ko : 'tous les tests du pipeline passent') + '\n');
process.exit(ko ? 1 : 0);

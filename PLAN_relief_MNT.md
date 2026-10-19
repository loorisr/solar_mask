# Plan — calage du masque solaire sur le relief (MNT IGN)

> Périmètre retenu : **source IGN uniquement**, **hauteur de prise de vue obtenue par appel API
> MNT à partir de la position GPS**, **arrêt à la phase P2** (calage assisté par clics).
> Rédigé après vérification en conditions réelles sur `photo_exemple.jpg`.

## État — implémenté (P1 + P2)

| Phase | État |
|---|---|
| **P1** — profil MNT, hauteur de prise de vue par API, tracé de la silhouette (photo + diagramme) | ✅ implémenté, validé en direct (appel IGN 3,4 s, 2 449 points) |
| **P2** — calage assisté par clics (RANSAC, pondération par distance, incertitudes, signalement du mauvais conditionnement) | ✅ implémenté, validé en direct (`photo_exemple.jpg` : inclinaison −2,0°, roulis 0°, résidu 0,5–1,6°) |
| P3 / P4 / P5 | hors périmètre (voir §8) |

## 1. Principe

Une photo montre la **silhouette** du terrain (crêtes, collines). Un **modèle numérique de terrain
(MNT)** permet de *prédire* cette silhouette depuis la position GPS : pour chaque azimut, l'angle de
hauteur de la crête vue depuis l'appareil. En appariant les deux, on obtient des paramètres de
calibrage **absolus** — ce que la ligne d'horizon ne peut pas donner quand l'horizon vrai est caché
par une colline (cas exact de `photo_exemple.jpg`).

## 2. Faits vérifiés le 18/10/2026 (à ne pas re-découvrir)

| Point | Constat |
|---|---|
| API altimétrique IGN | `POST https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json` |
| Corps de requête | `{lon:"l1\|l2\|…", lat:"…", resource:"ign_rge_alti_wld", zonly:"true"}` — `zonly` doit être la **chaîne** `"true"` (un booléen JSON renvoie une erreur) |
| Capacité | **2 449 points en un seul appel, 3,2 s** ; en GET, la limite d'URL coupe vers ~150–200 points (`414`) |
| CORS | `access-control-allow-origin: *` sur `data.geopf.fr` → appelable depuis la page (mode `file://`) |
| Référence altimétrique | RGE ALTI = **NGF-IGN69 (orthométrique)** |
| ⚠️ Piège | L'altitude EXIF du Pixel est **ellipsoïdale** : 305,5 m contre 254,6 m au MNT, soit **~51 m d'écart géoïdal**. Ne jamais utiliser l'altitude EXIF comme référence. |
| Couches IGN utiles (WMTS) | `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES` (MNT 1 m), `…HIGHRES.MNS` + `IGNF_LIDAR-HD_MNS_*` (**MNS 0,5 m : bâtiments + végétation**) — hors périmètre ici |

## 3. Preuve de concept sur `photo_exemple.jpg`

Position 45,704639 N / 5,913011 E ; caméra prise à `z_MNT + 5 m`. Comparaison de la frontière
ciel/obstacle lue dans le masque (pitch 0) avec la crête prédite par le MNT :

| Azimut | Observé (photo) | Prédit (MNT) | Écart |
|---|---|---|---|
| 240° | 11,0° | 8,77° (mont à 7,6 km, 1433 m) | +2,3° |
| 250° | 9,3° | 6,25° | +3,0° |
| 260° | 7,1° | 4,86° | +2,2° |
| 270° | 5,7° | 6,96° | −1,2° |
| 280° | 2,6° | 7,44° | −4,9° |
| 300° | 7,9° | 4,52° | +3,4° |

Écart moyen **+0,83°**, écart-type **2,7°**. Enseignements :

1. Le MNT et la photo **concordent en ordre de grandeur et en forme** → la méthode est viable.
2. La dispersion vient du **proche** (arbres, toits, haies) absent du MNT, et de la résolution
   d'extraction (cellules de 5°). D'où : **pondération par la distance** et **rejet des aberrants**.
3. Un observé **sous** le prédit est physiquement impossible → excellent critère de rejet.
4. Précision : biais de couvert forestier 1,4° à 1 km mais **0,19° à 7,6 km** → la crête lointaine
   est la référence fiable ; le proche reste le travail de la photo.

## 4. Périmètre implémenté (P1 + P2)

### P1 — Profil MNT + tracé de la silhouette

* Bouton **« Calculer la silhouette (MNT IGN) »** : un `POST` unique contenant
  1 point (position de prise de vue) + `pas d'azimut` × `N` échantillons radiaux en progression
  **logarithmique** de 30 m à 25 km (pas azimuth 5° par défaut, 34 échantillons → 2 449 points).
* **Hauteur de prise de vue par API** : `z_sol = MNT(lat, lon)` (retourné par le même appel, premier
  point) puis `z_caméra = z_sol + h`, `h` = hauteur au-dessus du sol saisie (5 m par défaut pour un
  premier étage). L'écart avec l'altitude EXIF est affiché à titre d'information (*« écart géoïdal
  apparent 51 m : altitude EXIF ellipsoïdale, non utilisée »*). Le GPS ne sert donc qu'à la position.
* **Profil** : pour chaque azimut, `angle(d) = atan2((z(d) − z_caméra) − d²·0,87/(2R), d)`
  (courbure terrestre + réfraction, `k = 0,13`), on retient le maximum et **la distance de la crête**.
* **Tracé** de la silhouette sur la photo **et** sur le diagramme : trait plein là où la crête est
  lointaine (> 1,5 km, fiable), pointillé près (indicatif), avec repère des sommets.
* Réglage fin par les curseurs existants (pitch / azimut) : l'utilisateur peut déjà superposer à la
  main. Rien n'est appliqué automatiquement.

### P2 — Calage assisté (clics)

* Mode **« Repères relief »** : l'utilisateur clique **2 à 3 repères de la silhouette** sur la photo
  (sommet, col, épaule). Le clic est **accroché** à la frontière ciel/obstacle du masque dans la
  colonne correspondante si elle existe.
* **Ajustement** par moindres carrés pondérés (Gauss-Newton, dérivées numériques) sur
  **(inclinaison, roulis)** — et sur **(inclinaison, roulis, azimut)** si au moins 3 repères couvrent
  plus de 30° d'azimut. Résidu `r_i = altitude observée − altitude prédite par le MNT`.
* **Pondération** `w = clamp(d_crête/2 km, 0,25, 1)` : la crête lointaine fait foi.
* **Rejet** : un repère dont l'observé est sous le prédit de plus de 2σ est écarté (cas physiquement
  impossible = erreur de pointage), puis un second passage.
* **Résultat** affiché : `Δpitch`, `Δroulis`, `n` repères, résidu RMS, distance moyenne des crêtes,
  et mention explicite si le calage est **mal conditionné** (repères trop groupés en azimut →
  le roulis ou l'azimut ne sont pas identifiables). Application **sur validation** uniquement
  (bouton « Appliquer au calibrage »), comme pour les propositions XMP.

## 5. Architecture

| Élément | Emplacement |
|---|---|
| `demCurvatureDrop(d)`, `demTerrainAngle(d, zT, zCam)`, `demSkylineFromSamples()`, `demInterp(profile, az)`, `fitPoseToSkyline()` | bloc `// ==MATH-BEGIN==` (fonctions **pures**, testables sans navigateur) |
| `demFetch()` (appel IGN), UI, tracés photo + diagramme, mode de clic | code applicatif |
| Métadonnées exportées | JSON/CSV : source, `z_sol`, `h`, `z_caméra`, pas d'azimut, résidu, état du calage |

## 6. Tests

| Test | Nature |
|---|---|
| `tests/test_dem.mjs` — math pure : courbure, angle, profil (dont l'effet de la réfraction), interpolation circulaire | hors ligne, déterministe |
| **MNT synthétique** : profil inventé → clics générés pour un pitch/roulis connus → l'ajustement doit les retrouver à **< 0,05°** | hors ligne, déterministe |
| **Fixture API réelle** (réponse enregistrée) : parsing `zonly`, ordre des valeurs, nombre de points | hors ligne |
| Appel réel IGN | opt-in `DEM_LIVE=1` uniquement |
| Non-régression photo réelle | `photo_exemple.jpg` reste testée hors ligne (aucun appel réseau dans la campagne) |

## 7. Limites assumées

* **Le proche (< 100 m) n'est pas dans le MNT** : garde-corps, haies, toits restent à la photo.
* **Couvert forestier** : le MNT (sol nu) sous-estime la crête ; biais divisé par la distance
  (0,19° à 7,6 km). Compensable plus tard par le MNS LiDAR HD.
* **Silhouette lisse** : le FOV n'est pas identifiable → la focale EXIF reste la référence
  (hors périmètre P1/P2 de toute façon).
* **Dépendance réseau** : activée par un clic explicite, coordonnées transmises à l'IGN
  (affichées avant l'envoi) ; l'outil reste pleinement utilisable sans.
* **Qualité de l'extraction** : le calage dépend de la frontière ciel/obstacle du masque (détection
  automatique + pinceaux) — d'où l'intérêt des clics manuels (P2) plutôt que d'un appariement
  automatique.

## 8. Hors périmètre (pour mémoire)

* **P3** — ajustement automatique du pitch sur la frontière détectée, sans clics.
* **P4** — ajustement joint (pitch, roulis, azimut, focale) avec test de conditionnement.
* **P5** — **masque hybride** : remplissage des directions hors champ par le MNT (loin) puis par le
  **MNS LiDAR HD 0,5 m** (près, bâtiments et arbres), avec une troisième catégorie de cellules
  « calculée » et des métriques séparées. C'est le gain de qualité de simulation le plus fort, mais
  il change la sémantique de la grille et des indicateurs.
* Appariement automatique de sommets, FOV lu sur le relief, Terrarium mondial (CORS vérifié, non retenu).

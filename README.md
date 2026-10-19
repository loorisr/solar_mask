# Masque solaire à partir d'une photo de fenêtre

Outil autonome (un seul fichier HTML, aucune installation, aucun envoi réseau) qui transforme une
**photo prise à la fenêtre** en **masque solaire** exploitable en simulation thermique :
grille azimut × hauteur solaire du taux d'ouverture au ciel, diagramme, et série horaire d'ombrage
type EnergyPlus.

```
masque_solaire.html      <- l'outil (à ouvrir dans Firefox / Chrome / Edge)
README.md                <- ce document
PLAN_relief_MNT.md       <- plan détaillé du calage sur le relief (MNT IGN)
tests/                   <- campagne de tests (Node + navigateur)
```

## Démarrage rapide

1. Ouvrir `masque_solaire.html` dans un navigateur (double-clic).
2. Cliquer **Image de démonstration** pour voir la chaîne complète fonctionner, ou **Charger une photo…**
   (glisser-déposer accepté).
3. Suivre les sections du panneau de droite : **1** photo & objectif → **2** calibrage géométrique →
   **3** masque ciel/obstacles → **4** lieu & position du soleil → **5** résultats & exports ;
   **6** relief (MNT IGN) est un calage optionnel par réseau, **7** documente la méthode et les limites.

Le calibrage de la section 2 est la seule étape vraiment indispensable : la ligne d'horizon fixe
l'inclinaison et le roulis. Si l'horizon vrai n'est pas visible sur la photo (colline, bâtiments),
utilisez soit la **saisie manuelle** de l'inclinaison, soit le **relief (section 6)** qui mesure
l'inclinaison en comparant la silhouette du terrain à celle prédite depuis votre position GPS.

## Protocole de prise de vue

La qualité du masque dépend d'abord de la photo.

1. Se placer **le plus près possible du vitrage**, au centre de la fenêtre, à hauteur d'usage
   (la parallaxe est la principale source d'erreur).
2. Garder l'axe de l'objectif **perpendiculaire à la façade**, l'appareil aussi **vertical** que
   possible — l'outil corrige ensuite le roulis et l'inclinaison, mais mieux vaut partir droit.
3. Utiliser l'objectif le plus **large** disponible (0,5× sur téléphone : ~106° de champ horizontal).
4. Cadrer si possible la **ligne d'horizon réelle** (elle sert de référence d'altitude 0°).
5. Penser aux masques **hors champ** (auvent juste au-dessus, débord latéral) : soit en faire une
   seconde photo, soit cocher « hors photo = masquées » pour rester conservateur.
6. Prendre la photo par temps **couvert** ou avec un ciel bleu franc : la détection automatique du ciel
   est bien plus fiable que par ciel nuageux contrasté.

## Calibrage

| Paramètre | Comment le renseigner |
|---|---|
| Champ de vision | Lu automatiquement dans l'**EXIF** (focale équivalente 35 mm du téléphone). Sinon curseur ou boutons 0,5× / 1× / 2× / 3×. |
| Inclinaison (pitch) et roulis (roll) | Cliquer-glisser sur la **ligne d'horizon réelle** (2 points suffisent). Si l'horizon n'est pas visible, cocher « saisie manuelle ». Cette position *est* la mesure : la ligne par défaut, au centre vertical de l'image, correspond à un appareil d'aplomb (inclinaison 0°) — elle ne fait que refléter une hypothèse, pas la réalité de la photo. |
| Azimut | Azimut du **centre optique**, c'est-à-dire en pratique l'azimut de la normale à la façade (0 = Nord, 90 = Est, 180 = Sud, 270 = Ouest). |

Contrôle visuel : la **grille az/alt** projetée sur la photo doit faire coïncider sa ligne de
hauteur 0° avec l'horizon, et les courses du soleil (courbes orange) doivent passer par les zones
attendues. Le curseur affiche en permanence l'azimut et la hauteur sous la souris.

## Paramètres lus automatiquement dans la photo (EXIF)

Au chargement, l'outil lit et applique ce qu'il trouve, et affiche en clair ce qu'il a utilisé :

| Donnée | Tag EXIF | Usage |
|---|---|---|
| Focale équivalente 35 mm | `FocalLengthIn35mmFilm` | fixe le champ de vision (donc toute la projection) |
| Coordonnées GPS, altitude, précision | `GPSLatitude`/`GPSLongitude`, `GPSAltitude`, `GPSHPositioningError` | latitude/longitude du calcul solaire |
| Décalage horaire | `OffsetTimeOriginal` (EXIF 2.31), sinon heure locale − heure UTC GPS | fuseau horaire ; un lien propose la correction « heure d'été → heure standard » attendue par EnergyPlus |
| Date et heure de prise de vue | `DateTimeOriginal` | place le marqueur soleil à l'instant de la photo (contrôle visuel des ombres réelles) |
| Cap de l'appareil (boussole) | `GPSImgDirection` + `GPSImgDirectionRef` | pré-remplit l'azimut ; signalé comme **magnétique** s'il l'est (ajouter la déclinaison locale) |
| Appareil et objectif | `Make`, `Model`, `LensModel` | traçabilité dans le résumé et les exports |
| Zoom numérique | `DigitalZoomRatio` | avertit si le champ réel est plus étroit que la focale optique, avec correction en un clic |
| Orientation déclarée | `Orientation`, `ExifImageWidth/Height` | vérifie que le navigateur a bien pivoté l'image |
| Photosphère 360° (XMP) | `GPano:ProjectionType`, `PoseHeadingDegrees`, `PosePitchDegrees`, `PoseRollDegrees`, `CroppedArea*` | bascule automatique en projection équirectangulaire, cap au Nord **vrai**, étendue azimutale et plage de hauteur du panorama |
| Drone (XMP) | `drone-dji:GimbalYawDegree`, `GimbalPitchDegree`, `GimbalRollDegree` | cap au Nord vrai ; inclinaison/roulis **proposés** (bouton « utiliser ces valeurs ») |
| Inclinaison / roulis de l'appareil | *(absent de l'EXIF standard)* — voir les cas XMP ci-dessus | le calibrage reste la référence : ligne d'horizon, ou saisie manuelle |

Limites à connaître : le cap de l'appareil n'est **pas** l'azimut de la façade si la photo n'a pas été
prise perpendiculairement à la fenêtre, et il peut être magnétique (les valeurs XMP GPano/DJI, elles,
sont au Nord vrai). L'EXIF standard ne contient **pas** l'inclinaison ni le roulis : ils ne viennent
que de l'XMP (photosphère, drone) ou du fabricant — et restent dans ce cas **proposés**, jamais imposés :
c'est la ligne d'horizon qui fait foi. Sur iPhone, le vecteur d'accélération
(`MakerNotes:AccelerationVector`) est présent mais sa convention de signes n'est pas documentée par
Apple : il est signalé, pas converti automatiquement.

## Masque ciel / obstacles

La **ligne d'horizon par défaut est au centre vertical de l'image** : elle traduit l'hypothèse
« appareil d'aplomb » (inclinaison 0°), en accord avec le protocole de prise de vue et avec le mode
de saisie manuelle. Elle reste à déplacer sur l'horizon réel — sa position *est* la mesure de
l'inclinaison, donc un défaut mal placé fausserait tout le masque (≈ 5° d'erreur pour un objectif
standard, ≈ 16° pour un ultra grand-angle si la ligne restait à 60 % de la hauteur).

* **Détection auto** : score combiné bleuité / luminosité / saturation, puis remplissage à partir du
  haut de l'image (hystérésis). Le seuil est réglable en direct.
* **Calque ciel** : le ciel détecté est voilé en **bleu translucide hachuré** — les hachures restent
  lisibles même sur un ciel bleu, où un simple voile bleu se confondrait avec la photo.
* **Pinceau ciel / obstacle** : corrections à la main (toitures sombres, nuages clairs, cadre de
  fenêtre, garde-corps, haies…).
* **Gomme** : efface la retouche et rend la main à la **détection automatique** — elle annule aussi
  bien du ciel ajouté que de l'obstacle forcé (le curseur est un cercle pointillé clair).
  « Annuler » remonte l'historique des coups de pinceau, « Effacer pinceau » remet tout à zéro.
* **Exclure la bordure** : si le cadre de la fenêtre apparaît sur la photo, mettre 3–8 % : le liseré
  est alors compté comme masquant (ce qui est physiquement correct : il masque bien ces directions).
* **Directions hors photo** : le demi-ciel n'est jamais entièrement couvert par une photo
  (sauf fisheye). Deux politiques : *dégagées (100 %)* — hypothèse optimiste, ou *masquées (0 %)* —
  hypothèse conservatrice. Le diagramme hachure ces directions et indique la valeur supposée.

## Calage sur le relief (MNT IGN) — optionnel, par réseau

Une photo prise depuis une fenêtre peut n'offrir **aucun horizon vrai** (une colline le cache : c'est le
cas de l'exemple `photo_exemple.jpg`). Le relief lui-même donne alors la référence absolue d'altitude :
l'outil prédit la **silhouette du terrain** depuis votre position GPS et la compare à la photo.

* **Source unique : service altimétrique de l'IGN** (`data.geopf.fr`, RGE ALTI, NGF-IGN69), appelé
  **uniquement sur clic** et après confirmation ; seules vos coordonnées sont transmises (elles sont
  affichées avant l'envoi). Aucune donnée n'est envoyée sans action de votre part, et l'outil reste
  pleinement utilisable hors ligne.
* **Hauteur de prise de vue** : le sol est lu au MNT à votre position, la caméra est placée
  `sol + hauteur au-dessus du sol` (5 m par défaut, réglable). L'altitude EXIF **n'est pas utilisée**
  comme référence : elle est ellipsoïdale (51 m d'écart géoïdal sur l'exemple) — l'outil affiche cet
  écart pour mémoire.
* **Profil** : un appel POST (~2 400 points, ~3 s) donne 72 azimuts × 34 échantillons radiaux en
  progression logarithmique de 30 m à 25 km, avec correction de courbure terrestre et de réfraction.
  La **distance de la crête** est conservée : elle sert à pondérer (une crête à 7 km est fiable à
  0,2°, contre 1,4° à 1 km à cause du couvert forestier absent du MNT).
* **Tracé** de la silhouette prédite sur la photo **et** sur le diagramme : **trait plein** = crête
  lointaine (> 1,5 km, fiable à ~0,2°), **pointillés** = crête proche (indicative : le MNT ignore
  arbres et bâtiments). Les deux tracés portent un **liseré sombre** : la silhouette reste lisible
  quelle que soit la photo (ciel clair, ciel bleu, feuillage, toiture sombre).
* **Calage assisté (P2)** : pointez 2 à 3 **repères de la silhouette** (sommet, col, épaule) — le clic
  s'accroche à la frontière ciel/obstacle — puis « Ajuster ». L'ajustement (moindres carrés
  pondérés + **RANSAC** sur les combinaisons de repères) écarte les pointages aberrants et donne
  **inclinaison, roulis** (+ azimut si demandé et si ≥ 4 repères étalés), avec le **résidu RMS** et
  les **incertitudes** des paramètres ; un calage mal conditionné est signalé. Rien n'est appliqué
  sans validation.

Mesuré sur `photo_exemple.jpg` (crêtes à 5-9 km) : inclinaison **−2,0°**, roulis 0°, résidu 0,5-1,6° selon
les repères, ce qui confirme la position de l'appareil et remplace l'hypothèse « appareil d'aplomb ».

Limites : le MNT ne contient ni arbres ni bâtiments (le proche reste le travail de la photo), et
l'azimut n'est identifiable que si les repères sont étalés. Détail complet : `PLAN_relief_MNT.md`.

## Diagramme du masque

Le diagramme azimut × hauteur se lit en deux modes (boutons au-dessus du graphique) :

* **Ouverture du ciel (%)** — échelle de couleur du type « plasma » : indigo sombre = masqué,
  jaune vif = 100 % ouvert, hachures = directions hors du champ de la photo.
* **Photo dépliée** — la photo elle-même, reprojetée dans le plan azimut × hauteur : on voit
  physiquement ce qui masque chaque direction (toits, arbres, colline), avec les courses du soleil
  superposées. Le rendu est mis en cache : le pinceau reste instantané.

## Résultats

| Sortie | Contenu |
|---|---|
| `masque_solaire.csv` | Matrice du **taux d'ouverture au ciel** (%) : lignes = hauteur solaire, colonnes = azimut. En-tête documentant le calibrage. Option « CSV Excel FR » (`;` + virgule décimale). |
| `masque_solaire.json` | Tout : paramètres optiques, calibrage, lieu, matrice, couverture et booléen « couvert/hors photo », métriques, moyennes mensuelles. |
| `diagramme_masque.png` | Diagramme du masque (azimut × hauteur) avec les 12 courses du soleil, les heures, le marqueur date/heure et la légende. |
| `photo_masque.png` | Photo annotée (ciel détecté, grille az/alt, courses du soleil). Utile pour un rapport ou une vérification. |
| `ombrage_8760.csv` | **Série horaire annuelle** (8760 h, ou 8784 h en année bissextile), en **heure locale standard** (sans heure d'été, convention EnergyPlus) : colonne 1 = ouverture au ciel (1 = soleil visible), colonne 2 = ombrage (1 = masqué). |
| `soleil_horaire.csv` | Détail du calcul : jour, heure, azimut, hauteur, ouverture — pour vérifier ou recalculer. |
| `masque_energyplus.idf` | Bloc `ScheduleTypeLimits` + deux `Schedule:File` prêts à coller, avec la notice d'usage. |

Indicateurs affichés : **part du demi-ciel couverte par la photo** (%), **facteur de vue du ciel**
sur la zone couverte et sur le demi-ciel complet estimé (%), tableau mensuel des heures de soleil /
heures non masquées / ouverture moyenne.

## Dessous de la méthode

Deux projections au choix : **rectiligne** (photo normale, ci-dessous) et **équirectangulaire**
(photosphère 360°, activée automatiquement si l'XMP l'indique) où chaque pixel est simplement
`az = azGauche + x/L · 360°` et `haut = 90° − y/H · 180°` — le demi-ciel entier est couvert et
l'horizon est la ligne médiane de l'image, sans aucun calibrage.

1. **Modèle sténopé.** Chaque pixel est converti en direction par
   `d = (X, Y, f)` dans le repère caméra, puis ramené dans le repère monde (Est, Nord, Haut) après
   dé-roulis `ψ` et inclinaison `P` :
   `X' = X cos ψ + Y sin ψ`, `Y' = −X sin ψ + Y cos ψ`, avec `f = (L/2)/tan(FOV/2)`.
   `P` et `ψ` sont déduits de la ligne d'horizon tracée sur la photo : `P = atan(d_⊥/f)` où `d_⊥` est la
   distance perpendiculaire signée du centre optique à la ligne (l'ordre des deux points cliqués est
   sans effet).
2. **Classification** ciel / obstacle sur les pixels, avec l'hystérésis et les corrections au pinceau.
3. **Grille de masque** : chaque pixel est rangé dans la cellule (azimut, hauteur) de sa direction ;
   l'ouverture d'une cellule est la part de pixels « ciel ». Métriques par intégration en angle solide
   `dΩ = Δaz · d(sin alt)`, ce qui garantit `Σ dΩ = 2π sr` sur le demi-ciel quelle que soit la finesse.
4. **Position du soleil** : algorithmes NOAA (déclinaison + équation du temps, précision ~0,1°),
   puis échantillonnage bilinéaire de la grille pour produire la série horaire.
5. **Relief (MNT)** : pour chaque azimut, la crête vue depuis la caméra est le maximum de
   `atan2((z_terrain − z_caméra) − d²·(1−k)/(2R), d)` le long du profil radial (courbure terrestre et
   réfraction, `k = 0,13`) ; on retient aussi la distance de la crête, qui pondère l'ajustement. Le
   calage cherche `(inclinaison, roulis [, azimut])` minimisant l'écart entre les repères pointés et
   cette silhouette, par moindres carrés pondérés avec **RANSAC exhaustif** (peu de repères) et
   incertitudes issues de `σ²·(JᵗWJ)⁻¹`.

Validations effectuées : courses du soleil (solstice/équinoxe, hémisphère nord et sud), projection
et projection inverse (erreur < 1e-6°), cohérence du calibrage d'horizon (un point sur l'horizon
donne toujours hauteur 0, quel que soit le roulis), somme des angles solides = 2π sr, lecture EXIF et
XMP (blocs fabriqués pour les tests), **récupération d'une inclinaison/roulis connus sur un MNT
synthétique (0,05°)**, chaîne complète sur une scène de synthèse (bâtiment à gauche, arbre à droite,
façade sud), et recette sur un JPEG réel — photo réelle, où le calage au MNT retrouve
l'inclinaison de l'appareil (−2,0°).

## Utilisation en simulation

* **EnergyPlus** : le plus simple est `WindowShadingControl` avec
  `Shading Control Type = OnIfScheduleAllows` et la schedule `MasqueSolaire_Ombrage` (colonne 2) :
  l'écran est actif quand le soleil est masqué, avec la transmittance de l'écran externe comme degré
  de liberté. Pour un facteur **continu** (recommandé pour un masque partiel), utiliser
  `MasqueSolaire_Ouverture` (colonne 1) via EMS, ou appliquer la série dans le post-traitement.
* **Pleiades / TRNSYS / STD interne** : la matrice `masque_solaire.csv` (taux d'ouverture par cellule
  azimut × hauteur) est directement réutilisable comme masque solaire ; le `masque_solaire.json`
  contient la même information avec les métadonnées de calibrage.
* **Tableur** : `soleil_horaire.csv` permet de recalculer n'importe quel indicateur (ensoleillement
  utile, apports par orientation, période de chauffage) en joignant un fichier météo horaire.

## Dépendances

L'outil (`masque_solaire.html`) n'utilise **aucune bibliothèque** : HTML/CSS/JavaScript standard,
aucun CDN, aucun `npm install`, tout fonctionne hors ligne. Les tests n'utilisent que les modules
intégrés de Node.js et un navigateur Chromium/Chrome déjà installé.

## Tests

```bash
./tests/run_all.sh              # toute la campagne (hors ligne)
node tests/test_math.mjs        # géométrie, astronomie, relief (sans navigateur)
node tests/test_dem_live.mjs    # calage relief avec l'API IGN réelle (réseau requis)
```

254 vérifications au total (76 + 57 + 56 + 27 + 38), plus 11 en validation réseau : position du soleil, projection sténopé et
équirectangulaire, calibrage par l'horizon, angles solides, lecture EXIF **et XMP** (blocs fabriqués
spécialement : GPS, cap boussole, offset horaire, zoom numérique, orientation, photosphère GPano,
gimbal DJI), chaîne complète sur scène de synthèse, **relief** (MNT synthétique où l'ajustement doit retrouver un pitch/roulis
connus, fixture d'une réponse IGN réelle), et recette sur une photo réelle — cette dernière écrit dans `tests/.build/`
le masque JSON, le diagramme PNG et la photo annotée. Détails dans `tests/README.md`.

## Limites

* Modèle **sans distorsion** : les objectifs très grand-angle ont une distorsion en barillet ;
  l'erreur est surtout sensible en bord d'image (rester prudent sur 0,5×, calibrer l'horizon au centre).
* La photo ne couvre qu'une partie du demi-ciel : au-delà du champ de l'objectif, les directions
  reçoivent la valeur « hors photo » choisie.
* Le **cadre et le tableau** de fenêtre visibles sur la photo comptent comme directions masquées :
  c'est correct si le point de calcul est à l'endroit de la prise de vue (bord de vitrage).
* Série horaire purement **géométrique** : elle ne contient aucune donnée météo (pas de nébulosité) ;
  c'est bien un facteur d'ombrage, à croiser avec un fichier météo.
* La conversion « focale EXIF → champ de vision » suppose une équivalence 35 mm diagonale classique :
  à vérifier sur les téléphones à capteur inhabituel.
* **Relief (MNT)** : modèle de *sol nu* (ni arbres ni bâtiments) → il ne cale que la crête lointaine
  (> 1 km) ; l'azimut n'y est identifiable qu'avec des repères bien étalés, et le module nécessite le
  réseau (activé par un clic, coordonnées transmises à l'IGN).
* **Altitude** : celle de l'EXIF est *ellipsoïdale* (WGS84) alors que les MNT sont orthométriques
  (NGF-IGN69) — sur l'exemple fourni, 51 m d'écart. L'outil n'utilise donc jamais l'altitude EXIF comme
  référence : il part du sol lu au MNT et d'une hauteur de prise de vue.

# Tests de `masque_solaire.html`

Toute la campagne s'exécute en local, **sans aucune bibliothèque externe** :
uniquement les modules intégrés de Node.js (`node:fs`, `node:http`, `node:path`,
`node:child_process`, `node:url`) et un navigateur Chromium/Chrome présent sur la machine.
Aucun `npm install`, aucun `package.json`, aucun accès réseau.

```bash
./tests/run_all.sh                 # toute la campagne (détecte la photo du dossier)
./tests/run_all.sh ma_photo.jpg    # en imposant la photo
# ou test par test :
node tests/test_math.mjs
node tests/test_pipeline.mjs
node tests/test_exif.mjs
node tests/test_photo_reelle.mjs [photo.jpg]
```

Prérequis : **Node.js ≥ 20** et **chromium** (ou `CHROME=/chemin/vers/chromium`).

## Les fichiers

| Fichier | Rôle |
|---|---|
| `harness.mjs` | Outils communs : recherche du navigateur, génération d'une copie de l'appli avec scénario, exécution headless, construction d'un bloc EXIF complet, scène de synthèse. |
| `test_math.mjs` | **Sans navigateur.** Extrait le bloc `// ==MATH-BEGIN== … ==MATH-END==` de l'appli et vérifie : position du soleil (NOAA), projections **sténopé et équirectangulaire** et leurs réciproques, calibrage par la ligne d'horizon, angles solides de la grille, échantillonnage bilinéaire, analyse EXIF pure (décalages horaires, orientations), échelle de couleur du masque, **hachures du calque ciel** (période adaptée à la largeur de l'image, bandes diagonales régulières, taux de couverture conforme). **76 tests.** |
| `test_pipeline.mjs` | **Navigateur + temps virtuel.** Chaîne complète sur une scène de synthèse (immeuble à gauche, arbre à droite, façade sud) : détection du ciel, masque, sondes de directions, série 8760, exports, pinceaux, **gomme** (retour à la détection automatique), **calque ciel hachuré** (traits clairs + fond bleu), annulation, pas de grille, **diagramme en mode photo** (la couleur reproduite doit venir de la bonne direction), **horizon par défaut au centre vertical** (inclinaison nulle), **photosphère équirectangulaire synthétique** (couverture du demi-ciel = 100 %, obstacle factice détecté), et **continuité du tracé de la silhouette MNT** (tracée jusqu'aux deux bords du champ, contraste minimal du trait, pas de trou hors pointillés — la régression « le calcul ne le fait pas partout »). **57 tests.** |
| `test_exif.mjs` | **Navigateur.** Fabrique des JPEG (canvas) complétés par des blocs EXIF générés côté Node, puis vérifie : focale 35 mm, GPS + altitude + précision, cap boussole (vrai/magnétique), `OffsetTimeOriginal` vs déduction par l'heure GPS, date de prise de vue, zoom numérique et correction du champ, contrôle d'orientation, et le **contenu** des exports (JSON, CSV 8760), plus les **XMP** : photosphère GPano (bascule de projection, panorama recadré, cap vrai) et gimbal DJI (cap vrai, inclinaison proposée puis appliquée au clic). **56 tests.** |
| `test_dem.mjs` | **Sans navigateur.** Courbure/réfraction, angle de terrain, silhouette, interpolation circulaire, puis **calage sur un MNT synthétique** (les paramètres connus doivent être retrouvés à 0,05°), rejet d'un repère aberrant, dégénérescence diagnostiquée, et parsing d'une **fixture d'une réponse IGN réelle** (`tests/fixtures/`). **27 tests.** |
| `test_dem_live.mjs` | **Réseau requis**, hors campagne : appelle réellement l'API IGN sur la photo du dossier, pose les repères automatiquement sur la frontière ciel/obstacle, ajuste et applique. |
| `test_photo_reelle.mjs` | **Navigateur.** Charge la photo du dossier (par défaut la plus récente), lit ses EXIF, calcule le masque, contrôle des sondes de pixels choisies dans la scène, puis écrit le résultat dans `tests/.build/`. **38 tests.** |
| `run_all.sh` | Enchaîne les cinq suites hors ligne (le module relief IGN compris). |
| `fixtures/ign_elevation_reponse.json` | Réponse réelle de l'API altimétrique IGN (2 449 points) sur un **point public**, enregistrée pour tester hors ligne. |

## Sorties de `test_photo_reelle.mjs`

Dans `tests/.build/` (dossier de travail, recréé à la demande) :

* `<photo>_masque.json` — masque complet avec métadonnées et bloc EXIF ;
* `<photo>_diagramme.png` — diagramme azimut × hauteur (taux d'ouverture), courses du soleil superposées ;
* `<photo>_diagramme_photo.png` — le même diagramme en mode « photo dépliée » ;
* `<photo>_photo_annotee.jpg` — photo avec le ciel détecté, la grille az/alt et les courses du soleil ;
* `test_*.html` — copies de l'appli utilisées pour les tests (avec le scénario injecté).

## Notes

* Les tests n'écrivent jamais dans `masque_solaire.html` : ils en génèrent des copies.
* Les captures d'écran et les mesures « temps virtuel » de Chromium ne sont utilisées que
  pour le scénario de synthèse ; les tests avec de vrais fichiers (décodage JPEG) passent par
  un petit serveur HTTP local (port 8765-8767) que la page appelle en fin de scénario.
* Le test de photo réelle est facultatif : sans photo dans le dossier, il s'arrête proprement.

## Confidentialité

* Une photo de test reste **locale** : elle contient des métadonnées (position GPS, appareil,
  horodatage) et peut montrer un lieu privé. Ne jamais la committer (`tests/.build/` et les photos
  à la racine sont ignorés par `.gitignore`) ni la diffuser telle quelle.
* Avant de partager une photo d'exemple, la nettoyer : `exiftool -all= photo.jpg`.

#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Campagne de tests complète de masque_solaire.html
#   ./tests/run_all.sh [chemin/photo.jpg]
# Prérequis : Node.js >= 20 et un navigateur Chromium/Chrome (ou CHROME=...)
# ---------------------------------------------------------------------------
set -e
cd "$(dirname "$0")"

PHOTO="$1"

echo
echo "========================================================="
echo " 1/5  Géométrie, astronomie, relief (Node pur, sans navigateur)"
echo "========================================================="
node test_math.mjs

echo
echo "========================================================="
echo " 2/5  Pipeline complet sur scène de synthèse"
echo "========================================================="
node test_pipeline.mjs

echo
echo "========================================================="
echo " 3/5  Chargement de fichiers JPEG, EXIF et XMP"
echo "========================================================="
node test_exif.mjs

echo
echo "========================================================="
echo " 4/5  Relief (MNT) : fonctions pures, MNT synthétique, fixture IGN"
echo "========================================================="
node test_dem.mjs

echo
echo "========================================================="
echo " 5/5  Photo réelle"
echo "========================================================="
if [ -n "$PHOTO" ]; then
  node test_photo_reelle.mjs "$PHOTO"
else
  node test_photo_reelle.mjs
fi

echo
echo "(hors campagne : ./tests/test_dem_live.mjs — validation en direct avec l'API IGN)"

echo
echo "========================================================="
echo " TOUTE LA CAMPAGNE DE TESTS EST PASSÉE"
echo "========================================================="

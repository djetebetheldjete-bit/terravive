# Journal des versions — Terravive

## v8.1 — 6 novembre 2026
- Interface sans émojis : jeu d'icônes au trait (`public/icons.js`, même style que le menu), qui suit les thèmes clair et sombre.
- Carnet de champ : sélecteur d'intervention à boutons (icône, nom, unité attendue), utilisable au clavier (flèches) et lu correctement par les lecteurs d'écran.
- Messages WhatsApp (conseil sol, alertes, bilan, fiche terrain) sans émojis.
- Bouton WhatsApp sobre (vert Terravive), dates du bilan au format français.
- Service worker v17 (met en cache `icons.js` et `voice.js`).

## v8.0 — 6 novembre 2026
**Ajouts**
- A1 — Carnet par saison (saison/campagne, produit, incident) et **bilan d'impact** par parcelle : comparaison avant/maintenant (référence saisie ou saison précédente), eau économisée, engrais évité, rendement, productivité de l'eau, carbone apporté par le compost ; export PDF et CSV ; **bilan agrégé de la coopérative** (animateur) ; indice de durabilité pré-rempli d'après le carnet.
- A2 — **Provenance de chaque chiffre** (Mesuré, Déclaré, Estimé satellite, Estimé (calcul), Hypothèse) et **fiche de preuve** imprimable à faire valider par un agronome.
- A4 — **Saisie manuelle de la station** (appareil ou test au toucher) et **fiche de collecte terrain** imprimable.
- A3 — Alertes « arroser » / « cuve presque vide » **partageables sur WhatsApp** et **lisibles à voix haute**.
- B1/B2 — Matériel partagé et achats groupés : déjà présents, vérifiés par test ; feuille de route mise à jour.

**Fichiers** : `lib/impact.js` (nouveau), `server.js`, `public/tableau.html`, `public/cooperative.html`, `schema.sql`, `public/sw.js` (v16), `test-sol.js`, docs.

**Migrations (idempotentes)** : `trv_field_log.season`, `trv_field_log.product`, `trv_readings.source`, `trv_readings.note`, table `trv_parcel_ref`.

**Compatibilité** : sans migration, le carnet et la saisie manuelle s'enregistrent quand même (sans saison, produit ni origine) avec un avertissement ; le reste de l'application est inchangé.

## v7.9 — 6 novembre 2026
- Fiche pratique terrain générée avec l'itinéraire (calendrier à cocher, quantités, surveillance, sécurité, matériel), impression A4, WhatsApp. Colonne `trv_plans.fiche`.

## v7.8 — 6 novembre 2026
- Plan de fertilisation organique (compost, chaux, N-P-K) calculé pour la parcelle ; envoi du conseil sur WhatsApp ; carnet de champ (table `trv_field_log`).

## v7.7 et avant
- Voir `FEUILLE-DE-ROUTE.md` (section « Déjà en place »).

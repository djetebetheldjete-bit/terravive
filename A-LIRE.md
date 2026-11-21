# Terravive — à lire

Le code en place dans ce dépôt est la version à jour (voir `CHANGELOG.md`, dernière entrée).
Il n'y a plus de dossier « fichiers à recopier » : chaque modification est faite directement
dans le dépôt, et un `git push` déclenche le redéploiement Render habituel.

## Vérifier avant de mettre en ligne
```bash
npm test
```
Toutes les suites doivent afficher « SUCCÈS ». Les mêmes tests tournent automatiquement sur
GitHub à chaque envoi (onglet « Actions »).

## Repères
- Vue planteur : `/planteur` (connexion par téléphone + code PIN).
- Espace complet : `/tableau`. Coopérative : `/cooperative`. Tutoriels : `/formation`.
- Captures d'écran : `docs/captures/`.
- Guides : `docs/SOL-ET-STATION.md`, `docs/MOBILE.md`, `docs/stock/`.

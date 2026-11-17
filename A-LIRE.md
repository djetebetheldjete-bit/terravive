# Terravive v8.9 — Vue planteur

## Ce qui a été ajouté
Une interface simplifiée dédiée au planteur/cultivateur, à l'adresse **`/planteur`**, séparée de
l'espace technique complet. Elle montre ses parcelles et, pour chacune, **ce qu'il y a à faire
aujourd'hui** — à partir des vraies tâches déjà calculées par l'application (fiche de culture +
date de semis). Rien n'est inventé.

## Fichiers (dans `fichiers-modifies/`, mêmes chemins que le dépôt)
- `public/planteur.html` — **nouveau** : la page.
- `server.js` — 2 lignes : route `/planteur` + page fermée aux comptes « client ».
- `public/sw.js` — service worker v29 (ajoute `/planteur` au cache hors-ligne).
- `public/tableau.html` — lien « Vue planteur » dans les raccourcis.
- `test/test-http.js` — 2 tests de bout en bout.
- `CHANGELOG.md` — note de version.

## Pour mettre en ligne (GitHub → Render)
Remplacez ces 6 fichiers dans votre dépôt par ceux de `fichiers-modifies/`, en gardant les
chemins. Un `git commit` + `git push` déclenche le redéploiement Render habituel. Aucune
modification de base de données n'est nécessaire.

## Vérifié
- `npm test` : 75 tests réussis (dont la nouvelle page et les contrôles d'accès).
- Rendu visuel conforme (couleurs, logo, icônes, ton) — voir les 3 aperçus joints.

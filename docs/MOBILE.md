# Terravive — couche mobile (v1)

Deux fichiers ajoutés dans `public/` et chargés par toutes les pages : `mobile.css` et `mobile.js`.
Ils ne s'activent que sur écran ≤ 860 px : l'affichage ordinateur est strictement inchangé
(vérifié pixel par pixel sur les 11 pages).

## Ce qui change sur téléphone
- Barre de navigation basse (zone du pouce) : Tableau · Itinéraire · Conseiller · Diagnostic · Plus.
- Feuille « Plus » : Coopérative, Comprendre, Capteurs, Boutique, Stock / Qualité (selon le rôle), compte, thème, déconnexion.
- Page Stock : la barre latérale devient une barre basse (Accueil · Produits · Récoltes · Ventes · Plus).
- Barre du haut compacte (logo + titre de la page) ; le secondaire quitte la barre.
- Accueil publique : bouton collant « Créer mon plan » + « Se connecter ».
- Tableaux → cartes lisibles (plus de défilement horizontal).
- Champs 16 px (pas de zoom iOS), cibles ≥ 44 px, fenêtres modales en feuilles basses.
- La barre se range au défilement vers le bas et quand le clavier est ouvert.
- Respecte les 4 thèmes (nature / clair / sombre / terre) et `prefers-reduced-motion`.

## Fichiers modifiés
`public/*.html` (1 ligne CSS + 1 ligne JS ajoutées avant `</head>`, `viewport-fit=cover`),
`public/sw.js` (version `terravive-v3` + mise en cache de `mobile.css`/`mobile.js`).

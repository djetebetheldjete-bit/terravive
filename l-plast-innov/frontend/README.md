# Frontend web — L-PLAST-INNOV (administration)

Plateforme d'administration : React + TypeScript + Tailwind + Leaflet + Recharts.

## Démarrage

```bash
cd frontend
npm install
cp .env.example .env     # laisser VITE_API_BASE vide pour le proxy /api
npm run dev              # http://localhost:5173  (proxy /api → http://localhost:8000)
```

Le backend doit tourner en parallèle (`uvicorn app.main:app --reload`).

Connexion de démonstration : `admin@l-plast-innov.ci` + le mot de passe du `.env` backend.

## Pages

- **Tableau de bord** : chiffres clés (présents / nouveaux / retirés / détections),
  évolution 14 jours, répartition par catégorie.
- **Carte** : zones colorées par niveau de pollution (Leaflet), caméras.
- **Zones** : états, seuils modifiables (admin), injection de déchets de démo.
- **Caméras** : liste et état des CamSCA.
- **Alertes** : filtres, prise en compte.
- **Nettoyage** : création d'intervention, vérification (retrait confirmé).
- **Utilisateurs** : gestion des rôles (admin).
- **Rapports** : synthèse par période, export CSV et impression PDF.

## Build de production

```bash
npm run build      # génère dist/
npm run preview
```

## Identité visuelle

Vert (environnement), bleu (océan), blanc, orange (alerte préventive),
rouge (alerte critique). Interface en français, responsive.

# Suite de tests — générateur d'itinéraires Terravive

Tests **reproductibles**, **sans dépendance npm**, **sans vraie clé API**, **sans réseau**,
exécutables **en local**. Ils vérifient le générateur d'itinéraires techniques (ITK) sans
jamais appeler api.anthropic.com et **sans modifier le code de production**.

## Commande d'exécution

```bash
# à la racine du dépôt (le dossier qui contient server.js)
node test/run.js
```

Exécuter un bloc seul :

```bash
node test/test-deterministic.js   # tests déterministes (code réel)
node test/test-sim-ai.js          # flux avec réponse IA simulée + grille automatique
```

Si `server.js` n'est pas à la racine, indiquer son chemin :

```bash
TERRAVIVE_SERVER=/chemin/vers/server.js node test/run.js
```

Prérequis : **Node.js 18 ou plus** (aucune installation, aucun `npm install`).

## Résultats attendus

- Code de sortie **0** et bilan **SUCCÈS** quand tout passe (utilisable en CI).
- Au dernier relevé : **29 tests** (24 déterministes + 5 flux simulé), **149 vérifications**,
  toutes au vert. Le détail s'affiche test par test.
- Le **contre-exemple** (`fixtures/99_mauvais_exemple.md`) doit faire échouer plusieurs
  points de la grille : c'est voulu, cela prouve que la grille détecte réellement les
  défauts (sections manquantes, troncature, emoji, prix inventé, introduction avant ## 1).

## Comment c'est construit

```
test/
  run.js                 Lanceur : exécute tout, imprime le bilan, renvoie 0/1.
  test-deterministic.js  Tests sur le CODE RÉEL (parseArea, planUserMessage, planSystem)
                         + contrat de la route /api/plan (inspection du source).
  test-sim-ai.js         Construit les vrais messages (planSystem + planUserMessage),
                         SIMULE la réponse IA avec une fixture, puis note avec la grille.
  scenarios.js           Les 10 scénarios : entrées, ce qui doit être transmis au prompt,
                         comportements attendus, erreurs à détecter.
  fixtures/*.md          Réponses IA SIMULÉES (itinéraires de test) + 1 contre-exemple.
  lib/load-server.js     Charge le vrai server.js dans un bac à sable (vm) : http neutralisé
                         (aucun port), fetch neutralisé (aucun réseau), clé API factice.
  lib/harness.js         Micro-cadre de test (aucune dépendance).
  lib/grille-auto.js     Grille d'évaluation AUTOMATIQUE (structurelle) d'un ITK.
  GRILLE-AGRONOMIQUE.md  Grille d'évaluation HUMAINE (le fond agronomique).
```

### Pourquoi un bac à sable `vm` plutôt qu'un `require` ?

`server.js` est un fichier « zéro dépendance » qui, à la fin, crée un serveur HTTP et
appelle `server.listen(...)`. Un simple `require` ouvrirait un port et exigerait une clé.
Le chargeur (`lib/load-server.js`) exécute donc le **code source réel** dans un contexte
`vm` où `http.createServer().listen()` ne fait rien et où `fetch` ne part jamais sur le
réseau. On teste ainsi les **vraies** fonctions de production, en lecture seule, sans effet
de bord (le `__dirname` du bac à sable est un dossier temporaire jetable).

## Les 10 scénarios

| # | Scénario | Ce qui est vérifié de façon déterministe |
|---|---|---|
| 1 | Tomate à San Pedro | surface 1000 m² → 0,1 ha ; pH « non précisé » sans reproche ; mode agroécologie transmis |
| 2 | Maïs à Korhogo | surface 2 ha → 20 000 m² ; pH 6,2 transmis ; mode conventionnel |
| 3 | pH et sol inconnus | sol/pH « non précisé » ; consignes anti-invention présentes |
| 4 | Budget inconnu | contrainte transmise ; consignes « n'invente pas de prix », « tableau à compléter » |
| 5 | Climat indisponible | saison « non précisée » ; consignes calendrier conditionnel / repères relatifs |
| 6 | Mode agroécologique | mode transmis + bloc d'invite correspondant présent |
| 7 | Mode biologique | mode transmis + « AUCUN intrant chimique de synthèse » |
| 8 | Mode agriculture de conservation | mode transmis + non-labour, pas d'imposition du semis direct |
| 9 | Mode conventionnel raisonné | mode transmis + intrants justifiés, pas d'usage systématique |
| 10 | Entrées invalides / incomplètes | surface invalide → interdiction de calcul ; contrat /api/plan (400/401/429/500) |

## Contrôles déterministes (ce que le code PEUT prouver)

- **Champs requis** transmis au modèle (culture, localité, surface, sol, pH, saison, mode…).
- **Absence de valeurs inventées** dans les **données structurées** : le `record`
  enregistré n'échoit que des entrées utilisateur + le texte IA ; aucune valeur fabriquée.
- **Cohérence des unités** : conversion de surface (m²/are/ha), refus des surfaces invalides.
- **Calcul des quantités** : la consigne de calcul (dose × surface) est transmise ; une
  surface invalide interdit explicitement tout total.
- **Gestion des erreurs** : surface nulle/négative/sans unité refusée ; culture absente →
  400 ; non connecté → 401 ; clé IA absente → 500 ; quota → 429 ; JSON invalide → 400.
- **Garde-fous d'invite** (Prompts 1→5) présents : incertitudes, fiches d'action, classes
  de dose A/B/C/D, adaptation locale, disponibilité à confirmer, marge ≠ bénéfice, 18
  sections obligatoires, interdiction d'emojis, 4 modes de conduite.

## Qualité du texte généré (grille séparée)

La **grille automatique** (`lib/grille-auto.js`) note la STRUCTURE d'un itinéraire :
18 sections dans l'ordre, non-troncature, tableaux budget/calendrier, absence d'emoji,
pas de prix inventé détecté, cohérence de surface, calcul de quantité visible, interdits et
exigés par scénario.

La **grille agronomique** (`GRILLE-AGRONOMIQUE.md`) est destinée à un **humain** : c'est la
seule façon de juger l'EXACTITUDE agronomique (une dose peut être bien formée mais fausse).

## Limites de la méthode (honnêteté)

- Les tests **simulent** la réponse de l'IA (fixtures) : ils ne jugent pas la qualité du
  **vrai** modèle en production, seulement la logique autour (messages construits, structure,
  garde-fous) et la détection de défauts par la grille.
- La grille automatique peut avoir des **faux négatifs/positifs** (ex. un prix inventé sous
  une forme non reconnue passerait ; un montant légitime saisi par le producteur serait
  signalé) : elle **signale**, l'humain tranche.
- L'**exactitude agronomique** (justesse des doses, variétés réellement disponibles, seuils)
  n'est pas prouvable par le code : elle relève de la grille humaine.
- Les tests de **route** (`/api/plan`) vérifient le contrat par **inspection du source** et
  au niveau unitaire ; ils n'ouvrent pas de serveur HTTP réel (choix assumé : zéro port,
  zéro base de données, zéro clé). Un test d'intégration HTTP complet nécessiterait un
  environnement séparé avec base et faux fournisseur.

## Reproduire les tests

1. Avoir le dépôt Terravive avec `server.js` et le dossier `test/`.
2. Node.js 18+ installé.
3. Lancer `node test/run.js`.
4. Pour tester un `server.js` situé ailleurs : `TERRAVIVE_SERVER=/chemin/server.js node test/run.js`.
5. Pour étendre : ajouter un scénario dans `scenarios.js` (et, si besoin, une fixture dans
   `fixtures/`). Aucun autre fichier à toucher.

Aucune clé API, aucun accès réseau, aucune écriture dans le dépôt pendant les tests.

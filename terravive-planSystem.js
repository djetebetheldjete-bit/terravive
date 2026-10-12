// ============================================================
// TERRAVIVE — Itinéraire Technique de Culture (ITK) complet
// ------------------------------------------------------------
// REMPLACE, dans ton fichier server.js de Terravive, la fonction
// « function planSystem() { ... } » existante par celle ci-dessous.
// (Le reste du code ne change pas. La fonction utilise toujours
//  la constante DURABLE_CONTEXT déjà définie dans server.js.)
//
// Astuce coût/longueur : l'ITK complet est plus long que l'ancien plan.
// Dans ta fonction callClaude de Terravive, le plan est généré avec
// max_tokens: 4096. Si l'itinéraire se retrouve parfois coupé à la fin,
// passe ce max_tokens à 6000–8000 UNIQUEMENT pour la génération du plan.
// ============================================================

function planSystem() {
  return DURABLE_CONTEXT + `

TÂCHE : à partir des informations de la parcelle, rédige un ITINÉRAIRE TECHNIQUE DE CULTURE (ITK) COMPLET et personnalisé, en français, au format Markdown. L'ITK est la suite ORDONNÉE de toutes les opérations techniques, de la préparation de la parcelle jusqu'à l'après-récolte. Pour CHAQUE opération, précise : QUAND (période, ou stade / nombre de semaines après le semis), COMMENT (le geste concret : dose, écartement, méthode…) et POURQUOI (en une phrase simple).

Respecte EXACTEMENT ces sections (titres en ##), dans cet ordre :

## 1. Diagnostic de la parcelle
La culture visée ; la zone agro-écologique et le régime des pluies (bimodal ou monomodal) de la région, qui détermine le calendrier ; le type de sol avec ses atouts et ses risques (ex. sableux = bien drainé mais pauvre et lessivable ; argileux = retient l'eau et les éléments mais peut s'asphyxier ; limoneux = bon potentiel mais sensible à la battance) ; le pH du sol UNIQUEMENT s'il a été fourni ; le précédent cultural si connu ; et l'objectif de la personne. Déduis-en les grands choix de l'itinéraire. Si une information manque, indique clairement l'hypothèse que tu prends — et ne reproche jamais à la personne de ne pas avoir une donnée (comme le pH).

## 2. Choix de la variété et des semences
Type de variété adapté au climat local et à l'objectif (résistance aux maladies, cycle court ou long, tolérance à la chaleur ou à la sécheresse), qualité des semences (semences saines, taux de germination), et préparation éventuelle (pré-germination, traitement — en privilégiant les solutions naturelles).

## 3. Préparation du sol
Défrichage et nettoyage de la parcelle, travail du sol (labour, hersage, planage) et forme de culture (à plat, en billons, en buttes ou en planches) choisie selon le sol et le besoin de drainage. Rappelle l'intérêt d'un travail du sol limité et de la matière organique pour préserver un sol vivant, quand c'est possible.

## 4. Fumure de fond et amendement
Apports organiques avant plantation (compost, fumier bien décomposé) et leur enfouissement — ils nourrissent le sol ET tamponnent doucement le pH.
Gestion du pH : si le pH du sol est FOURNI, utilise-le — sol acide (pH inférieur à ~6) : conseille un chaulage léger (chaux agricole ou cendre de bois) pour le remonter ; sol alcalin (pH supérieur à ~7,5) : évite le chaulage et mise sur la matière organique ; pH proche de 6–7 : rien à corriger, c'est idéal. Donne les apports en FOURCHETTES.
Si le pH N'EST PAS fourni (c'est souvent le cas, et c'est NORMAL), ne bloque pas et ne l'invente pas : rappelle simplement que beaucoup de sols tropicaux sont légèrement acides, propose des moyens SIMPLES et peu coûteux de l'estimer si la personne le souhaite (plantes indicatrices, petit test maison au vinaigre et au bicarbonate, bandelettes de pH bon marché, ou une analyse de sol si elle en a la possibilité), et avance avec une approche prudente qui marche dans tous les cas : beaucoup de matière organique (elle corrige doucement l'acidité) et observation de la culture.
Donne des ordres de grandeur réalistes sous forme de FOURCHETTES, jamais de chiffres inventés précis.

## 5. Semis / plantation
Date de semis conseillée selon le régime des pluies de la région ; pépinière puis repiquage si la culture s'y prête (durée en pépinière) ; DENSITÉ et ÉCARTEMENT (distance entre les lignes et sur la ligne) ; profondeur de semis ; et un nombre indicatif de plants ou de graines pour la surface donnée.

## 6. Entretien de la culture
Démariage / éclaircissage, désherbage (sarclage manuel, paillage pour limiter les mauvaises herbes et garder l'humidité), buttage, tuteurage si nécessaire. Précise les périodes (nombre de semaines après le semis).

## 7. Fertilisation d'entretien (fertilisation raisonnée)
Raisonne la fertilisation : la BONNE dose, au BON moment, adaptée au sol, à la saison et à la variété (une même culture n'a pas les mêmes besoins sur sol pauvre ou riche, ni en saison humide ou sèche). Privilégie toujours les fumures organiques.
Si un apport minéral est nécessaire, FRACTIONNE-le (plusieurs petits apports plutôt qu'un seul gros) et relie chaque apport à un stade (reprise, pleine croissance, floraison, fructification). Pour l'AZOTE, qui est très mobile et facilement perdu : ne le mets jamais tout d'un coup, apporte-le pendant la phase de croissance, sur une parcelle PROPRE (désherbée juste avant), bien réparti, et si possible juste avant une pluie ou un arrosage pour limiter les pertes. Donne les apports en FOURCHETTES et rappelle de ne pas sur-fertiliser (gaspillage, pollution, et parfois baisse de rendement ou maladies).
Si la personne irrigue au goutte-à-goutte, propose la FERTIGATION : dissoudre un engrais soluble dans l'eau d'irrigation et l'apporter en petites quantités fréquentes, directement près des racines — c'est plus efficace et ça gaspille beaucoup moins d'engrais.

## 8. Gestion de l'eau et irrigation
Besoin en eau par stade (la culture est plus sensible à la sécheresse à certains moments, ex. floraison et formation des fruits), et rôle de la pluie face au déficit hydrique (pluie insuffisante par rapport à l'évaporation).
Si la personne N'A PAS indiqué de mode d'irrigation, ou n'en possède pas, NE SUPPOSE RIEN : PROPOSE-lui toi-même une ou plusieurs solutions ADAPTÉES À SES MOYENS, en les classant du plus simple et économique au plus avancé, et en expliquant en une ligne le coût, l'effort et l'intérêt de chacune :
- Pluvial strict (sans arrosage) : caler le calendrier sur la saison des pluies et RETENIR l'eau — paillage épais, cuvettes/poquets (type zaï), binage, demi-lunes, brise-vent, matière organique qui garde l'humidité.
- Arrosage manuel (arrosoir, seau) tôt le matin ou en soirée, alimenté par une COLLECTE d'eau de pluie (toiture + fût, bassin, citerne) pour tenir en saison sèche.
- Goutte-à-goutte « maison » très peu coûteux : bouteilles ou bidons percés près du pied, poteries enterrées (ollas) — idéal pour peu de moyens et peu de surface.
- Goutte-à-goutte ou petite aspersion avec du matériel acheté si le budget le permet : c'est le plus économe en eau et le plus régulier.
Recommande EN PRIORITÉ la solution la plus réaliste au vu de ses moyens et de la surface indiquée, puis dis vers quoi il pourra évoluer plus tard. Dans tous les cas, rappelle les gestes d'économie d'eau (paillage, arrosage aux heures fraîches) et ADAPTE le reste de l'itinéraire (date de semis, densité, choix de variété plus résistante à la sécheresse) à l'eau réellement disponible.

## 9. Protection phytosanitaire (lutte intégrée)
Principaux ravageurs et maladies de cette culture dans la région, et les signes à surveiller. Présente la protection dans CET ORDRE : d'abord la PRÉVENTION (rotation des cultures, variétés résistantes, hygiène de la parcelle, associations de cultures) ; ensuite la lutte BIOLOGIQUE et les préparations NATURELLES (ex. savon noir, extrait de neem, cendre, plantes répulsives, auxiliaires) ; et seulement EN DERNIER RECOURS un produit chimique, à dose prudente et avec les précautions d'usage. Ne donne jamais de conseil dangereux pour la santé ou l'environnement.

## 10. Suivi des stades et reconnaître les carences
Les grands stades de la culture (levée, croissance végétative, floraison, fructification/remplissage, maturité) avec, pour chacun, un repère de durée indicatif, pour que la personne sache toujours où elle en est dans le cycle.
Apprends-lui aussi à LIRE les feuilles pour repérer tôt un manque et réagir : feuilles entièrement jaunes (limbe ET nervures), sur l'ensemble de la plante → manque d'AZOTE ; plante rabougrie, feuilles vert très foncé ou violacées → manque de PHOSPHORE ; jeunes feuilles jaunes mais nervures restées vertes → manque de FER ; taches ou plages jaunes par endroits sur les vieilles feuilles → manque de CALCIUM. Invite à corriger par un apport adapté (organique de préférence) et à continuer de surveiller.

## 11. Récolte
Les signes de maturité à reconnaître, la période indicative et la méthode de récolte pour préserver la qualité et limiter les pertes.

## 12. Après-récolte
Séchage, tri, conditionnement, stockage et réduction des pertes ; et quelques pistes simples de valorisation ou de vente si c'est pertinent pour l'objectif de la personne.

## 13. Rendement attendu et repères économiques
Une FOURCHETTE réaliste de rendement (en précisant l'unité, ex. t/ha, ou une estimation sur la surface indiquée), et les bénéfices durables de l'approche (sol vivant, moins d'eau, moins de produits chimiques, meilleurs revenus dans la durée).

## 14. Calendrier récapitulatif
Un TABLEAU Markdown clair qui résume, par période (semaine par semaine ou mois par mois, à partir du semis/plantation), les opérations clés. Utilise exactement ces colonnes :
| Période | Opération | À faire concrètement |
C'est la feuille de route que la personne pourra suivre tout au long de la saison.

RÈGLES IMPORTANTES :
- Reste réaliste et honnête sur les incertitudes (climat, ravageurs, variétés réellement disponibles localement) ; n'invente jamais de chiffres précis, donne des fourchettes.
- Adapte TOUT aux moyens locaux (Côte d'Ivoire, matériaux et intrants disponibles sur place).
- Langage simple et accessible, sans jargon inutile ; quand tu emploies un terme technique, explique-le en quelques mots.
- Privilégie toujours les solutions durables et agroécologiques.
- Ne mets aucune introduction avant la première section ## 1.`;
}

// ============================================================
// 2) planUserMessage — REMPLACE ta fonction planUserMessage(p) par celle-ci.
//    (Ajoute la ligne « pH du sol », facultative. Rien d'autre ne change.)
// ============================================================
function planUserMessage(p) {
  return `Voici ma parcelle :
- Culture souhaitée : ${p.crop}
- Région / localité : ${p.region || "non précisée"}
- Surface : ${p.area || "non précisée"}
- Type de sol : ${p.soil || "non précisé"}
- pH du sol : ${p.ph ? p.ph : "non précisé (la personne n'a pas cette valeur)"}
- Saison / période de démarrage : ${p.season || "non précisée"}
- Objectif principal : ${p.goal || "produire durablement"}
- Moyens / contraintes : ${p.notes || "aucun détail supplémentaire"}

Rédige mon itinéraire technique de culture complet.`;
}

/* ============================================================
   3) handlePlan (server.js) — l'objet « clean » liste les champs transmis.
      Ajoute-y le pH (facultatif). Remplace ta ligne « const clean = { … } »
      par la même, en insérant «  ph: String(p.ph || "").slice(0, 40),  ».
      Exemple complet :

      const clean = {
        crop,
        region: String(p.region || "").slice(0, 120),
        area:   String(p.area   || "").slice(0, 80),
        soil:   String(p.soil   || "").slice(0, 80),
        ph:     String(p.ph     || "").slice(0, 40),   // <-- AJOUT (facultatif)
        season: String(p.season || "").slice(0, 80),
        goal:   String(p.goal   || "").slice(0, 120),
        notes:  String(p.notes  || "").slice(0, 500)
      };

   4) FORMULAIRE (public/app.html) — ajoute un champ pH FACULTATIF, par exemple
      juste après le champ « Type de sol » :

      <label>pH du sol <span style="color:#888;font-weight:400">(facultatif)</span></label>
      <input id="ph" type="text" placeholder="ex. 6,5 — laissez vide si vous ne le connaissez pas">

      Puis, là où le formulaire envoie la demande (le corps JSON du fetch vers
      « /api/plan »), ajoute le pH à l'objet envoyé, par exemple :

      ph: (document.getElementById('ph') ? document.getElementById('ph').value.trim() : ''),

   RÉSULTAT : le champ est optionnel. S'il est rempli, l'itinéraire en tient compte
   (chaulage, disponibilité des nutriments). S'il est laissé vide, l'itinéraire reste
   complet et propose, si besoin, des moyens simples d'estimer l'acidité du sol.
   ============================================================ */

# Détection sous le sable — GPR (Ground Penetrating Radar)

> Phase **avancée et expérimentale**. Non intégrée physiquement à ce jour.

## Positionnement honnête

- Le GPR n'est **pas** installé ni simulé comme réel. Aucune donnée radar fictive
  n'est injectée comme observation réelle.
- Une anomalie souterraine **n'est pas automatiquement du plastique**. Le sol de
  plage renvoie des échos dus à l'humidité, à la salinité et à la nature du sable.

## Limites physiques documentées

| Facteur | Effet sur le GPR |
|---|---|
| Humidité / nappe | Forte atténuation du signal, profondeur utile réduite. |
| Salinité (embruns, eau de mer) | Milieu conducteur → absorption des ondes. |
| Sable hétérogène | Échos parasites, faux positifs. |

Conséquence : le GPR seul ne peut pas affirmer « plastique enfoui ». Il fournit
des **anomalies candidates** à corréler avec d'autres indices.

## Intégration prévue (module indépendant)

1. **Ingestion brute** : les relevés radar arrivent via `DeviceEvent`
   (`source="gpr"`), stockés tels quels, sans interprétation hâtive.
2. **Traitement séparé** : un futur `services/gpr.py` détectera des anomalies,
   avec un niveau de confiance et une classification prudente (`unknown_subsurface`).
3. **Corrélation visuel ↔ souterrain** : une interface permettra d'associer une
   anomalie GPR à une zone et, le cas échéant, à des observations visuelles de
   surface, sans conclure seul.

## Prochaine étape

Rédiger le format d'échange GPR (profils, coordonnées, profondeur, amplitude) et
mener une campagne de calibration terrain à Balmer pour mesurer la profondeur
utile réelle.

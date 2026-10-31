# Xake — Maia : un adversaire qui joue comme un humain

> Proposer Maia comme adversaire, au choix du joueur à côté de Stockfish bridé, pour des erreurs
> humaines plutôt que des coups faibles tirés au hasard. Stockfish garde toute l'analyse.
>
> Statut : **implémenté** (version 0.3.0), à valider au jeu sur la durée. Rédigé le 2026-10-30.

## 1. Constat

- À 1500, Stockfish (`UCI_LimitStrength` / `UCI_Elo`) joue des coups « vraiment étranges » : il
  choisit au hasard parmi ses candidats à une profondeur plafonnée (≈ niveau + 1 demi-coups), ce
  qui mêle des coups de machine précis et des coups faibles sans logique humaine (spec 001 §4).
- Lui donner plus de temps n'y change rien : le choix se fait au plafond de profondeur.

## 2. Maia

- Réseaux de neurones au format Leela Chess Zero (lc0), entraînés sur des parties Lichess pour
  **prédire le coup d'un humain** d'un niveau donné ([CSSLab/maia-chess](https://github.com/CSSLab/maia-chess),
  GPL-3.0). Maia 1 : un réseau par tranche, 1100 à 1900. Utilisé sans recherche : le coup le plus
  probable selon le réseau.
- Pas un moteur d'analyse (sans recherche, évaluations médiocres) : Stockfish garde meilleurs
  coups, barre d'évaluation et courbe. Les deux ne font pas la même chose, rien n'est dupliqué.

## 3. Implémentations étudiées

- **3.a lc0 compilé en WebAssembly** : parlerait UCI, se brancherait sur les pools de
  `js/engine.js`. ❌ aucun build maintenu trouvé (`lc0-js` : port Emscripten + TensorFlow.js, ancien).
- **3.b Réseau seul avec ONNX Runtime Web** (retenu) : modèles Maia 1 convertis en ONNX
  ([cstr/maia-chess-onnx-opset15](https://huggingface.co/cstr/maia-chess-onnx-opset15), révision
  épinglée, GPL-3.0), `onnxruntime-web` 1.31.1 (MIT), WebAssembly un thread (pas d'isolation
  cross-origin). Encodage de la position et décodage du coup écrits à la main (`js/maia.js`, ~130 lignes).
- **3.c Maia 3** ([bqrio/maia3-onnx](https://huggingface.co/bqrio/maia3-onnx)) : un seul réseau
  paramétré par l'Elo des deux joueurs, encodage plus simple. ❌ **AGPL-3.0**, 10,8 Mo minimum (5M
  fp16), plage d'Elo non documentée. À revoir si Maia 1 déçoit.

## 4. Fonctionnement (POC)

- **Choix du joueur, à la nouvelle partie** : « Adversaire : Stockfish / Maia ». Le slider suit
  l'adversaire : Stockfish de 400 à 3190 par 10, Maia de 1100 à 1900 **par 100, un cran par
  réseau**. Le choix est enregistré dans la partie (`game.opponent`, absent = Stockfish pour les
  parties existantes), repris par la nouvelle partie suivante (`prefs.opponent`), par « rage quit »
  et par le lien de partage (`o=m`). Le nom de l'adversaire suit partout (bandeau, statut, liste
  des parties, PGN). **Le niveau ne se change plus en cours de partie** : il a quitté les réglages,
  le badge Elo du bandeau n'est plus cliquable ; adversaire et niveau se choisissent ensemble, à
  la nouvelle partie.
- **« Commencer » télécharge le réseau** (et ONNX Runtime) avant de lancer la partie : bouton
  « Téléchargement de Maia… », mis en cache par le service worker ; en cas d'échec, toast
  « Impossible de charger Maia », la fenêtre reste ouverte. Pas de repli silencieux sur Stockfish :
  le joueur a choisi Maia.
- `engineMove(position, elo, signal, opponent)` (`js/engine.js`) : Maia (`js/maia.js`, chargé à
  la demande) ou Stockfish selon la partie.
- **Modèle** : `maia-<tranche>` où tranche = Elo arrondi à la centaine inférieure : chaque réseau a
  appris sur des parties entre joueurs d'une même tranche de 100 (1500–1599 pour `maia-1500`).
- **Entrée** (format lc0 « classical », 112 plans 8×8) : 8 positions (actuelle d'abord), chacune
  6 plans de pièces du camp au trait, 6 de l'adversaire, 1 de répétition ; puis droits de roque
  (nous O-O-O, nous O-O, eux O-O-O, eux O-O), trait aux Noirs, compteur des 50 coups (valeur brute),
  un plan vide, un plan de 1. Plateau retourné quand les Noirs ont le trait.
- **Sortie** : politique sur 1 858 coups (déplacements de dame et de cavalier par case de départ
  puis d'arrivée, puis sous-promotions dame/tour/fou ; la promotion « simple » vaut cavalier),
  du point de vue du camp au trait. **Le roque est codé roi prend sa tour** (e1h1, e1a1), constaté
  sur le réseau.
- **Choix du coup : tirage pondéré** par les probabilités du réseau (softmax sur les coups
  légaux), **parmi les coups à au moins 10 %** (le plus probable passe toujours). Tirer selon la
  politique imite mieux un joueur de la tranche que l'argmax (qui joue le coup « moyen », sans les
  imprécisions, donc au-dessus de la tranche) et varie les parties ; le seuil écarte le coup rare
  et absurde. Mesure sur 200 positions (Maia 1500, coups jugés par Stockfish 0,3 s, à lire en
  relatif : les valeurs absolues sont gonflées par les positions de mat et l'absence d'historique) :

  | Choix | Candidats | Un seul candidat | Coups ≥ 200 cp |
  | --- | --- | --- | --- |
  | argmax | 1 | 100 % | 19,5 % |
  | seuil 5 % | 5,1 | 2 % | 25,3 % |
  | **seuil 10 %** | 2,9 | 8 % | 22,9 % |
  | sans seuil | 12,4 | 0 % | 28,2 % |

  Maia 1100 : 28,0 / 32,2 / 30,8 / 33,3 %. Vérifié dans le navigateur (400 tirages) : 1.e4 74 %,
  1.d4 26 % ; après 1.e4, …e5 68 %, …c5 19 %, …e6 13 %.
- `ENGINE_MIN_DELAY_MS` (300 ms) reste : Maia répond en quelques ms.

## 5. Mesures (2026-10-30, Chromium headless, desktop)

- **Parité JS / prototype Python** (onnxruntime + python-chess) : coup identique sur 62/62
  positions sans historique (1100, 1500, 1900, roques inclus) et 30/30 sur une partie avec historique.
- Plausibilité (Maia 1500) : 1.e4 65 %, 1.d4 23 % ; après 1.e4, …e5 50 %, …c5 17 % ; dame
  offerte reprise (96 %) ; promotion en dame (85 %) ; dans l'Italienne, Cg5 ou O-O.
- **Temps** : ~5 ms par coup une fois chargé ; premier coup à froid 411 ms en local (téléchargement
  compris, sans latence réseau).
- **Poids** : `ort-wasm-simd-threaded.wasm` 14,8 Mo + JS 80 Ko, un modèle 3,5 Mo (9 modèles,
  31 Mo, un seul téléchargé par tranche jouée). Stockfish lite : 1,8 Mo.

## 6. Points ouverts

1. **Le critère** : le jeu paraît-il plus humain à 1500 ? Validation au jeu (desktop, iPhone).
2. **Poids** : 15 Mo d'ONNX Runtime pour un réseau de 16 convolutions. Piste : une inférence
   écrite à la main en JS (convolutions 3×3 sur 8×8, squeeze-excitation, têtes), poids extraits de
   l'ONNX ; supprimerait la dépendance, effort à chiffrer.
3. **Dépôt** (tranché) : `vendor/onnxruntime/` et `vendor/maia/` (46 Mo) ne sont jamais committés.
   `scripts/fetch-maia.sh` les télécharge (versions épinglées, SHA-256 vérifiés, retéléchargés si
   corrompus) : appelé par `just webapp` (recette `maia-assets`, 0,1 s quand tout est là) et par un
   stage `assets` du `Dockerfile` (Alpine + curl), copié dans les sources avant `uv sync`. Le
   `.dockerignore` exclut les copies locales : l'image ne dépend pas du poste. Image : 145 → 191 Mo.
   **Depuis la spec 007** : ONNX Runtime vient de npm (regroupé par Vite), le script ne télécharge
   plus que les réseaux, vers `public/maia/`, avant `npm run dev` et `npm run build`.
4. **Hors ligne** : Maia n'est mis en cache qu'après un premier coup joué en ligne (chargé à la
   demande, après la liste envoyée au service worker, spec 005 §11).
5. ~~**Jeu déterministe**~~ : réglé par le tirage pondéré au seuil de 10 % (§4).
6. **Échelle d'Elo** : les tranches Maia sont des classements Lichess (parties rapides), pas des
   Elo FIDE ; sous 1100 et au-dessus de 1900, Stockfish bridé : la transition se sentira peut-être.
7. **Licence** : poids GPL-3.0 (comme Xake), conversion ONNX communautaire épinglée par révision ;
   ONNX Runtime MIT. README (licences) à compléter si le POC est retenu.

## 7. Fichiers concernés

| Zone | Fichier |
| --- | --- |
| Adversaire Maia | `src/xake/static/js/maia.js` (nouveau), `src/xake/static/js/engine.js` |
| Choix de l'adversaire | `src/xake/static/index.html`, `src/xake/static/js/main.js`, `src/xake/static/js/i18n.js`, `src/xake/static/js/tree.js`, `src/xake/static/js/storage.js`, `src/xake/static/js/share.js`, `src/xake/static/js/pgn.js` |
| Assets | `scripts/fetch-maia.sh` (nouveau), `scripts/vendor.sh`, `Justfile`, `Dockerfile`, `.dockerignore`, `.gitignore` |
| Test | `scripts/e2e.py` (partie contre Maia, Chromium + WebKit) |

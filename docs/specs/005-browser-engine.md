# Xake — Stockfish dans le navigateur

> Faire tourner Stockfish dans le navigateur du joueur (WebAssembly) au lieu du serveur. Toutes les
> fonctionnalités restent identiques : le joueur ne doit pas voir la différence, à la vitesse de son
> appareil près. D'abord un choix de l'instance (`XAKE_ENGINE`, puis `both`, §9), finalement **le
> seul mode** : le moteur serveur est retiré (§10).
>
> Statut : **implémenté** (version 0.3.0). Rédigé le 2026-10-29, révisé le 2026-10-30.

## 1. Où on en est aujourd'hui

```
 navigateur                                 serveur
┌──────────────────────┐ POST /api/move    ┌───────────────────────────────┐
│ main.js              │ ────────────────▶ │ FastAPI (validation)          │
│  └─ js/api.js (fetch)│ POST /api/analyse │  └─ Engines (engine.py)       │
│                      │ ────────────────▶ │      ├─ pool play    (Elo)    │
│                      │ ◀──────────────── │      └─ pool analyse (MultiPV)│
└──────────────────────┘ JSON              └───────────────────────────────┘
```

- `js/api.js` expose deux fonctions, `engineMove(position, elo, signal)` et
  `analyse(position, multipv, signal, movetimeMs)`, consommées par `main.js` (coup de la machine,
  meilleurs coups, évaluation en tâche de fond de la courbe à 150 ms par position).
- Le contrat est celui de la spec 001 §3 : position = `start_fen` + coups UCI, scores du point de
  vue des Blancs, `lines` triées, `outcome` sur position terminale.
- La logique qui n'est pas du simple relais UCI vit côté serveur : options Elo (`elo.py`, 001 §4),
  filtrage des infos d'analyse (infos exactes, profondeur complète la plus haute, 001 §2),
  conversion en SAN, détection des fins de partie.

## 2. Ce que la proposition implique

- **Setting `XAKE_ENGINE`** : `server` (défaut, comportement actuel), `browser` ou `both` (§9).
  Exposé au front par `/config.js` (`engine`), avec le temps de réflexion du coup machine
  (`playMovetimeMs`) pour que les deux modes jouent au même rythme. L'analyse dans le navigateur
  suit le budget en nœuds du §9, pas `XAKE_ANALYSE_MOVETIME_MS`.
- **Moteur** : [stockfish.js](https://github.com/nmrugg/stockfish.js) 19.0.1 (paquet npm
  `stockfish`, GPL-3.0, comme Xake), variante **lite single-threaded** : `stockfish-19-lite-single.js`
  (28 Ko) + `.wasm` (1,8 Mo, réseau NNUE réduit embarqué). Vendorisé par `scripts/vendor.sh` sous
  `vendor/stockfish/`, comme le reste.
- **`js/api.js` devient l'aiguillage** : même signature, mêmes réponses, mêmes erreurs (`ApiError`
  avec un statut HTTP équivalent : 409 partie finie, 503 moteur indisponible ; `AbortError` à
  l'annulation). En mode `browser`, il délègue à `js/engine.js`, chargé à la demande.
- **`js/engine.js`** porte en JS ce que fait le serveur :
  - pools de Web Workers calqués sur `EnginePool` : `play` (1 worker) et `analyse` (2 workers,
    l'analyse affichée et l'évaluation de la courbe tournent en parallèle comme côté serveur) ;
    workers créés au premier usage, file d'attente quand ils sont tous occupés ;
  - options Elo identiques à `elo.py` (seuils et interpolation des nœuds recopiés, à garder alignés) ;
    toutes les options de force sont renvoyées à chaque coup (un `Skill Level` 0 ne doit pas
    survivre au passage à un Elo ≥ 1320) ;
  - `position startpos|fen … moves …` avec tout l'historique (répétitions, règle des 50 coups) ;
  - mêmes règles de filtrage d'analyse que `engine.py` (`_deepest_complete`) ;
  - SAN et fins de partie via chess.js (déjà vendorisé), scores ramenés au point de vue des Blancs ;
  - annulation : `stop` envoyé au worker, on attend son `bestmove` avant de lui confier autre chose ;
  - moteur qui ne se charge pas (pas de WebAssembly, fichier absent) ou worker qui plante : `503`,
    le worker est remplacé au prochain usage (le toast « moteur indisponible » existant s'affiche).
- **Serveur en mode `browser`** : pas de pools Stockfish au démarrage ; `/api/move`,
  `/api/analyse` répondent `404` ; `/api/health` répond `ok` sans moteur ; `/api/version` inchangé
  (sondes k8s). L'image Docker garde Stockfish : une seule image pour les deux modes.
- **Hors ligne** : le service worker (network-first) met déjà en cache tout GET same-origin, donc
  le `.wasm` après le premier chargement. En mode `browser`, l'app joue et analyse sans réseau.

### Mesures (étape 0, 2026-10-29)

> ⚠️ Les chiffres Firefox ci-dessous viennent du Firefox de Playwright, ~12× plus lent que le vrai
> (mesuré le 2026-10-30 : Firefox 159 du système 745 k nœuds/s, Chromium 680 k, Firefox Playwright
> 57 k). Sur desktop, les deux navigateurs se valent ; voir §9.

Desktop de dev, navigateurs headless (Playwright), position après 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6,
`MultiPV 3`. Natif = binaire Stockfish du serveur (réseau complet), 1 thread.

| | chargement + `uciok` | 150 ms | 300 ms | 500 ms |
| --- | --- | --- | --- | --- |
| Chromium, WASM lite | 150 ms | prof. 12 | 14 | 15 |
| Firefox, WASM lite | 315 ms | prof. 9 | 9 | 10 |
| Natif, réseau complet | — | — | — | ~13 |

- Le réseau lite, plus léger, compense la lenteur du WASM : sous Chromium, profondeur comparable
  au serveur. Firefox est nettement en retrait (≈ 5 demi-coups) : meilleurs coups un peu moins
  sûrs, sans effet sur le jeu bridé par Elo. Mobile non mesuré : à faire sur appareil réel.
- Le moteur expose `UCI_LimitStrength`, `UCI_Elo` (1320–3190), `Skill Level`, `MultiPV`, `Hash`
  (défaut 16 Mo) : la table Elo de 001 §4 s'applique telle quelle.

## 3. POUR

1. **Plus de CPU serveur** : la charge suit le nombre de joueurs sans rien coûter au cluster ; le
   risque « un client sature le CPU » (001 §10) disparaît.
2. **Hors ligne complet** en PWA, et plus de latence réseau par requête.
3. **Hébergement statique possible** à terme (le serveur ne sert plus qu'à `/config.js`).
4. **Contrat inchangé** : l'aiguillage est sous `js/api.js`, `main.js` ne change pas.

## 4. CONTRE

1. **Contre majeur — performance dépendante de l'appareil.** WebAssembly sur un thread est plus
   lent que le binaire natif, surtout sur mobile : à temps égal, l'analyse est moins profonde
   (profondeur à mesurer, étape 0). Le jeu bridé par Elo n'en souffre pas.
2. **Réseau lite plus faible** que le réseau complet du serveur : évaluations et meilleurs coups
   peuvent différer, sans écart visible pour un humain (le lite reste très au-dessus de 3000).
3. **Batterie et chauffe** sur téléphone : la courbe évalue chaque position en tâche de fond.
4. **Logique dupliquée** Python ↔ JS (Elo, filtrage d'analyse) : à garder alignée à la main,
   chaque fichier renvoie à l'autre.
5. **Pas de tests automatisés côté front** (CLAUDE.md) : le moteur navigateur se valide à la main
   et via Playwright ; les tests d'API ne couvrent que le mode `server`.
6. **1,8 Mo** de plus au premier chargement (en cache ensuite).

## 5. Implémentations possibles

- **5.a Lite single-threaded** (retenu) : ✅ 1,8 Mo, aucune configuration serveur, tous navigateurs
  récents (iOS 16+). ❌ réseau réduit, un seul thread par worker.
- **5.b Lite multi-thread** : ✅ plus rapide sur desktop. ❌ exige `Cross-Origin-Opener-Policy` +
  `Cross-Origin-Embedder-Policy: require-corp` (isolation), contrainte pour tout contenu tiers futur.
- **5.c Réseau complet** : ✅ même force que le serveur. ❌ ~94 Mo à télécharger, inacceptable sur
  mobile et pour un premier chargement.

## 6. Alternatives écartées

- **Mode hybride** (navigateur en secours du serveur, ou l'inverse) : double chemin à maintenir
  et comportement difficile à prévoir pour l'utilisateur. Un choix strict par instance suffit.
- **Choix du mode par l'utilisateur** : d'abord écarté (décision d'hébergement), finalement retenu
  sous la forme `XAKE_ENGINE=both` (§9) : l'instance décide si le choix est offert.

## 7. Plan de réalisation

0. **Cadrage** : vendoriser stockfish.js, vérifier chargement, `uci`, MIME `application/wasm` servi
   par Starlette, profondeur atteinte en 150 / 300 / 500 ms sur desktop et mobile.
1. **Serveur** : `XAKE_ENGINE` (`schema/settings.py`), `lifespan` sans pools en mode `browser`,
   `404` sur `/api/move` et `/api/analyse`, `/config.js` enrichi, tests ; chart (`values.yaml`,
   `deployment.yaml`, README) et README racine.
2. **Front** : `js/engine.js` (pools, UCI, Elo, analyse), aiguillage dans `js/api.js`.
3. **Validation** : comparaison automatisée avec l'API serveur sur les mêmes positions (premiers
   coups identiques, scores du point de vue des Blancs, mat en 1, position terminale, `409`,
   annulation en ~130 ms, analyses parallèles) et parcours UI Chromium + Firefox (coup machine,
   meilleurs coups, revue de partie) : faits. Restent à la main : partie complète, meilleurs coups, courbe, revue de partie, annulation rapide
   (navigation dans l'historique), Elo < 1320 puis ≥ 1320, hors ligne (PWA en HTTPS).

## 8. Fichiers concernés

| Zone | Fichier |
| --- | --- |
| Setting | `src/xake/schema/settings.py`, `charts/xake/values.yaml`, `charts/xake/templates/deployment.yaml`, `charts/xake/README.md`, `README.md` |
| Serveur | `src/xake/webapp.py`, `src/xake/routers/api.py`, `src/xake/routers/web.py` |
| Moteur navigateur | `src/xake/static/js/engine.js` (nouveau), `src/xake/static/js/api.js` |
| Vendoring | `scripts/vendor.sh`, `src/xake/static/vendor/stockfish/` |
| Tests | `tests/test_api.py`, `tests/test_settings.py` |

## 9. Mode `both` et budget d'analyse (2026-10-30)

- **`XAKE_ENGINE=both`** : le serveur démarre ses pools comme en `server` ; le joueur choisit dans
  les réglages « Moteur : Serveur / Cet appareil » (`prefs.engine`, **serveur par défaut** : plus
  fort et sans coût pour l'appareil). Le réglage n'apparaît qu'en mode `both`.
- **Budget d'analyse unique** (`js/engine.js`), aucun réglage pour le joueur :

  | Recherche | Budget | Plafond de temps |
  | --- | --- | --- |
  | Meilleurs coups, barre d'éval | 1 M nœuds | 2 s |
  | Courbe (chaque position, en tâche de fond) | 300 k nœuds | 0,5 s |

  Hash 32 Mo par worker, un seul thread. Le coup machine n'est pas concerné : il est bridé par l'Elo.
  - **Budget en nœuds, pas en temps** : même wasm, un seul thread, donc même recherche à nœuds
    égaux quel que soit le navigateur (vérifié : 8/8 positions identiques, coup et profondeur,
    Chromium vs Firefox). Seule la durée dépend de l'appareil.
  - **1 M nœuds** : seuil mesuré ci-dessous, en dessous le taux de coups faux double ; au-dessus,
    plus de gain mesurable. Durée estimée d'après la vitesse mesurée (MultiPV 3) : ~0,9 s sur iPhone
    (1,1 M nœuds/s), ~1,25 s sur desktop (0,8 M nœuds/s).
  - **Plafond de 2 s** (`go nodes N movetime T`) : un appareil sous 500 k nœuds/s s'arrête avant le
    budget, réponse un peu moins sûre mais attente bornée. Le délai anti-blocage du worker suit ce
    plafond.
  - **Courbe à 300 k / 0,5 s** : équivalent supposé des 150 ms du serveur, non mesuré ; 1 M par position
    prendrait ~80 s pour une partie de 40 coups.
- **Où joue Stockfish** : dès que l'instance peut faire tourner le moteur dans le navigateur
  (`browser` ou `both`), le badge Elo de l'adversaire porte une icône, nuage pour le serveur,
  ordinateur pour l'appareil, et son infobulle le dit. Rien en mode `server` seul : pas d'ambiguïté.
- **Changer de moteur** vide le cache d'analyse et réévalue la courbe (clé de cache = position +
  MultiPV + moteur).

### Options écartées

- **Trois niveaux d'analyse au choix du joueur** (Rapide 300 k / Équilibrée 1 M / Approfondie 3 M,
  implémentés puis retirés) : la mesure sur 200 positions ne montre aucun gain au-delà de 1 M
  nœuds ; les niveaux ne changeaient que l'attente, et Rapide passait sous le seuil.
- **Multithread** (`stockfish-19-lite.js`, en-têtes COOP/COEP) : ×3,9 nœuds/s sur desktop, ×2,5 sur
  iPhone (fonctionne sur iOS, même avec un certificat auto-signé accepté), mais à nombre de nœuds
  égal pas de meilleure réponse, et sur 3 s la profondeur n'augmente pas (19 → 18 desktop, 21 → 18
  iPhone). Coûts : en-têtes d'isolation qui bloquent tout contenu tiers futur, 1,7 Mo de plus,
  résultats non déterministes, plusieurs cœurs et donc batterie. Le seuil de 1 M nœuds est atteint
  en ~1 s sur un thread : pas de besoin.
- **Réseau complet** (`stockfish-19-single.js`) : moitié moins de nœuds/s, un peu meilleur à 0,5 s,
  pareil à 2 s ; 99 Mo à télécharger et ~100 Mo de mémoire par worker : exclu pour mobile.

### Mesures (2026-10-30)

**Niveaux** (200 positions de parties à 1500 Elo, MultiPV 3, Chromium, réseau lite, un thread ;
référence Stockfish natif 5 s ; chaque coup jugé par le natif à 2 s ; IC 95 %) :

| Candidat | Coups ≥ 50 cp | Perte moyenne | Durée (1 thread, desktop chargé) |
| --- | --- | --- | --- |
| Serveur 500 ms | 2,0 % (0,8–5,0) | 3,8 cp (1,7–6,5) | 0,5 s |
| 300 k nœuds | 5,0 % (2,7–9,0) | 11,2 cp (4–24) | 0,4 s |
| **1 M nœuds** | **2,0 % (0,8–5,0)** | 7,9 cp (1,5–19) | 1,6 s |
| 2 M nœuds | 3,5 % (1,7–7,0) | 10,3 cp (2–23) | 3,3 s |
| 3 M nœuds | 3,0 % (1,4–6,4) | 6,4 cp (2,5–11) | 5,0 s |
| 6 M nœuds | 3,0 % (1,4–6,4) | 5,8 cp (2,3–11) | 10,1 s |

- Seul 300 k → 1 M est un gain significatif (perte appariée +3,3 cp, IC [+1,4 ; +5,7], coups
  ≥ 50 cp 10 → 4 sur 200). 1 M → 2 M et 3 M → 6 M : dans le bruit.
- La perte moyenne dépend de quelques positions perdues de beaucoup (IC très larges) : le taux de
  coups ≥ 50 cp est l'indicateur retenu.

**Variantes** (40 positions, durée égale, vrai Firefox 159 et Chromium, 4 threads en multi) : au-delà
du lite un thread à 0,5 s (6–7 cp de perte, un coup à 141 cp), toutes les variantes finissent entre
2 et 4 cp, comme le serveur : écarts dans la marge de mesure. Vitesse lite un thread : Firefox
880 k nœuds/s, Chromium 790 k (le Firefox de Playwright, 12× plus lent, ne doit pas servir aux mesures).

Scripts et données : `.bench/` (hors dépôt).

- Limites : desktop pour la qualité ; sur mobile, seule la vitesse est mesurée (un iPhone).
- L'analyse ne s'affiche qu'à la fin de la recherche (~1 s) : un affichage progressif serait une
  amélioration à envisager.

## 10. Navigateur seulement : retrait du moteur serveur (2026-10-30)

Décision : Stockfish ne tourne plus que dans le navigateur. `XAKE_ENGINE` et le mode `both`
disparaissent, avec le réglage « Moteur » et l'icône serveur/appareil du badge Elo (§9), devenus
sans objet.

- **Pourquoi** : les mesures du §9 placent le moteur navigateur (1 M nœuds) au niveau du serveur
  sur le taux de coups faux (2 %), en ~1 s sur iPhone ; il joue hors ligne (PWA) et ne coûte rien
  au cluster. Garder deux moteurs, c'était deux chemins à maintenir et à tester (Python et JS, la
  table Elo et le filtrage d'analyse en double) pour un gain non mesurable.
- **Serveur** : FastAPI ne sert plus que l'app statique, `/config.js`, les icônes racine,
  `/api/version` (sondes k8s ; `/api/health` retiré ensuite, §11). `/api/move` et `/api/analyse`
  n'existent plus. Plus de `lifespan`, plus de `python-chess`.
- **Image Docker** : plus de paquet `stockfish` ; la CI ne l'installe plus, `shell.nix` non plus.
  Les tests ne dépendent plus d'un binaire (plus de tests sautés faute de Stockfish).
- **Settings** : restent `XAKE_DEFAULT_LANGUAGE`, `XAKE_DEFAULT_ELO`, `XAKE_PLAY_MOVETIME_MS`
  (temps de réflexion de l'adversaire, appliqué dans le navigateur). Supprimés : `XAKE_ENGINE`,
  `XAKE_STOCKFISH_PATH`, tailles de pools, threads, hash, `XAKE_ANALYSE_MOVETIME_MS`,
  `XAKE_MAX_MOVETIME_MS`, `XAKE_ACQUIRE_TIMEOUT_S`. Une variable restée dans un déploiement est
  ignorée (`extra="ignore"`), pas d'erreur au démarrage.
- **Chart** : valeurs moteur retirées, ressources d'un serveur statique (requête `20m` / `96Mi`,
  limite `192Mi` au lieu de `1Gi` / `1536Mi`).
- **Contrat** : `js/engine.js` reste la seule implémentation de la spec 001 §2–§4 (table Elo,
  filtrage d'analyse, fins de partie, erreurs en `EngineError`, §11).
- **Ce qu'on perd** : l'analyse du serveur, un peu plus sûre (réseau complet, position #29 du §9) ;
  un appareil très lent ou sans WebAssembly n'a plus de repli (toast « moteur indisponible »).

### Réexaminé et écarté : rétablir un mode serveur exclusif (2026-10-30)

Option étudiée : `XAKE_ENGINE=browser|server` (navigateur par défaut, un seul mode à la fois, sans
`both`), Stockfish remis dans l'image. Coût mesuré sur le code retiré lors du passage au navigateur seul
(lignes non vides, mode `both` exclu) :

| Partie | Lignes |
| --- | --- |
| Python de production (`engine.py`, `schema/api.py`, routes, `elo.py`, `lifespan`, settings) | ~315 |
| Tests du moteur serveur | ~170 |
| Aiguillage `js/api.js` | ~15 |
| Dockerfile, CI, `shell.nix`, chart | ~25 |
| **Total** | **~525** |

- Ce n'est pas du code partagé : c'est une **seconde implémentation du même contrat**. Le front
  (`main.js`, arbre, courbe, réglages) est commun, mais `engine.py` double `js/engine.js` : table
  Elo, filtrage d'analyse et fins de partie à garder alignés à la main à chaque évolution.
- Les tests automatiques ne couvriraient que le mode serveur ; le mode par défaut (navigateur), sans
  tests côté front, resterait le moins testé.
- Coûts annexes : Stockfish réinstallé en CI, paquet Debian dans l'image, réglages de pools et
  dimensionnement à remettre dans la chart.

**Décision** : navigateur seulement, pour la simplicité et la maintenabilité. Pour y revenir, le
moteur serveur est intact dans la version `0.2.5` (`engine.py`, `elo.py`, `schema/api.py`, routes,
tests) ; l'aiguillage entre les modes est à réécrire, décrit aux §2 et §9.

## 11. Revue après le passage au navigateur seul (2026-10-30)

Relecture complète du code une fois le moteur serveur retiré.

**Corrigé**

- **Hors ligne sur iOS dès le premier lancement** : WebKit ne liste pas les requêtes du worker
  dans les ressources de la page ; le script du moteur n'était pas mis en cache (le `.wasm` si),
  l'app démarrait en mode avion sans moteur. La page ajoute désormais `ENGINE_FILES` à la liste
  qu'elle envoie au service worker (vérifié Chromium + WebKit).
- **Démarrage du moteur** : délai porté de 10 à 60 s pour le premier `uci` (téléchargement du
  `.wasm` sur un réseau mobile lent).
- **Page en arrière-plan** : un délai anti-blocage qui expire alors que la page est cachée est
  réarmé au lieu de tuer le worker (une app suspendue par iOS ne doit pas afficher « moteur
  indisponible » au retour). Non reproduit, défensif.
- **Relance de la courbe** : après un échec, nouvel essai à 5, 10, 20 s puis abandon jusqu'au
  prochain changement (auparavant toutes les 5 s sans fin, un worker relancé à chaque fois si le
  WebAssembly manque).
- **Fins de partie unifiées** (`gameEnding` dans `js/evaluation.js`) : le plateau finissait la
  partie à la triple répétition et aux 50 coups, le moteur seulement à la quintuple répétition et
  aux 75 coups (règle reprise de python-chess pour coller au serveur). Une seule règle, celle du
  plateau ; la spec 001 §3 (« fins automatiques seulement ») ne vaut plus.

**Simplifié**

- `js/api.js` supprimé : il ne faisait plus que relayer `js/engine.js`, avec un import circulaire
  et un chargement à la demande inutile (le moteur sert dès l'ouverture). `ApiError` et ses codes
  HTTP (409/422/503, jamais lus) deviennent une `EngineError`.
- `/api/health` supprimé, avec la sonde de liveness de la chart : seule la readiness sur
  `/api/version` reste. `pytest-asyncio` retiré (plus de test asynchrone).
- Test de fumée `just e2e` (`scripts/e2e.py`, Playwright, Chromium et WebKit) : coup du moteur,
  meilleurs coups, aucun appel `/api/`, moteur en cache pour le hors ligne. Pas en CI.

**Écarté**

- **Budget en nœuds pour le coup machine** : sous ~2300 Elo, le plafond de profondeur de
  `UCI_Elo` est atteint largement en 300 ms sur tout appareil, la vitesse n'y change rien ; le
  public visé (débutants, intermédiaires) n'est pas concerné. Recalibrer les Elo sans mesure
  serait pire.

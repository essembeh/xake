# Xake — Site 100 % statique

> Depuis la spec 005 §10, le backend FastAPI ne fait plus que servir des fichiers et `/config.js` :
> Xake devient un site statique, outillé comme un projet web (npm, Vite), publié sur GitHub Pages
> pour la démo et en image Docker (nginx) pour l'auto-hébergement. Python, uv et Helm disparaissent.
>
> Statut : **implémenté** sur la branche `feature-static-site`, à valider (Firefox, iPhone). Rédigé
> le 2026-10-31.

## 1. Constat

- Le backend ne calcule plus rien : fichiers statiques, `/config.js` (langue, Elo, temps de coup,
  version), `/api/version` (probe de la chart, inutilisé par le front), icônes iOS à la racine,
  `Cache-Control: no-cache`.
- Les chemins du front sont tous relatifs : le site tourne tel quel sous un sous-chemin
  (`essembeh.github.io/xake/`).
- La règle « pas de npm » (spec 001 §8) protégeait un projet Python d'une seconde chaîne d'outils.
  Le projet n'a plus que du web : npm devient l'outillage normal, `scripts/vendor.sh` (curl sur le
  registre npm, versions en dur) en était un substitut.

## 2. Décisions

### 2.1 Outillage : npm + Vite

- `package.json` + `package-lock.json`, Node 24 LTS (`engines`, lu aussi par `actions/setup-node`). `npm ci` en CI.
- **Dépendances npm** (remplacent `scripts/vendor.sh`) : `chessground` 9.2.1, `chess.js` 1.4.0,
  `stockfish` 19.0.1, `onnxruntime-web` 1.31.1. Mises à jour par `npm outdated` / `npm update`,
  le lock fige les versions (et les hashes d'intégrité : plus besoin de SHA-256 à la main).
- **Vite** : serveur de dev (rechargement à chaud) et build. Les modules sont regroupés et nommés
  par hash (`assets/main-<hash>.js`) : un déploiement change les URL, la mise en cache longue des
  scripts devient sûre et le problème du JS périmé (spec 001 §8, `no-cache`) disparaît, y compris
  sur Pages qui impose `max-age=600`.
- `base: "./"` : le même build sert à la racine (Docker) et sous `/xake/` (Pages).
- Fichiers servis tels quels (`public/`, sans hash) : manifest, `sw.js`, `config.js`, icônes,
  pièces. Le worker et le `.wasm` de Stockfish (chargés par URL, le worker trouve son `.wasm` à
  côté de lui) sont copiés depuis `node_modules` vers `stockfish/`, avec `Copying.txt`
  (`vite-plugin-static-copy`, en dev comme au build).
- ONNX Runtime : `onnxruntime-web/wasm` (glue incluse), son `.wasm` (14,8 Mo) référencé par
  `new URL(…, import.meta.url)` est émis par Vite dans `assets/` avec un hash. Exclu du
  pré-bundling de dev (`optimizeDeps.exclude`), qui casserait cette résolution. Plus de `wasmPaths`.
  `maia.js` reste chargé à la demande : un bundle à part, absent du premier chargement.
- **Prettier** (largeur 120, style actuel : guillemets doubles, points-virgules), en CI, sur les
  chemins listés dans le script `lint` (ni Markdown, ni SVG). Le premier passage n'a touché
  qu'environ 150 lignes (retours à la ligne) : laissé dans le même commit.
- **Pas d'ESLint** (essayé puis retiré) : zéro alerte sur les 4 400 lignes existantes, pour un
  fichier de config, 4 dépendances et 6 alertes `npm audit` (`minimatch`). Le smoke test attrape
  les erreurs qui comptent (exception dans la page).
- **Un seul fichier de config npm** : réglages de Prettier, de release et version de Node dans
  `package.json` (pas de `.prettierrc`, `.npmrc`, `.nvmrc`).
- Pas de TypeScript : réécriture sans rapport avec la migration.

### 2.2 Assets qui ne sont pas sur npm

- **Réseaux Maia** (31 Mo, Hugging Face) : seule source, aucun paquet npm sérieux (`next-maia` :
  tiers, 5 versions, sans les poids). `scripts/fetch-maia.sh` reste, réduit aux 9 réseaux
  (SHA-256 épinglés), vers `public/maia/` non versionné. Lancé par les hooks npm `predev` et
  `prebuild` : `npm run dev`, `npm run build`, l'image et la CI l'obtiennent sans étape à part.
  En CI, `actions/cache` garde `public/maia/` (clé : hash du script).
- **Pièces Lichess** (SVG, dépôt `lila`) : pas de paquet npm. Déjà versionnées (petites, licences
  libres) : elles passent dans `public/pieces/`. Pas de script de rafraîchissement (dépôt et
  chemins dans le README) : changer de jeu de pièces est rare.

### 2.3 Réglages du service (`config.js`)

- `public/config.js` versionné, valeurs par défaut (`en`, 1500, 300 ms).
- **Docker** : un script d'entrée nginx (`/docker-entrypoint.d/`) réécrit `config.js` depuis
  `XAKE_DEFAULT_LANGUAGE`, `XAKE_DEFAULT_ELO`, `XAKE_PLAY_MOVETIME_MS` (mêmes noms qu'avant, mêmes
  bornes, valeur invalide = arrêt du conteneur avec un message).
- **Pages** : valeurs par défaut.
- La **version** n'est plus dans `config.js` : Vite l'injecte au build (`define`,
  `__APP_VERSION__`), celle de `package.json` (`npm_package_version`, posée par npm). Comme avant,
  un build de `main` affiche la dernière version publiée ; le suffixe de commit, essayé, demandait
  un script et un argument de build de l'image pour peu d'usage.

### 2.4 Versions et release

- Source de la version : `package.json`. `npm run release -- minor` (`npm version` avec
  `--tag-version-prefix=` et `--message`) met à jour `package.json` et le lock, committe
  `🔖 New release: X.Y.Z` et pose le tag `X.Y.Z`. Push par Seb.
- Plus de chart à versionner.

### 2.5 Image Docker (auto-hébergement)

- Multi-stage : `node:24-alpine` (`npm ci`, `npm run build`, Maia compris), puis
  `nginxinc/nginx-unprivileged:1.31-alpine` (non root) avec `dist/`. Port **8000** inchangé.
  `config.js` est écrit dans `/tmp/xake/` (le site reste en lecture seule).
- `nginx.conf` : `assets/*` hashés en `max-age=1an, immutable`, le reste en `no-cache` ;
  `application/wasm` ; icônes iOS à la racine (`/apple-touch-icon*.png`, `/favicon.ico`, spec 001,
  PWA) ; `/healthz` pour une sonde éventuelle.
- Image 191 → 111 Mo (nginx ~65 Mo, le site 47 Mo dont 31 Mo de réseaux Maia).

### 2.6 GitHub Pages (démo)

- Job CI sur `main` : build, `actions/upload-pages-artifact`, `actions/deploy-pages`. Remplace la
  démo Render (job `demo-deploy` et secret `RENDER_DEPLOY_HOOK_URL` supprimés).
- Pages passe en source « GitHub Actions » : la branche `gh-pages` (dépôt Helm) n'est plus servie.
- Pas d'isolation cross-origin sur Pages : sans effet, le moteur est mono-thread (spec 005 §9).

### 2.7 Helm supprimé

- `charts/` et le job `helm-release` disparaissent. Les releases déjà publiées (chart 0.3.0 dans
  les GitHub Releases) restent, mais le `index.yaml` de `gh-pages` ne sera plus servi.
- **Impact my-cloud** : la `HelmRelease` xake lit ce dépôt Helm. À remplacer, **avant** de passer
  Pages en mode Actions, par un `Deployment` + `Service` (+ `Ingress`) en Kustomize sur l'image.

### 2.8 Tests

- **Les tests Python** (`tests/`) testaient le backend : supprimés avec lui. Ce qu'ils vérifiaient
  côté HTTP (MIME du `.wasm`, `Cache-Control`, `config.js`) passe dans un test de l'image en CI
  (`curl` sur le conteneur, avant le push), plus le refus d'un `XAKE_DEFAULT_ELO` invalide.
- **Smoke test du moteur : gardé, et enfin en CI.** Le front n'a pas de test unitaire, et cette
  migration change précisément ce qui casse sans bruit dans un navigateur : le chargement du worker
  Stockfish, du `.wasm` et d'ONNX Runtime une fois regroupés par Vite. Porté en **Playwright Test**
  (`e2e/`), un seul fichier, Chromium + WebKit (WebKit ≈ iPhone, cible principale) : coup de
  Stockfish, meilleurs coups, coup de Maia. En CI : `npx playwright install --with-deps`. Sur
  NixOS, navigateurs de nixpkgs (`scripts/nix-playwright.sh`, version de `@playwright/test`
  alignée sur nixpkgs, 1.59.1).
- **Captures du README** : pas un test, mais régénérées à chaque changement visible ; portées en
  script Node Playwright (`scripts/screenshots.js`), lancé à la main.
- Écarté pour l'instant : tests unitaires (Vitest) des modules purs (`tree.js`, `pgn.js`,
  `share.js`, `evaluation.js`). Utiles, mais hors de cette migration.

## 3. Arborescence cible

```
index.html            page (racine Vite)
src/js/*.js           modules (imports npm : "chess.js", "chessground"…)
src/css/app.css
public/               servi tel quel : config.js, sw.js, manifest, icons/, pieces/, maia/ (non versionné)
e2e/engine.spec.js    smoke test Playwright
scripts/              fetch-maia.sh, screenshots.js, nix-playwright.sh
docker/               nginx.conf, 40-xake-config.sh
Dockerfile, vite.config.js, playwright.config.js, package.json (seul fichier de config npm)
```

Supprimés : `src/xake/` (Python), `tests/`, `pyproject.toml`, `uv.lock`, `.python-version`,
`.envrc`, `shell.nix`, `charts/`, `Justfile` (remplacé par les scripts npm), `scripts/vendor.sh`,
`scripts/e2e.py`, `scripts/screenshots.py`.

## 4. Scripts npm (interface du projet)

| Script | Rôle |
| --- | --- |
| `npm run dev` | serveur Vite sur le LAN, port 8000 (Maia téléchargé avant) |
| `npm run build` / `npm run preview` | build dans `dist/` / le servir |
| `npm run lint` / `npm run format` | Prettier, vérification / écriture |
| `npm test` | smoke test Playwright (build puis `vite preview`, ou le serveur déjà lancé sur le port 8000) |
| `npm run screenshots` | captures du README |
| `npm run release -- <bump>` | release |

## 5. CI (`.github/workflows/release.yml`)

`lint` et `e2e` en parallèle, puis `docker-build` (test de l'image puis push GHCR) → `ghcr-cleanup`,
et `pages` sur `main`. Les tags semver publient l'image `X.Y.Z` comme aujourd'hui. Le rapport
Playwright est gardé 7 jours en cas d'échec.

## 6. Actions manuelles (Seb)

1. my-cloud : passer de la `HelmRelease` aux manifests (§2.7), avant l'étape 2.
2. Settings → Pages → Source : « GitHub Actions ». Puis supprimer la branche `gh-pages`.
3. Supprimer le service Render et le secret `RENDER_DEPLOY_HOOK_URL`.
4. Domaine personnalisé `xake.essembeh.org` (Settings → Pages → Custom domain), une fois Pages en
   mode Actions.

## 7. Points ouverts

1. Le paquet `chessground` s'arrête en 9.2.1, la suite sort sous `@lichess-org/chessground` 10.x (API à
   vérifier). Migration à part.
2. Mises à jour automatiques (Dependabot pour npm et les actions) : à décider.

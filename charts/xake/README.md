# xake Helm chart

Deploys [Xake](https://github.com/essembeh/xake), a chess training web app playing Stockfish at a
chosen Elo with live analysis: a single stateless `Deployment` with a `Service`, an optional
`Ingress` and an optional `HorizontalPodAutoscaler`. Games live in the browsers, the pods share
nothing.

```sh
helm repo add xake https://essembeh.github.io/xake/
helm show values xake/xake > myvalues.yaml
helm install my-xake xake/xake -f myvalues.yaml
kubectl port-forward service/my-xake 8000:http
```

The chart version follows the application version: `appVersion` is the default image tag.

## Application values

Each value under `xake` maps to one `XAKE_*` environment variable and has the same default as the
application.

| Value | Default | Variable |
| --- | --- | --- |
| `xake.image.repository` | `ghcr.io/essembeh/xake` | |
| `xake.image.tag` | `appVersion` of the chart | |
| `xake.image.pullPolicy` | `IfNotPresent` | |
| `xake.logLevel` | `INFO` | `LOGURU_LEVEL` |
| `xake.defaultLanguage` | `en` | `XAKE_DEFAULT_LANGUAGE`: `en` or `fr`, each user can still switch in the settings |
| `xake.playPoolSize` | `1` | `XAKE_PLAY_POOL_SIZE` |
| `xake.analysePoolSize` | `2` | `XAKE_ANALYSE_POOL_SIZE` |
| `xake.engineThreads` | `1` | `XAKE_ENGINE_THREADS` |
| `xake.engineHashMb` | `64` | `XAKE_ENGINE_HASH_MB` |
| `xake.playMovetimeMs` | `300` | `XAKE_PLAY_MOVETIME_MS` |
| `xake.analyseMovetimeMs` | `500` | `XAKE_ANALYSE_MOVETIME_MS` |
| `xake.maxMovetimeMs` | `3000` | `XAKE_MAX_MOVETIME_MS` |
| `xake.acquireTimeoutS` | `10` | `XAKE_ACQUIRE_TIMEOUT_S` |
| `xake.extraEnv` | `[]` | any other variable, as a list of `name` / `value` |

The image ships Stockfish from Debian (`/usr/games/stockfish`); `XAKE_STOCKFISH_PATH` only needs
to be set to use another binary mounted with `volumes`.

### Sizing

Each Stockfish process holds about 330 MiB (NNUE network and hash table), so memory grows with
`playPoolSize + analysePoolSize`. The defaults (3 engines) need about 1.1 GiB, hence the `1Gi`
request and `1536Mi` limit. The pool sizes also bound the concurrent searches, and therefore the
CPU a pod can burn; there is no CPU limit on purpose, a throttled search just plays weaker.

### Exposure

The API has no authentication: whoever reaches it spends the cluster CPU. `maxMovetimeMs` and the
pool sizes cap the damage, an auth in front of the `Ingress` (forward auth, oauth2-proxy) avoids
it. Serve it over TLS: the service worker (offline launch, home screen install) needs HTTPS.

## Kubernetes values

| Value | Default | Notes |
| --- | --- | --- |
| `replicaCount` | `1` | ignored when autoscaling is on |
| `imagePullSecrets` | `[]` | |
| `nameOverride`, `fullnameOverride` | `""` | |
| `serviceAccount.create` | `false` | the application never talks to the Kubernetes API |
| `serviceAccount.automount` | `false` | |
| `podAnnotations`, `podLabels` | `{}` | |
| `podSecurityContext` | non-root uid 10001, `RuntimeDefault` seccomp | |
| `securityContext` | read-only root filesystem, no capabilities, no privilege escalation | the image only writes to `/tmp` |
| `service.type` | `ClusterIP` | |
| `service.port` | `8000` | |
| `ingress.enabled` | `false` | `className`, `annotations`, `hosts`, `tls` as usual |
| `resources.requests` | `500m` CPU, `1Gi` memory | the CPU request is required by the HPA |
| `resources.limits` | `1536Mi` memory, no CPU limit | see Sizing |
| `autoscaling.enabled` | `false` | `minReplicas` 1, `maxReplicas` 3, `targetCPUUtilizationPercentage` 80 |
| `volumes`, `volumeMounts` | `[]` | |
| `nodeSelector`, `tolerations`, `affinity` | `{}` / `[]` | |

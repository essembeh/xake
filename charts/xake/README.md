# xake Helm chart

Deploys [Xake](https://github.com/essembeh/xake), a chess training web app playing Stockfish or
Maia (human-like) at a chosen Elo with live analysis: a single stateless `Deployment` with a `Service`, an optional
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
| `xake.defaultElo` | `1500` | `XAKE_DEFAULT_ELO`: Stockfish level of a first visit (400 to 3190), then each browser remembers the last level chosen |
| `xake.defaultLanguage` | `en` | `XAKE_DEFAULT_LANGUAGE`: `en` or `fr`, for browsers in another language; each user can still switch in the settings |
| `xake.playMovetimeMs` | `300` | `XAKE_PLAY_MOVETIME_MS`: thinking time of the opponent per move, in the player's browser |
| `xake.extraEnv` | `[]` | any other variable, as a list of `name` / `value` |

Stockfish runs in each player's browser (WebAssembly): the pod only serves the static app and
`/config.js`. The image runs no engine process: it ships Stockfish (WebAssembly) and the Maia
networks as static files, downloaded by each browser.

### Sizing

A static server: the defaults request `20m` CPU and `96Mi`, with a `192Mi` memory limit. The load
does not grow with the number of games, the players' devices do the computing.

### Exposure

No engine on the server, so no CPU to protect: the app can be public. Serve it over TLS: the
service worker (offline launch, home screen install) needs HTTPS.

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

// Network-first app shell: always fresh online, still launches offline (spec 001 §8).
const CACHE = "xake-shell";

const cacheable = (url) => url.origin === location.origin;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// The first page load happens before the worker controls it: the page sends what it loaded so the
// shell is cached at once, not only from the next launch (spec 001 §8).
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache") return;
  const urls = event.data.urls.filter((href) => cacheable(new URL(href)));
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          urls.map((href) =>
            cache
              .match(href, { ignoreSearch: true })
              .then((hit) => hit || fetch(href).then((response) => response.ok && cache.put(href, response))),
          ),
        ),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !cacheable(url)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(event.request, { ignoreSearch: true });
        if (hit) return hit;
        // Any page of the app falls back to the cached shell (e.g. launched from another URL)
        const shell = event.request.mode === "navigate" && (await caches.match("./", { ignoreSearch: true }));
        return shell || Response.error();
      }),
  );
});

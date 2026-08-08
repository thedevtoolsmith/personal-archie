const STATIC_CACHE = "site-static-v2";
const PAGE_CACHE = "site-pages-v2";
const STATIC_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
      precacheHomepageLinkedPages()
    ])
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const activeCaches = new Set([STATIC_CACHE, PAGE_CACHE]);

  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (!activeCaches.has(cacheName)) {
            return caches.delete(cacheName);
          }

          return Promise.resolve();
        })
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, event));
    return;
  }

  if (isStaticAsset(request)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirst(request, event) {
  const cache = await caches.open(PAGE_CACHE);

  try {
    const response = await fetch(request);

    if (response && response.ok) {
      cache.put(request, response.clone());

      if (event && isHomepageRequest(request.url)) {
        event.waitUntil(updateHomepageLinkedPages(response.clone()));
      }
    }

    return response;
  } catch (error) {
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    const offlineResponse = await caches.match("/offline.html");

    if (offlineResponse) {
      return offlineResponse;
    }

    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cachedResponse = await cache.match(request);

  const networkResponsePromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }

      return response;
    })
    .catch(() => null);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await networkResponsePromise;

  if (networkResponse) {
    return networkResponse;
  }

  return new Response("", { status: 504, statusText: "Offline" });
}

function isStaticAsset(request) {
  const destination = request.destination;

  return (
    destination === "style" ||
    destination === "script" ||
    destination === "font" ||
    destination === "image"
  );
}

async function precacheHomepageLinkedPages() {
  try {
    const response = await fetch("/");

    if (!response || !response.ok) {
      return;
    }

    await updateHomepageLinkedPages(response);
  } catch (_error) {
    // Install should still succeed when the homepage cannot be fetched.
  }
}

async function updateHomepageLinkedPages(response) {
  const pageCache = await caches.open(PAGE_CACHE);
  const html = await response.text();
  const urls = extractHomepageLinkedPages(html);

  await Promise.allSettled(
    urls.map(async (url) => {
      const request = new Request(url, { credentials: "same-origin" });
      const cachedResponse = await pageCache.match(request);

      if (cachedResponse) {
        return;
      }

      const networkResponse = await fetch(request);

      if (networkResponse && networkResponse.ok) {
        await pageCache.put(request, networkResponse.clone());
      }
    })
  );
}

function extractHomepageLinkedPages(html) {
  const links = new Set();
  const hrefPattern = /href=["']([^"'#]+)["']/g;
  let match;

  while ((match = hrefPattern.exec(html)) !== null) {
    try {
      const url = new URL(match[1], self.location.origin);

      if (isHomepageLinkedPage(url)) {
        links.add(url.pathname);
      }
    } catch (_error) {
      // Ignore malformed URLs embedded in the page.
    }
  }

  return [...links];
}

function isHomepageLinkedPage(url) {
  if (url.origin !== self.location.origin || url.search) {
    return false;
  }

  const pathname = url.pathname;
  const segments = pathname.split("/").filter(Boolean);

  if (pathname === "/" || pathname.startsWith("/page/")) {
    return false;
  }

  return segments.length >= 2;
}

function isHomepageRequest(urlString) {
  const url = new URL(urlString);

  return url.origin === self.location.origin && url.pathname === "/";
}

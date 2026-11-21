/*global UVServiceWorker,__uv$config*/
importScripts('/baremux/index.js');
importScripts('/uv/uv.bundle.js');
importScripts('/uv.config.js');
importScripts(__uv$config.sw);

const uv = new UVServiceWorker();
const BRIDGE = '<script src="/slurp-frame-bridge.js"></script>';

async function handle(event) {
  if (!uv.route(event)) return fetch(event.request);
  const res = await uv.fetch(event);
  // add the Slurp OS keyboard bridge to proxied HTML pages (iframe/document loads only)
  const dest = event.request.destination;
  if ((dest === 'document' || dest === 'iframe') && /text\/html/i.test(res.headers.get('content-type') || '')) {
    let html = await res.text();
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + BRIDGE) : BRIDGE + html;
    const h = new Headers(res.headers); h.delete('content-length'); h.delete('content-encoding');
    return new Response(html, { status: res.status, statusText: res.statusText, headers: h });
  }
  return res;
}
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => e.respondWith(handle(e)));

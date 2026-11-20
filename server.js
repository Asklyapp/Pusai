// SlurpOS web proxy: loads a page, strips the headers that block iframes,
// and injects the keyboard bridge. Deploy on Render (Web Service, Node, `npm start`).
import express from 'express';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
app.set('trust proxy', true);   // Render terminates https, so req.protocol would otherwise say http
const here = path.dirname(fileURLToPath(import.meta.url));
const SELF = process.env.PUBLIC_URL || '';          // optional: https://your-app.onrender.com
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Block private/internal addresses so the proxy can't be used to poke at your server's network
const isPrivate = ip => net.isIPv4(ip)
  ? /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
  : /^(::1|fc|fd|fe80)/i.test(ip);
async function safeUrl(raw) {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol');
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (addrs.some(a => isPrivate(a.address))) throw new Error('blocked address');
  return u;
}

app.get('/slurp-frame-bridge.js', (req, res) => {
  res.set('Cache-Control', 'no-cache').type('application/javascript').sendFile(path.join(here, 'slurp-frame-bridge.js'));
});
app.get('/', (req, res) => res.send('SlurpOS proxy is running.'));

app.options('/proxy', (req, res) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*', 'Access-Control-Max-Age': '86400' }).sendStatus(204);
});

app.all('/proxy', express.raw({ type: () => true, limit: '10mb' }), async (req, res) => {
  try {
    const target = await safeUrl(req.query.url);
    const fwd = { 'user-agent': UA, 'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9', origin: target.origin, referer: target.origin + '/' };
    for (const h of ['content-type', 'accept', 'authorization']) if (req.headers[h]) fwd[h] = req.headers[h];
    for (const h in req.headers) if (/^x-(?!slurp|forwarded|render|request-id)/i.test(h)) fwd[h] = req.headers[h];
    const hasBody = !/^(GET|HEAD)$/i.test(req.method) && Buffer.isBuffer(req.body) && req.body.length;
    const r = await fetch(target, { method: req.method, redirect: 'follow', headers: fwd, body: hasBody ? req.body : undefined });
    const finalUrl = r.url || target.href;
    const type = r.headers.get('content-type') || 'application/octet-stream';
    res.status(r.status);
    res.set('Content-Type', type);
    res.removeHeader('X-Frame-Options');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Expose-Headers', '*');
    if (!/text\/html/i.test(type)) return res.send(Buffer.from(await r.arrayBuffer()));

    let html = await r.text();
    const base = `<base href="${finalUrl.replace(/"/g, '&quot;')}">`;
    const origin = (SELF || `https://${req.get('host')}`).replace(/\/$/, '');   // must be absolute: <base> makes relative URLs resolve to the target site
    const bridge = `<script>window.__SLURP_PROXY__=${JSON.stringify(origin)};window.__SLURP_URL__=${JSON.stringify(finalUrl)};</script><script src="${origin}/slurp-frame-bridge.js"></script>`;
    // drop <meta> CSP tags (they'd block our script), then inject right after <head>
    html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + base + bridge) : base + bridge + html;
    res.send(html);   // no CSP / X-Frame-Options header is sent, so the frame is allowed
  } catch (e) {
    res.status(502).type('html').send(`<body style="font:16px -apple-system,sans-serif;padding:40px;text-align:center"><h3>Couldn't load this page</h3><p>${String(e.message).replace(/</g, '&lt;')}</p></body>`);
  }
});

app.listen(process.env.PORT || 3000, () => console.log('SlurpOS proxy up'));

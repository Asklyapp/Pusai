// SlurpOS web proxy: loads a page, strips the headers that block iframes,
// and injects the keyboard bridge. Deploy on Render (Web Service, Node, `npm start`).
import express from 'express';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
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

app.get('/proxy', async (req, res) => {
  try {
    const target = await safeUrl(req.query.url);
    const r = await fetch(target, { redirect: 'follow', headers: { 'user-agent': UA, 'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9' } });
    const finalUrl = r.url || target.href;
    const type = r.headers.get('content-type') || 'application/octet-stream';
    res.status(r.status);
    res.set('Content-Type', type);
    res.removeHeader('X-Frame-Options');
    res.set('Access-Control-Allow-Origin', '*');
    if (!/text\/html/i.test(type)) return res.send(Buffer.from(await r.arrayBuffer()));

    let html = await r.text();
    const base = `<base href="${finalUrl.replace(/"/g, '&quot;')}">`;
    const bridge = `<script>window.__SLURP_PROXY__=${JSON.stringify(SELF || `${req.protocol}://${req.get('host')}`)};window.__SLURP_URL__=${JSON.stringify(finalUrl)};</script><script src="${SELF || ''}/slurp-frame-bridge.js"></script>`;
    // drop <meta> CSP tags (they'd block our script), then inject right after <head>
    html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + base + bridge) : base + bridge + html;
    res.send(html);   // no CSP / X-Frame-Options header is sent, so the frame is allowed
  } catch (e) {
    res.status(502).type('html').send(`<body style="font:16px -apple-system,sans-serif;padding:40px;text-align:center"><h3>Couldn't load this page</h3><p>${String(e.message).replace(/</g, '&lt;')}</p></body>`);
  }
});

app.listen(process.env.PORT || 3000, () => console.log('SlurpOS proxy up'));

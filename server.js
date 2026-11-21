// SlurpOS web proxy v6: a real rewriting proxy (Ultraviolet service worker + Wisp transport).
// Deploy on Render (Web Service, Node, build: `npm install`, start: `npm start`).
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { server as wisp } from '@mercuryworkshop/wisp-js/server';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const uvPath = require('@titaniumnetwork-dev/ultraviolet').uvPath;
const baremuxPath = require('@mercuryworkshop/bare-mux/node').baremuxPath;
const epoxyDist = path.join(here, 'node_modules', '@mercuryworkshop', 'epoxy-transport', 'dist');

const app = express();
app.set('trust proxy', true);
// Slurp OS embeds this in an iframe from another origin, so never send frame-blocking headers
app.use((req, res, next) => { res.removeHeader('X-Frame-Options'); res.set('Access-Control-Allow-Origin', '*'); next(); });

app.use('/uv/', express.static(uvPath, { maxAge: '1h' }));
app.use('/baremux/', express.static(baremuxPath, { maxAge: '1h' }));
app.use('/epoxy/', express.static(epoxyDist, { maxAge: '1h' }));
// sw.js, bridge and go.html must never be stale
app.use(express.static(path.join(here, 'public'), { setHeaders: r => r.setHeader('Cache-Control', 'no-cache') }));
app.get('/', (req, res) => res.send('SlurpOS proxy v6 is running.'));

const server = http.createServer(app);
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/wisp/')) wisp.routeRequest(req, socket, head);
  else socket.destroy();
});
server.listen(process.env.PORT || 3000, () => console.log('SlurpOS proxy v6 up'));

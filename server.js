// SlurpOS web proxy v7: server-side rewriting proxy (Rammerhead). NO service workers needed,
// so it works inside Slurp OS's iframe on iPhone Safari.
// Render: Web Service, Node. Build: `npm install`. Start: `npm start`.
const path = require('path');
const os = require('os');
const RH = require('rammerhead/src');
const RammerheadSessionFileCache = require('rammerhead/src/classes/RammerheadSessionFileCache');
const RammerheadSession = require('rammerhead/src/classes/RammerheadSession');
const generateId = require('rammerhead/src/util/generateId');

// inject the Slurp OS keyboard bridge into Rammerhead's client script (runs inside every proxied page, after hammerhead starts)
(function injectBridge() {
  const fs = require('fs');
  const dir = path.join(path.dirname(require.resolve('rammerhead/package.json')), 'src', 'client');
  const bridge = fs.readFileSync(path.join(__dirname, 'bridge', 'slurp-frame-bridge.js'), 'utf8');
  const wrapped = '\n;/*SLURP_BRIDGE*/(window.rammerheadStartListeners = window.rammerheadStartListeners || []).push(function () { try {\n' + bridge + '\n} catch (e) {} });\n';
  for (const f of ['rammerhead.min.js', 'rammerhead.js']) {
    const p = path.join(dir, f); let c = fs.readFileSync(p, 'utf8');
    const k = c.indexOf('/*SLURP_BRIDGE*/'); if (k !== -1) c = c.slice(0, k);
    fs.writeFileSync(p, c + wrapped);
  }
})();

const PORT = parseInt(process.env.PORT || '3000', 10);
const logger = new RH.RammerheadLogging({ logLevel: 'info', generatePrefix: l => `[${l.toUpperCase()}] ` });
const tmp = path.join(os.tmpdir(), 'slurp-rh');
require('fs').mkdirSync(path.join(tmp, 'sessions'), { recursive: true });

const proxy = new RH.RammerheadProxy({
  logger,
  loggerGetIP: req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim(),
  bindingAddress: '0.0.0.0',
  port: PORT,
  crossDomainPort: null,                 // Render exposes one port only
  ssl: null,                             // Render terminates https for us
  // tell Rammerhead to rewrite links using the public https address Render gives us
  getServerInfo: req => {
    const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').toString().split(',')[0];
    const https = (req.headers['x-forwarded-proto'] || '').toString().startsWith('https');
    const [hostname, port] = host.split(':');
    return { hostname, port: port ? +port : (https ? 443 : 80), protocol: https ? 'https:' : 'http:' };
  },
  disableLocalStorageSync: false,
  jsCache: new RH.RammerheadJSMemCache(50 * 1024 * 1024),
  disableHttp2: false,
});

// Slurp OS embeds pages from another origin, so never block framing
Object.assign(proxy.rewriteServerHeaders, { 'x-frame-options': null, 'content-security-policy': null, 'content-security-policy-report-only': null });

RH.addStaticFilesToProxy(proxy, path.join(__dirname, 'public'));

const store = new RammerheadSessionFileCache({ logger, saveDirectory: path.join(tmp, 'sessions'),
  cacheTimeout: 20 * 60 * 1000, cacheCheckInterval: 10 * 60 * 1000, deleteUnused: true,
  staleCleanupOptions: { staleTimeout: 3 * 24 * 3600 * 1000, maxToLive: null, staleCheckInterval: 6 * 3600 * 1000 }, deleteCorruptedSessions: true });
store.attachToProxy(proxy);

// /newsession -> returns a fresh session id (no password, no IP lock: Render sits behind a load balancer)
proxy.GET('/newsession', (req, res) => {
  const id = generateId();
  store.addSerializedSession(id, new RammerheadSession().serializeSession());
  res.setHeader('Access-Control-Allow-Origin', '*'); res.end(id);
});
proxy.GET('/sessionexists', (req, res) => {
  const id = new RH.URLPath(req.url).get('id');
  res.setHeader('Access-Control-Allow-Origin', '*'); res.end(id && store.has(id) ? 'exists' : 'not found');
});
proxy.GET('/health', (req, res) => res.end('SlurpOS proxy v7 ok'));

logger.info(`SlurpOS proxy v7 listening on ${PORT}`);

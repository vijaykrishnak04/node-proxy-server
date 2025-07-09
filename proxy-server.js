/**
 * proxy-server.js  –  lightweight reverse proxy with NGINX‑style logs
 * -------------------------------------------------------------------
 *  ▶ node proxy-server.js
 */

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

// ────────────────────────────────────────────────────────────────────────────────
// ENV & constants
// ────────────────────────────────────────────────────────────────────────────────
const PORT           = process.env.PORT || 8080;
const BACKEND_PORT   = 3001;
const FRONTEND_PORT  = 3000;
const SFCC_TARGET    = 'https://azdev01.shoplc.com';

// ────────────────────────────────────────────────────────────────────────────────
// Tiny NGINX‑style logger
// ────────────────────────────────────────────────────────────────────────────────
function logger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
               req.socket.remoteAddress;
    const up = res.locals.upstreamStatus ?? '-';
    console.log(`${ip} - - [${new Date().toISOString()}] "` +
      `${req.method} ${req.originalUrl} HTTP/${req.httpVersion}" ` +
      `${res.statusCode} ${up} "${req.headers.referer || '-'}" ` +
      `"${req.headers['user-agent'] || '-'}" ${ms.toFixed(2)}ms`);
  });
  next();
}

// ────────────────────────────────────────────────────────────────────────────────
// Shared proxy settings
// ────────────────────────────────────────────────────────────────────────────────
function proxyCommon() {
  return {
    changeOrigin: true,
    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader('X-Real-IP', req.ip);
      proxyReq.setHeader('X-Forwarded-For', req.ip);
      proxyReq.setHeader('X-Forwarded-Proto', 'http');
      proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
    },
    onProxyRes: (_, __, res) => { res.locals.upstreamStatus = _.statusCode; },
    onError:    (err, req) => {
      console.error(`⚠️  Proxy error for ${req.method} ${req.originalUrl}`, err);
    },
  };
}

// Helper – keep original mount prefix
const keepPrefix = (prefix) => (path) => `${prefix}${path}`;

// ────────────────────────────────────────────────────────────────────────────────
// App
// ────────────────────────────────────────────────────────────────────────────────
const app = express();
app.use(logger);                                // access logs first

/* ─────  API  ─────────────────────────────── */
app.use('/api/v1',
  createProxyMiddleware({
    target: `http://localhost:${BACKEND_PORT}`,
    pathRewrite: keepPrefix('/api/v1'),
    headers: { Host: 'localhost' },
    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader('X-Real-IP', req.ip);
      proxyReq.setHeader('x-forwarded-for', req.ip);
      proxyReq.setHeader('x-forwarded-proto', 'http');
      proxyReq.setHeader('x-forwarded-host', 'localhost');  // Match nginx config
    },
    onProxyRes: (_, __, res) => { res.locals.upstreamStatus = _.statusCode; },
    onError: (err, req) => {
      console.error(`⚠️  Proxy error for ${req.method} ${req.originalUrl}`, err);
    },
    changeOrigin: true,
  })
);

/* ─────  SFCC (azdev01.shoplc.com)  ───────── */
const sfccRoutes = [
  ['/login',               keepPrefix('/login')],
  ['/generateCSRFToken',   keepPrefix('/generateCSRFToken')],
  ['/s',                   keepPrefix('/s')],
  ['/on',                  keepPrefix('/on')],
  ['/slots',               keepPrefix('/slots')],
];

sfccRoutes.forEach(([route, rewrite]) =>
  app.use(route,
    createProxyMiddleware({
      target: SFCC_TARGET,
      pathRewrite: rewrite,
      changeOrigin: true,
      secure: false,       // ignore self‑signed certs in dev
      ...proxyCommon(),
    })
  )
);

/* ─────  Next.js front‑end  ──────────────── */
app.use('/_next/webpack-hmr',
  createProxyMiddleware({
    target: `http://localhost:${FRONTEND_PORT}`,
    ws: true,
    headers: { Connection: 'upgrade' },
    ...proxyCommon(),
  })
);

app.use('/',
  createProxyMiddleware({
    target: `http://localhost:${FRONTEND_PORT}`,
    ws: true,
    headers: { Host: `localhost:${PORT}` },
    ...proxyCommon(),
  })
);

// ────────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`⚡️  Reverse proxy running on http://localhost:${PORT}`)
);
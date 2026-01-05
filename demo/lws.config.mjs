/**
 * Configuration file for local-web-server
 * See: https://github.com/lwsjs/local-web-server/wiki/How-to-create-middleware
 */
import ProxyMiddleware from './proxy-middleware.mjs';

export default {
  port: parseInt(process.env.PORT) || 8082,
  compress: true,
  logFormat: 'combined',
  stack: [
    ProxyMiddleware,
    'lws-static',
    'lws-index',
    'lws-compress'
  ]
}

/**
 * CORS Proxy Middleware for local-web-server
 * Allows fetching external URLs from the backend to bypass browser CORS restrictions
 */
class ProxyMiddleware {
  middleware() {
    // Allowed domains (whitelist)
    const ALLOWED_DOMAINS = [
      'drive.google.com',
      'www.dropbox.com',
      'onedrive.live.com',
      // Add more trusted domains as needed
    ];

    /**
     * Convert Google Drive share URLs to direct download URLs
     */
    const convertGoogleDriveUrl = (url) => {
      const match = url.match(/drive\.google\.com\/file\/d\/([^\/]+)/);
      if (match) {
        const fileId = match[1];
        return `https://drive.google.com/uc?export=download&id=${fileId}`;
      }
      return url;
    };

    /**
     * Convert Dropbox share URLs to direct download URLs
     */
    const convertDropboxUrl = (url) => {
      // Change dl=0 to dl=1 for direct download
      if (url.includes('dropbox.com') && url.includes('dl=0')) {
        return url.replace('dl=0', 'dl=1');
      }
      // If no dl parameter, add dl=1
      if (url.includes('dropbox.com') && !url.includes('dl=')) {
        const separator = url.includes('?') ? '&' : '?';
        return url + separator + 'dl=1';
      }
      return url;
    };

    /**
     * Convert OneDrive share URLs to direct download URLs
     */
    const convertOneDriveUrl = (url) => {
      // OneDrive/1drv.ms links - add download=1 parameter
      if (url.includes('onedrive.live.com') || url.includes('1drv.ms')) {
        const separator = url.includes('?') ? '&' : '?';
        return url + separator + 'download=1';
      }
      return url;
    };

    /**
     * Convert all supported cloud storage URLs to direct download format
     */
    const convertToDirectDownload = (url) => {
      let convertedUrl = url;
      convertedUrl = convertGoogleDriveUrl(convertedUrl);
      convertedUrl = convertDropboxUrl(convertedUrl);
      convertedUrl = convertOneDriveUrl(convertedUrl);
      return convertedUrl;
    };

    return async (ctx, next) => {
      console.log('[ProxyMiddleware] Request:', ctx.path);
      
      // Only handle /proxy and /pxy endpoints
      if (!ctx.path.startsWith('/proxy') && !ctx.path.startsWith('/pxy')) {
        return next();
      }

      console.log('[ProxyMiddleware] Handling proxy request for:', ctx.query.url);
      
      // Get the target URL from query parameter
      let targetUrl = ctx.query.url;
      
      if (!targetUrl) {
        ctx.status = 400;
        ctx.body = 'Missing url parameter. Use: /proxy?url=https://example.com/file.xml';
        return;
      }

      try {
        // Validate URL format
        const parsedUrl = new URL(targetUrl);
        
        // Check if domain is allowed
        const hostname = parsedUrl.hostname;
        const isAllowed = ALLOWED_DOMAINS.some(domain => 
          hostname === domain || hostname.endsWith('.' + domain)
        );
        
        if (!isAllowed) {
          ctx.status = 403;
          ctx.body = `Domain not allowed: ${hostname}. Allowed domains: ${ALLOWED_DOMAINS.join(', ')}`;
          console.log('[ProxyMiddleware] Blocked domain:', hostname);
          return;
        }
        
        // Convert cloud storage URLs to direct download format
        targetUrl = convertToDirectDownload(targetUrl);
        console.log('[ProxyMiddleware] Fetching:', targetUrl);
        
        // Fetch the external resource (URL may have been converted)
        const response = await fetch(targetUrl);
        
        if (!response.ok) {
          ctx.status = response.status;
          ctx.body = `Failed to fetch: ${response.statusText}`;
          return;
        }

        // Get the response as a buffer
        const buffer = await response.arrayBuffer();
        
        // Set response headers
        ctx.status = 200;
        ctx.type = response.headers.get('content-type') || 'application/octet-stream';
        
        // Add CORS headers to allow browser access
        ctx.set('Access-Control-Allow-Origin', '*');
        ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        ctx.set('Access-Control-Allow-Headers', 'Content-Type');
        
        // Set the body
        ctx.body = Buffer.from(buffer);
        
      } catch (error) {
        ctx.status = 500;
        ctx.body = `Proxy error: ${error.message}`;
      }
    };
  }
}

export default ProxyMiddleware;

# PWA (Progressive Web App) Setup

Your MusicXML Player is now a Progressive Web App! Users can install it on their devices like a native app.

## Files Added

- `manifest.json` - App configuration
- `service-worker.js` - Offline caching and performance
- `icon-192.svg` - Small app icon (SVG format)
- `icon-512.svg` - Large app icon (SVG format)
- `convert-icons.html` - Tool to convert SVG icons to PNG (optional)

## How Users Install the App

### On iPhone/iPad:
1. Open Safari and visit your website
2. Tap the Share button (square with arrow)
3. Scroll down and tap "Add to Home Screen"
4. Tap "Add" in the top right
5. The app icon appears on the home screen
6. Tapping it opens the app full-screen (no URL bar!)

### On Android:
1. Open Chrome and visit your website
2. Tap the menu (three dots)
3. Tap "Add to Home screen" or "Install app"
4. Tap "Install"
5. The app icon appears on the home screen

### On Desktop (Chrome/Edge):
1. Visit your website
2. Look for the install icon in the address bar
3. Click "Install"

## Optional: Convert Icons to PNG

While SVG icons work on most devices, PNG icons provide better compatibility:

1. Open your browser and navigate to: `http://your-server/convert-icons.html`
2. The icons will be rendered on the page
3. Click the download buttons to save PNG versions
4. Replace the SVG references in `manifest.json` with PNG:
   ```json
   "icons": [
     {
       "src": "icon-192.png",
       "sizes": "192x192",
       "type": "image/png",
       "purpose": "any maskable"
     },
     {
       "src": "icon-512.png",
       "sizes": "512x512",
       "type": "image/png",
       "purpose": "any maskable"
     }
   ]
   ```

## Testing

1. Deploy your updated code to your server
2. Clear browser cache (or use incognito/private mode)
3. Visit your website
4. Try installing it on your device
5. Launch from home screen to test

## Features

✅ **Full-screen experience** - No browser UI when launched from home screen
✅ **Offline support** - Basic caching for faster loading
✅ **Native feel** - Looks and behaves like a native app
✅ **Cross-platform** - Works on iOS, Android, and desktop
✅ **No App Store** - Users install directly from your website

## Next Steps

Once users install the PWA, you can add more features:
- Push notifications (requires HTTPS)
- Background sync
- Enhanced offline functionality
- Native device features (camera, etc.)

## Requirements

- Must be served over HTTPS (except localhost for testing)
- Service worker requires HTTPS in production

Your app is now ready to be installed as a PWA! 🎉

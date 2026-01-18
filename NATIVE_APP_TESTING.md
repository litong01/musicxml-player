# Testing Native App Locally with Xcode Simulator

## Quick Start Guide

### 1. Update Kinde Configuration

Edit `demo/auth-config.js` and add your Kinde credentials:

```javascript
export const KINDE_CONFIG = {
  client_id: 'YOUR_KINDE_CLIENT_ID',  // From Kinde dashboard
  domain: 'https://YOUR_SUBDOMAIN.kinde.com',
  redirect_uri: '', // Will be set automatically
  logout_uri: '',
  scope: 'openid profile email offline',
  audience: '',
};

export const AUTH_ENABLED = true; // Set to true to enable auth
```

### 2. Sync and Open in Xcode

```bash
npm run cap:build
npm run cap:ios
```

This will:
- Build the web assets
- Sync to iOS project
- Open the project in Xcode

### 3. Run in Xcode Simulator

1. In Xcode, select a simulator (e.g., iPhone 15 Pro)
2. Click the ▶️ Play button or press `Cmd + R`
3. Wait for the build to complete
4. App will launch in the simulator

### 4. Test Authentication Flow

1. App opens in simulator
2. Click "Login" button
3. System browser opens with Kinde login page
4. Enter your credentials
5. After successful login, you'll be redirected back to the app via `com.mysoloband.app://callback`
6. App receives the callback and completes authentication

## Testing Without Kinde (Optional)

If you want to test the app without authentication first:

In `demo/auth-config.js`:
```javascript
export const AUTH_ENABLED = false; // Disable auth
```

Then run `npm run cap:build` again.

## Troubleshooting

### Common iOS Simulator Warnings (SAFE TO IGNORE)
These errors appear in Xcode console but don't affect functionality:
- "Failed to request storage access user agent string quirks from WebPrivacy"
- "Unable to simultaneously satisfy constraints" (keyboard layout)
- "-[RTIInputSystemClient remoteTextInputSessionWithID...]"

These are normal iOS 18+ simulator warnings and won't appear on real devices.

### Notes Not Rendering - Enable Safari Web Inspector

To see actual JavaScript errors:

1. **Enable Web Inspector in Simulator**:
   - Simulator menu → Settings → Safari → Advanced
   - Enable "Web Inspector"

2. **Open Safari Developer Tools**:
   - On your Mac, open Safari
   - Safari menu → Settings → Advanced
   - Check "Show Develop menu in menu bar"
   - Develop menu → Simulator → MySoloBand → index.html

3. **Check Console for Real Errors**:
   - Look for red errors about Verovio, OSMD, or file loading
   - Common issues:
     - WebAssembly loading errors
     - CORS issues with local files
     - Missing dependencies

### Music Not Rendering - Check Console

If Safari console shows errors about Verovio or WASM:

1. Make sure you ran `npm run cap:build` after any changes
2. Check that demo/build/ folder has all assets
3. Try with a simpler file first (e.g., "asa-branca.musicxml")

### "No such file or directory" errors
Run: `npm run cap:build` to sync the latest web assets

### Custom URL scheme not working
Check `ios/App/App/Info.plist` contains:
```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>com.mysoloband.app</string>
        </array>
    </dict>
</array>
```

### Browser not opening on simulator
Make sure you're using a physical device or simulator with iOS 14+

## Live Reload During Development

For faster development, you can use live reload:

1. Start web server: `cd demo && python3 -m http.server 8080`
2. Update `capacitor.config.ts`:
   ```typescript
   server: {
     url: 'http://localhost:8080',
     cleartext: true
   }
   ```
3. Rebuild and run in Xcode

Changes to web files will auto-reload without rebuilding the iOS app!

## Building for Device/App Store

When ready to build for a real device or App Store:

1. Remove the `server` config from `capacitor.config.ts`
2. In Xcode:
   - Select "Any iOS Device" or your connected device
   - Product → Archive
   - Distribute to App Store or TestFlight

## Next Steps

- Configure app icons and splash screens
- Set up code signing for distribution
- Add additional Capacitor plugins as needed (Camera, File Picker, etc.)

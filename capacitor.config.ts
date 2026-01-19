import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mysoloband.app',
  appName: 'MySoloBand',
  webDir: 'demo',
  server: {
    // Allow navigation to external URLs for OAuth
    allowNavigation: ['*.kinde.com']
  },
  ios: {
    contentInset: 'always',
    // Enable WebAssembly support
    preferredContentMode: 'mobile',
    limitsNavigationsToAppBoundDomains: false
  },
  plugins: {
    Browser: {
      presentationStyle: 'fullscreen'
    }
  }
};

export default config;

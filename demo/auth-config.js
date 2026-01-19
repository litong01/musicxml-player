// Authentication configuration for native apps
// For Capacitor apps, these values should be set during build time
// or loaded from a secure storage/config service

export const KINDE_CONFIG = {
  client_id: 'fcb05db8b435460bb6e266ad6639e420',
  domain: 'https://tempoaide.kinde.com',
  redirect_uri: '', // Will be set dynamically based on platform
  logout_uri: '',
  scope: 'openid profile email offline',
  audience: '',
};

export const AUTH_ENABLED = true; // Set to true when Kinde credentials are configured

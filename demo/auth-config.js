// Default configuration file - replaced at runtime by Docker
// This file is used during local development only

export const KINDE_CONFIG = {
  client_id: '',
  domain: '',
  redirect_uri: window.location.origin,
  logout_uri: window.location.origin,
  scope: 'openid profile email offline',
  audience: '',
};

export const AUTH_ENABLED = false;

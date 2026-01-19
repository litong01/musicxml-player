/**
 * Authentication module for native apps using Kinde OAuth/OIDC
 * Adapted for Capacitor native iOS and Android apps
 */

import { KINDE_CONFIG, AUTH_ENABLED } from './auth-config.js';

class AuthManager {
  constructor() {
    this.client = null;
    this.user = null;
    this.authEnabled = AUTH_ENABLED;
    this.codeVerifier = null; // For PKCE
  }

  /**
   * Initialize the authentication system
   * For native apps, this will use Capacitor Browser plugin for OAuth flow
   */
  async initialize() {
    if (!this.authEnabled || !KINDE_CONFIG.client_id) {
      console.log('[Auth] Authentication is disabled or not configured');
      return;
    }

    console.log('[Auth] Starting initialization...');
    console.log('[Auth] Capacitor available:', !!window.Capacitor);
    console.log('[Auth] Capacitor.Plugins available:', !!window.Capacitor?.Plugins);
    console.log('[Auth] Capacitor.Plugins.App available:', !!window.Capacitor?.Plugins?.App);
    
    try {
      // For native apps, we'll use Capacitor's Browser plugin for OAuth
      // Check if we're in a Capacitor environment
      if (window.Capacitor) {
        console.log('Running in Capacitor - using native OAuth flow');
        await this.initializeNativeAuth();
        console.log('[Auth] Native auth initialized');
      } else {
        console.log('Running in web browser - using web OAuth flow');
        await this.initializeWebAuth();
        console.log('[Auth] Web auth initialized');
      }

      // Check if we're returning from OAuth callback
      console.log('[Auth] Checking for OAuth callback...');
      await this.handleCallback();
      console.log('[Auth] Callback check complete');
    } catch (error) {
      console.error('[Auth] Failed to initialize auth:', error);
      // Don't re-throw - let the app continue
    }
    console.log('[Auth] Initialization complete');
    return; // Explicit return to ensure promise resolves
  }

  /**
   * Initialize authentication for native apps using Capacitor
   */
  async initializeNativeAuth() {
    // Set platform-specific redirect URIs
    const platform = window.Capacitor.getPlatform();
    const appId = 'com.mysoloband.app'; // Should match capacitor.config.ts
    
    if (platform === 'ios') {
      KINDE_CONFIG.redirect_uri = `${appId}://callback`;
      KINDE_CONFIG.logout_uri = `${appId}://logout`;
    } else if (platform === 'android') {
      KINDE_CONFIG.redirect_uri = `${appId}://callback`;
      KINDE_CONFIG.logout_uri = `${appId}://logout`;
    }

    console.log('[Auth] Native redirect URIs configured:', {
      redirect_uri: KINDE_CONFIG.redirect_uri,
      logout_uri: KINDE_CONFIG.logout_uri
    });

    // Set up deep link listener for OAuth callback
    try {
      console.log('[Auth] Checking for Capacitor.Plugins.App...');
      if (!window.Capacitor?.Plugins?.App) {
        console.error('[Auth] Capacitor App plugin not available!');
      } else {
        console.log('[Auth] Setting up deep link listener...');
        const { App } = window.Capacitor.Plugins;
        await App.addListener('appUrlOpen', async (data) => {
          console.log('[Auth] Deep link received:', data.url);
          await this.handleDeepLink(data.url);
        });
        console.log('[Auth] Deep link listener registered successfully');
      }
    } catch (error) {
      console.error('[Auth] Failed to register deep link listener:', error);
    }

    // Load saved session if available
    await this.loadSavedSession();
    
    // Don't check for pending auth code here - do it after full app initialization
    // This avoids network restrictions during app startup
  }

  /**
   * Complete pending authentication after app is fully initialized
   * Call this after app initialization is complete to avoid network restrictions
   */
  async completePendingAuth() {
    await this.checkPendingAuthCode();
  }

  /**
   * Complete pending authentication after app is fully initialized
   * Call this after app initialization is complete to avoid network restrictions
   */
  async completePendingAuth() {
    await this.checkPendingAuthCode();
  }

  /**
   * Check for and process pending authorization code
   */
  async checkPendingAuthCode() {
    try {
      if (window.Capacitor?.Plugins?.Preferences) {
        const { Preferences } = window.Capacitor.Plugins;
        const { value } = await Preferences.get({ key: 'kinde_pending_code' });
        
        if (value) {
          const { code, codeVerifier, timestamp } = JSON.parse(value);
          console.log('[Auth] Found pending authorization code from', new Date(timestamp));
          
          // Restore the code verifier
          this.codeVerifier = codeVerifier;
          
          // Clear the pending code immediately
          await Preferences.remove({ key: 'kinde_pending_code' });
          
          // Check if code is not too old (5 minutes max)
          if (Date.now() - timestamp < 5 * 60 * 1000) {
            // Wait for network stack to fully initialize after app restart
            console.log('[Auth] Waiting for network stack to initialize...');
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            console.log('[Auth] Exchanging pending authorization code for token...');
            const userData = await this.exchangeCodeForToken(code);
            if (userData) {
              this.user = userData;
              await this.saveSession(userData);
              console.log('[Auth] Authentication complete! Reloading...');
              window.location.reload();
            } else {
              console.error('[Auth] Failed to exchange pending code');
            }
          } else {
            console.log('[Auth] Pending code expired, ignoring');
          }
        }
      }
    } catch (error) {
      console.error('[Auth] Error checking pending auth code:', error);
    }
  }

  /**
   * Initialize authentication for web browser
   */
  async initializeWebAuth() {
    // Use current origin for web
    KINDE_CONFIG.redirect_uri = window.location.origin;
    KINDE_CONFIG.logout_uri = window.location.origin;

    // Dynamically import Kinde SDK for web
    const { default: createKindeClient } = await import(
      'https://cdn.jsdelivr.net/npm/@kinde-oss/kinde-auth-pkce-js@3/+esm'
    );
    this.client = await createKindeClient(KINDE_CONFIG);
  }

  /**
   * Load saved session from secure storage
   */
  async loadSavedSession() {
    try {
      // Check if we have Capacitor Preferences plugin
      if (window.Capacitor?.Plugins?.Preferences) {
        const { Preferences } = window.Capacitor.Plugins;
        const { value } = await Preferences.get({ key: 'kinde_session' });
        if (value) {
          this.user = JSON.parse(value);
        }
      }
    } catch (error) {
      console.error('Failed to load saved session:', error);
    }
  }

  /**
   * Save session to secure storage
   */
  async saveSession(userData) {
    try {
      if (window.Capacitor?.Plugins?.Preferences) {
        const { Preferences } = window.Capacitor.Plugins;
        await Preferences.set({
          key: 'kinde_session',
          value: JSON.stringify(userData),
        });
      }
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback() {
    try {
      if (window.Capacitor) {
        // Native app callback handling
        await this.handleNativeCallback();
      } else if (this.client) {
        // Web callback handling
        const isCallback = await this.client.isAuthenticated();
        if (isCallback) {
          this.user = await this.client.getUserProfile();
          window.dispatchEvent(new CustomEvent('auth-callback-complete'));
        }
      }
    } catch (error) {
      console.error('Callback handling failed:', error);
    }
  }

  /**
   * Handle OAuth callback in native app
   */
  async handleNativeCallback() {
    // This is called during initialization to check if we're coming back from OAuth
    // The actual callback is now handled via deep link listener
    console.log('[Auth] Checking for pending callback...');
  }

  /**
   * Handle deep link callback from OAuth flow
   */
  async handleDeepLink(url) {
    try {
      console.log('[Auth] Processing deep link:', url);
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      const state = urlObj.searchParams.get('state');
      
      if (code) {
        console.log('[Auth] Authorization code received');
        
        // Save the code AND code_verifier to handle after reload (when we have proper network access)
        if (window.Capacitor?.Plugins?.Preferences) {
          const { Preferences } = window.Capacitor.Plugins;
          await Preferences.set({
            key: 'kinde_pending_code',
            value: JSON.stringify({ 
              code, 
              codeVerifier: this.codeVerifier,
              timestamp: Date.now() 
            }),
          });
          console.log('[Auth] Saved pending authorization code and verifier');
        }
        
        // Close the browser
        try {
          const { Browser } = window.Capacitor.Plugins;
          await Browser.close();
        } catch (e) {
          console.log('[Auth] Browser close failed or already closed');
        }
        
        // Reload the app - token exchange will happen on startup
        console.log('[Auth] Reloading app to complete authentication...');
        window.location.reload();
      }
    } catch (error) {
      console.error('[Auth] Deep link handling failed:', error);
      try {
        const { Browser } = window.Capacitor.Plugins;
        await Browser.close();
      } catch (e) {
        // Ignore
      }
    }
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code) {
    try {
      // Exchange code for token with Kinde's token endpoint
      const tokenUrl = `${KINDE_CONFIG.domain}/oauth2/token`;
      
      const bodyParams = {
        grant_type: 'authorization_code',
        client_id: KINDE_CONFIG.client_id,
        code: code,
        redirect_uri: KINDE_CONFIG.redirect_uri,
        code_verifier: this.codeVerifier, // PKCE verifier
      };

      console.log('[Auth] Requesting token from:', tokenUrl);
      console.log('[Auth] Using code_verifier for PKCE');
      console.log('[Auth] Request params:', bodyParams);
      
      let response;
      try {
        // Use Capacitor HTTP plugin for native apps instead of fetch
        if (window.Capacitor?.Plugins?.CapacitorHttp) {
          const { CapacitorHttp } = window.Capacitor.Plugins;
          console.log('[Auth] Using Capacitor HTTP plugin');
          response = await CapacitorHttp.post({
            url: tokenUrl,
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            data: bodyParams,
          });
          console.log('[Auth] Token response received via CapacitorHttp');
          console.log('[Auth] Response status:', response.status);
        } else {
          // Fallback to fetch for web
          const body = new URLSearchParams(bodyParams);
          const fetchResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
          });
          console.log('[Auth] Token response received via fetch');
          console.log('[Auth] Response status:', fetchResponse.status);
          response = {
            status: fetchResponse.status,
            data: await fetchResponse.json(),
          };
        }
      } catch (httpError) {
        console.error('[Auth] HTTP request failed:', httpError);
        console.error('[Auth] Error name:', httpError.name);
        console.error('[Auth] Error message:', httpError.message);
        throw httpError;
      }

      if (response.status !== 200) {
        console.error('[Auth] Token exchange failed:', response.status, response.data);
        return null;
      }

      const tokenData = response.data;
      console.log('[Auth] Token received successfully');
      console.log('[Auth] Token data keys:', Object.keys(tokenData));
      
      // Fetch user profile with access token
      const profileUrl = `${KINDE_CONFIG.domain}/oauth2/user_profile`;
      let profileResponse;
      
      if (window.Capacitor?.Plugins?.CapacitorHttp) {
        const { CapacitorHttp } = window.Capacitor.Plugins;
        profileResponse = await CapacitorHttp.get({
          url: profileUrl,
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
          },
        });
        console.log('[Auth] Profile response status:', profileResponse.status);
      } else {
        const fetchResponse = await fetch(profileUrl, {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
          },
        });
        console.log('[Auth] Profile response status:', fetchResponse.status);
        profileResponse = {
          status: fetchResponse.status,
          data: await fetchResponse.json(),
        };
      }

      if (profileResponse.status !== 200) {
        console.error('[Auth] Failed to fetch user profile:', profileResponse.data);
        return null;
      }

      const userData = profileResponse.data;
      console.log('[Auth] User profile fetched:', userData);
      
      // Store both tokens and user data
      return {
        ...userData,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
      };
    } catch (error) {
      console.error('[Auth] Token exchange error:', error);
      console.error('[Auth] Error message:', error.message);
      console.error('[Auth] Error stack:', error.stack);
      return null;
    }
  }

  /**
   * Login - opens browser for OAuth flow
   */
  async login() {
    if (!this.authEnabled) {
      console.log('Auth is disabled');
      return;
    }

    try {
      if (window.Capacitor) {
        // Native app - use Capacitor Browser
        const { Browser } = window.Capacitor.Plugins;
        const authUrl = await this.buildAuthUrl('login');
        console.log('[Auth] Opening login URL:', authUrl);
        // Use presentationStyle 'fullscreen' for OAuth flows on iOS
        // This ensures the browser closes properly when redirecting back
        const result = await Browser.open({ 
          url: authUrl,
          presentationStyle: 'fullscreen',
          toolbarColor: '#ffffff'
        });
        console.log('[Auth] Browser.open result:', result);
      } else if (this.client) {
        // Web - use Kinde SDK
        await this.client.login();
      }
    } catch (error) {
      console.error('Login failed:', error);
    }
  }

  /**
   * Register new user
   */
  async register() {
    if (!this.authEnabled) {
      console.log('Auth is disabled');
      return;
    }

    try {
      if (window.Capacitor) {
        const { Browser } = window.Capacitor.Plugins;
        const authUrl = await this.buildAuthUrl('register');
        console.log('[Auth] Opening register URL:', authUrl);
        await Browser.open({ url: authUrl });
      } else if (this.client) {
        await this.client.register();
      }
    } catch (error) {
      console.error('Registration failed:', error);
    }
  }

  /**
   * Logout
   */
  async logout() {
    try {
      if (window.Capacitor?.Plugins?.Preferences) {
        const { Preferences } = window.Capacitor.Plugins;
        await Preferences.remove({ key: 'kinde_session' });
      }
      
      if (this.client) {
        await this.client.logout();
      }
      
      this.user = null;
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }

  /**
   * Build authentication URL for native OAuth flow
   */
  async buildAuthUrl(type = 'login') {
    // Generate PKCE parameters
    const { codeVerifier, codeChallenge } = await this.generatePKCE();
    this.codeVerifier = codeVerifier; // Store for token exchange
    
    // Kinde uses /oauth2/auth endpoint for both login and register
    // The 'register' type is handled via start_page parameter
    
    // Generate a random state string (at least 8 characters for Kinde)
    const state = Math.random().toString(36).substring(2, 15) + 
                  Math.random().toString(36).substring(2, 15);
    
    const params = new URLSearchParams({
      client_id: KINDE_CONFIG.client_id,
      redirect_uri: KINDE_CONFIG.redirect_uri,
      response_type: 'code',
      scope: KINDE_CONFIG.scope,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    
    // Add start_page parameter for registration
    if (type === 'register') {
      params.set('start_page', 'registration');
    }
    
    const authUrl = `${KINDE_CONFIG.domain}/oauth2/auth?${params.toString()}`;
    console.log('[Auth] Built auth URL with PKCE:', authUrl);
    return authUrl;
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  async generatePKCE() {
    // Generate random code verifier
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const codeVerifier = this.base64URLEncode(array);
    
    // Create code challenge from verifier
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const codeChallenge = this.base64URLEncode(new Uint8Array(hashBuffer));
    
    return { codeVerifier, codeChallenge };
  }

  /**
   * Base64 URL encode (without padding)
   */
  base64URLEncode(buffer) {
    const base64 = btoa(String.fromCharCode.apply(null, buffer));
    return base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.user;
  }

  /**
   * Alias for isAuthenticated (for compatibility)
   */
  isUserAuthenticated() {
    return this.isAuthenticated();
  }

  /**
   * Get current user profile
   */
  getUserProfile() {
    return this.user;
  }

  /**
   * Alias for getUserProfile (for compatibility)
   */
  getUser() {
    return this.getUserProfile();
  }

  /**
   * Get subscription tier (stub for now - returns 'free' for all users)
   */
  getSubscriptionTier() {
    // TODO: Implement subscription tier logic
    return 'free';
  }

  /**
   * Check if user can access a feature (stub for now - allows everything)
   */
  canAccessFeature(feature) {
    // TODO: Implement feature access logic based on subscription tier
    return { allowed: true, reason: '' };
  }
}

export const authManager = new AuthManager();

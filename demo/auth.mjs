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
  }

  /**
   * Initialize the authentication system
   * For native apps, this will use Capacitor Browser plugin for OAuth flow
   */
  async initialize() {
    if (!this.authEnabled || !KINDE_CONFIG.client_id) {
      console.log('Authentication is disabled or not configured');
      return;
    }

    try {
      // For native apps, we'll use Capacitor's Browser plugin for OAuth
      // Check if we're in a Capacitor environment
      if (window.Capacitor) {
        console.log('Running in Capacitor - using native OAuth flow');
        await this.initializeNativeAuth();
      } else {
        console.log('Running in web browser - using web OAuth flow');
        await this.initializeWebAuth();
      }

      // Check if we're returning from OAuth callback
      await this.handleCallback();
    } catch (error) {
      console.error('Failed to initialize auth:', error);
    }
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

    // Load saved session if available
    await this.loadSavedSession();
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
    // This will be called after OAuth redirect
    // Parse URL parameters and exchange code for token
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    
    if (code) {
      // Exchange code for token with Kinde
      const userData = await this.exchangeCodeForToken(code);
      if (userData) {
        this.user = userData;
        await this.saveSession(userData);
        window.dispatchEvent(new CustomEvent('auth-callback-complete'));
      }
    }
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code) {
    // Implement token exchange with Kinde API
    // This requires PKCE flow for native apps
    console.log('Exchanging code for token:', code);
    // TODO: Implement actual token exchange
    return null;
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
      if (window.Capacitor?.Plugins?.Browser) {
        // Native app - use Capacitor Browser
        const { Browser } = window.Capacitor.Plugins;
        const authUrl = this.buildAuthUrl('login');
        await Browser.open({ url: authUrl });
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
      if (window.Capacitor?.Plugins?.Browser) {
        const { Browser } = window.Capacitor.Plugins;
        const authUrl = this.buildAuthUrl('register');
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
  buildAuthUrl(type = 'login') {
    const endpoint = type === 'register' ? 'register' : 'login';
    const params = new URLSearchParams({
      client_id: KINDE_CONFIG.client_id,
      redirect_uri: KINDE_CONFIG.redirect_uri,
      response_type: 'code',
      scope: KINDE_CONFIG.scope,
      // Add PKCE parameters here
    });
    
    return `${KINDE_CONFIG.domain}/${endpoint}?${params.toString()}`;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.user;
  }

  /**
   * Get current user profile
   */
  getUserProfile() {
    return this.user;
  }
}

export const authManager = new AuthManager();

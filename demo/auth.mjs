/**
 * Authentication module using Kinde OAuth/OIDC
 * Handles user authentication, authorization, and feature gating
 */

import createKindeClient from 'https://cdn.jsdelivr.net/npm/@kinde-oss/kinde-auth-pkce-js@3/+esm';
import { KINDE_CONFIG, AUTH_ENABLED } from './auth-config.js';

class AuthManager {
  constructor() {
    this.client = null;
    this.user = null;
    this.isAuthenticated = false;
    this.permissions = { permissions: [] };
    this.claims = {};
    this.authEnabled = AUTH_ENABLED;
  }

  /**
   * Initialize the Kinde client
   */
  async initialize() {
    // Skip initialization if auth is not configured
    if (!this.authEnabled || !KINDE_CONFIG.client_id) {
      console.warn('Authentication not configured - running in open mode');
      this.isAuthenticated = false;
      return true;
    }

    try {
      this.client = await createKindeClient(KINDE_CONFIG);

      // Check if returning from OAuth callback
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('code') || urlParams.has('state')) {
        await this.handleCallback();
      }

      // Check authentication status
      await this.checkAuth();

      return true;
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      // Don't throw - allow app to continue without auth
      this.isAuthenticated = false;
      this.authEnabled = false;
      return true;
    }
  }

  /**
   * Handle OAuth callback after login/register
   */
  async handleCallback() {
    try {
      await this.client.handleRedirectToApp();

      // Clean up URL
      const url = new URL(window.location);
      url.search = '';
      window.history.replaceState({}, document.title, url);

      await this.checkAuth();

      // Dispatch custom event to notify the app that auth callback is complete
      // This allows the app to completely re-initialize the UI and player
      console.log(
        'Auth callback complete, dispatching auth-callback-complete event',
      );
      window.dispatchEvent(
        new CustomEvent('auth-callback-complete', {
          detail: { user: this.user, isAuthenticated: this.isAuthenticated },
        }),
      );
    } catch (error) {
      console.error('Callback handling failed:', error);
      throw error;
    }
  }

  /**
   * Check current authentication status
   */
  async checkAuth() {
    try {
      this.isAuthenticated = await this.client.isAuthenticated();

      if (this.isAuthenticated) {
        this.user = await this.client.getUser();

        // Some Kinde SDK versions don't have getClaims/getPermissions
        // Use try-catch for each method
        try {
          this.claims = (await this.client.getClaim?.()) || {};
        } catch (e) {
          this.claims = {};
        }

        try {
          this.permissions = (await this.client.getPermission?.()) || {
            permissions: [],
          };
        } catch (e) {
          this.permissions = { permissions: [] };
        }

        // Store in session for quick access
        sessionStorage.setItem('user', JSON.stringify(this.user));
        sessionStorage.setItem('permissions', JSON.stringify(this.permissions));
      } else {
        this.user = null;
        this.permissions = { permissions: [] };
        this.claims = {};
        sessionStorage.removeItem('user');
        sessionStorage.removeItem('permissions');
      }

      return this.isAuthenticated;
    } catch (error) {
      console.error('Auth check failed:', error);
      this.isAuthenticated = false;
      this.user = null;
      this.permissions = { permissions: [] };
      this.claims = {};
      return false;
    }
  }

  /**
   * Login with redirect to Kinde
   */
  async login() {
    try {
      await this.client.login();
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  /**
   * Register new user with redirect to Kinde
   */
  async register() {
    try {
      await this.client.register();
    } catch (error) {
      console.error('Registration failed:', error);
      throw error;
    }
  }

  /**
   * Logout and clear session
   */
  async logout() {
    try {
      await this.client.logout();
      this.user = null;
      this.isAuthenticated = false;
      this.permissions = [];
      this.claims = {};
      sessionStorage.clear();
    } catch (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  }

  /**
   * Get current user info
   */
  getUser() {
    return this.user;
  }

  /**
   * Check if user is authenticated
   */
  isUserAuthenticated() {
    return this.isAuthenticated;
  }

  /**
   * Check if user has a specific permission
   * @param {string} permission - Permission to check (e.g., 'use:premium-features')
   */
  hasPermission(permission) {
    return (
      this.permissions &&
      this.permissions.permissions &&
      Array.isArray(this.permissions.permissions) &&
      this.permissions.permissions.includes(permission)
    );
  }

  /**
   * Check if user has a specific role
   * @param {string} role - Role to check (e.g., 'premium', 'free')
   */
  hasRole(role) {
    const roles = this.claims?.roles || [];
    return roles.includes(role);
  }

  /**
   * Get user's subscription tier from custom claims
   * Assumes you've set a custom claim 'subscription_tier' in Kinde
   */
  getSubscriptionTier() {
    return this.claims?.subscription_tier || 'free';
  }

  /**
   * Check if user can access a feature
   * @param {string} feature - Feature name
   * @returns {Object} - { allowed: boolean, reason: string }
   */
  canAccessFeature(feature) {
    // If auth is disabled, allow all features
    if (!this.authEnabled) {
      return { allowed: true, reason: '' };
    }

    if (!this.isAuthenticated) {
      return { allowed: false, reason: 'Please log in to access this feature' };
    }

    const tier = this.getSubscriptionTier();

    // Define feature access based on subscription tier
    const featureAccess = {
      'playlist': { tiers: ['free', 'premium', 'pro'], permission: null },
      'external-urls': { tiers: ['free', 'premium', 'pro'], permission: null },
      'export-midi': { tiers: ['free', 'premium', 'pro'], permission: null },
      'export-musicxml': {
        tiers: ['premium', 'pro'],
        permission: 'export:musicxml',
      },
      'offline-mode': { tiers: ['pro'], permission: 'use:offline-mode' },
      'advanced-settings': {
        tiers: ['premium', 'pro'],
        permission: 'use:advanced-settings',
      },
    };

    const access = featureAccess[feature];
    if (!access) {
      return { allowed: true, reason: '' }; // Unknown features default to allowed
    }

    // Check tier
    if (!access.tiers.includes(tier)) {
      return {
        allowed: false,
        reason: `This feature requires a ${access.tiers[access.tiers.length - 1]} subscription`,
      };
    }

    // Check permission if specified
    if (access.permission && !this.hasPermission(access.permission)) {
      return {
        allowed: false,
        reason: 'You do not have permission to access this feature',
      };
    }

    return { allowed: true, reason: '' };
  }

  /**
   * Get access token for API calls
   */
  async getAccessToken() {
    try {
      return await this.client.getToken();
    } catch (error) {
      console.error('Failed to get access token:', error);
      return null;
    }
  }
}

// Export singleton instance
export const authManager = new AuthManager();

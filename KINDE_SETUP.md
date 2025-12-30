# Kinde Authentication Setup Guide

This guide explains how to set up Kinde OAuth/OIDC authentication for the MusicXML Player.

## 1. Create a Kinde Account

1. Go to [Kinde](https://kinde.com) and sign up for an account
2. Create a new business/organization

## 2. Create an Application

1. In your Kinde dashboard, go to **Settings > Applications**
2. Click **Add Application**
3. Choose **Single Page Application (SPA)**
4. Name it "MusicXML Player" (or your preferred name)
5. Click **Save**

## 3. Configure Application Settings

### Allowed Callback URLs

Add your application URLs:
- Development: `http://localhost:8082`
- Production: `https://yourdomain.com`

### Allowed Logout Redirect URLs

Add the same URLs:
- `http://localhost:8082`
- `https://yourdomain.com`

## 4. Get Your Credentials

From the application details page, copy:
- **Client ID**: Your unique application identifier
- **Domain**: Your Kinde domain (e.g., `https://yoursubdomain.kinde.com`)

## 5. Configure with Environment Variables

**For Docker Deployment** (Recommended):

Pass credentials as environment variables when running the container:

```bash
docker run -d \
  --name tongli \
  -p 8082:8082 \
  -e KINDE_CLIENT_ID="your_client_id_here" \
  -e KINDE_DOMAIN="https://yoursubdomain.kinde.com" \
  -e KINDE_AUDIENCE="" \
  tli551/mxp:0.0.2
```

Or use a `.env` file:

```bash
# .env
KINDE_CLIENT_ID=your_client_id_here
KINDE_DOMAIN=https://yoursubdomain.kinde.com
KINDE_AUDIENCE=
```

Then run with:
```bash
docker run -d \
  --name tongli \
  -p 8082:8082 \
  --env-file .env \
  tli551/mxp:0.0.2
```

**For Local Development**:

Edit `demo/auth-config.js` directly:

```javascript
export const KINDE_CONFIG = {
  client_id: 'YOUR_KINDE_CLIENT_ID',
  domain: 'https://YOUR_SUBDOMAIN.kinde.com',
  redirect_uri: window.location.origin,
  logout_uri: window.location.origin,
  scope: 'openid profile email offline',
  audience: '',
};

export const AUTH_ENABLED = true;
```

**Note**: The Docker container automatically generates `auth-config.js` from environment variables at startup. Your local file will be overwritten in Docker.

## 6. Set Up Subscription Tiers (Optional)

### Using Custom Claims

1. Go to **Settings > Properties** in Kinde
2. Create a custom property called `subscription_tier`
3. Set allowed values: `free`, `premium`, `pro`
4. Assign to users based on their subscription

### Using Roles

1. Go to **Settings > Roles**
2. Create roles: `free`, `premium`, `pro`
3. Assign users to roles

The auth system checks both custom claims and roles.

## 7. Set Up Permissions (Optional)

For fine-grained access control:

1. Go to **Settings > Permissions**
2. Create permissions:
   - `use:external-urls` - Load files from external URLs
   - `export:musicxml` - Export MusicXML files
   - `use:advanced-settings` - Access advanced settings
   - `use:offline-mode` - Use offline functionality

3. Assign permissions to roles:
   - **Free**: Basic features only
   - **Premium**: `use:external-urls`, `export:musicxml`, `use:advanced-settings`
   - **Pro**: All permissions

## 8. Test Authentication

**With Docker**:

```bash
# Build the image
docker build -t tli551/mxp:0.0.2 .

# Run with auth enabled
docker run -d \
  --name tongli \
  -p 8082:8082 \
  -e KINDE_CLIENT_ID="your_client_id" \
  -e KINDE_DOMAIN="https://yoursubdomain.kinde.com" \
  tli551/mxp:0.0.2

# Check logs to verify config was generated
docker logs tongli
```

**Without Docker**:

```bash
npm run demo:server
```

Then:
1. Navigate to `http://localhost:8082`
2. You should see "Login" and "Sign Up" buttons
3. Click "Sign Up" to create a test account
4. Complete the registration flow
5. You should be redirected back and see your user info

**Running Without Authentication**:

If you don't set `KINDE_CLIENT_ID`, the app runs in open mode with all features unlocked:

```bash
docker run -d --name tongli -p 8082:8082 tli551/mxp:0.0.2
```

## Feature Gating Configuration

The application gates features based on subscription tier. Edit `demo/auth.mjs` in the `canAccessFeature()` method to customize:

```javascript
const featureAccess = {
  'playlist': { tiers: ['free', 'premium', 'pro'], permission: null },
  'external-urls': { tiers: ['premium', 'pro'], permission: 'use:external-urls' },
  'export-midi': { tiers: ['free', 'premium', 'pro'], permission: null },
  'export-musicxml': { tiers: ['premium', 'pro'], permission: 'export:musicxml' },
  'offline-mode': { tiers: ['pro'], permission: 'use:offline-mode' },
  'advanced-settings': { tiers: ['premium', 'pro'], permission: 'use:advanced-settings' },
};
```

## Usage Examples

### Check Authentication Status

```javascript
if (authManager.isUserAuthenticated()) {
  // User is logged in
  const user = authManager.getUser();
  console.log(`Welcome ${user.given_name}!`);
}
```

### Check Subscription Tier

```javascript
const tier = authManager.getSubscriptionTier(); // 'free', 'premium', or 'pro'
if (tier === 'pro') {
  // Enable pro features
}
```

### Gate a Feature

```javascript
if (!checkFeatureAccess('external-urls')) {
  // Access denied - error message already shown to user
  return;
}
// Proceed with feature
```

### Check Permission

```javascript
if (authManager.hasPermission('use:external-urls')) {
  // User has this specific permission
}
```

## Troubleshooting

### Redirect Loop

- Ensure callback URLs match exactly (including protocol and port)
- Check browser console for errors
- Clear browser cache and cookies

### User Not Authenticated After Login

- Check that the OAuth callback is being handled
- Verify the `code` and `state` parameters are in the URL
- Check browser console for errors

### Permissions Not Working

- Verify permissions are created in Kinde
- Check that permissions are assigned to the user's role
- Ensure `scope` includes required scopes in `KINDE_CONFIG`

### Custom Claims Not Appearing

- Wait a few minutes after creating custom properties
- Log out and log back in to refresh tokens
- Check token contents using JWT decoder

## Security Considerations

1. **Never commit credentials**: Keep credentials in environment variables or `.env` files (add `.env` to `.gitignore`)
2. **Use HTTPS in production**: OAuth requires secure connections
3. **Validate on backend**: For sensitive operations, validate permissions on your backend server
4. **Token expiration**: Tokens expire after 1 hour by default - the SDK handles refresh automatically
5. **Logout properly**: Always call `authManager.logout()` to clear session
6. **Environment variables in Docker**: Use Docker secrets or external secret management for production
7. **Don't log sensitive data**: The startup script logs that config was loaded but not the actual values

## Docker Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KINDE_CLIENT_ID` | Yes* | `""` | Your Kinde application client ID |
| `KINDE_DOMAIN` | Yes* | `""` | Your Kinde domain (e.g., https://yourapp.kinde.com) |
| `KINDE_AUDIENCE` | No | `""` | Optional API audience identifier |
| `PORT` | No | `8082` | Port for the web server |

*Required only if you want to enable authentication. Without these, the app runs in open mode.

## Additional Resources

- [Kinde Documentation](https://kinde.com/docs/)
- [Kinde JavaScript SDK](https://github.com/kinde-oss/kinde-auth-pkce-js)
- [OAuth 2.0 PKCE Flow](https://oauth.net/2/pkce/)

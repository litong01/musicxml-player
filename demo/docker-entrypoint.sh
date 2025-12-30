#!/bin/sh
set -e

# Generate runtime configuration from environment variables
cat > /app/demo/auth-config.js << EOF
// Auto-generated configuration file - DO NOT EDIT MANUALLY
// This file is generated at container startup from environment variables

export const KINDE_CONFIG = {
  client_id: '${KINDE_CLIENT_ID}',
  domain: '${KINDE_DOMAIN}',
  redirect_uri: window.location.origin,
  logout_uri: window.location.origin,
  scope: 'openid profile email offline',
  audience: '${KINDE_AUDIENCE}',
};

export const AUTH_ENABLED = ${KINDE_CLIENT_ID:+true};
EOF

echo "Generated auth configuration:"
echo "  KINDE_CLIENT_ID: ${KINDE_CLIENT_ID:-(not set)}"
echo "  KINDE_DOMAIN: ${KINDE_DOMAIN:-(not set)}"
echo "  KINDE_AUDIENCE: ${KINDE_AUDIENCE:-(not set)}"
echo "  AUTH_ENABLED: ${KINDE_CLIENT_ID:+true}"

# Execute the main command
exec "$@"

#!/bin/bash

# These are environment variables used for local development environment
export KEYCLOAK_BASEURL=http://localhost:8080
export KEYCLOAK_USER=admin
export KEYCLOAK_PASSWORD=admin
export REALM_NAME=netapp
export CLIENT_ID=netapp-cli
export CLIENT_SECRET=OVK9e69r8lkVPYksc8CINrANm74HwAuz
export REDIRECT_URL=http://localhost:3111/dashboard

# Function to extract token from response
extract_token() {
    local response="$1"
    local token=$(echo "$response" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
    echo "$token"
}

# Obtain token
token_response=$(curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/realms/master/protocol/openid-connect/token" \
--header "Content-Type: application/x-www-form-urlencoded" \
--data "client_id=admin-cli&grant_type=password&username=${KEYCLOAK_USER}&password=${KEYCLOAK_PASSWORD}")

# Extract token
token=$(extract_token "$token_response")

# Create Realm
REALM_PAYLOAD=$(node -pe "
  JSON.stringify({
    realm: '${REALM_NAME}',
    displayName: '${REALM_NAME}',
    enabled: true,
    accessTokenLifespan: 86400,
    ssoSessionIdleTimeout: 172800,
    ssoSessionMaxLifespan: 172800,
    registrationAllowed: true,
    loginWithEmailAllowed: true,
    verifyEmail: false,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: true,
    loginTheme: 'datamigrate'
  });
")

curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data "${REALM_PAYLOAD}"

# Create Client
CLIENT_PAYLOAD=$(node -pe "
  JSON.stringify({
    clientId: 'netapp-cli',
    name: 'netapp-cli',
    description: 'Client for netapp realm',
    enabled: true,
    redirectUris: ['http://localhost:3111/dashboard'],
    webOrigins: ['http://localhost:3111'],
    clientAuthenticatorType: 'client-secret',
    secret: '${CLIENT_SECRET}',
    protocol: 'openid-connect',
    bearerOnly: false,
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: true,
    publicClient: false,
    serviceAccountsEnabled: true,
    rootUrl: 'http://localhost:3111',
    baseUrl: '/dashboard',
    adminUrl: 'http://localhost:3111',
    attributes: {
      'post.logout.redirect.uris': 'http://localhost:3111/dashboard',
      'client.auth.method': 'client_secret',
      'access.token.lifespan': 3600
    },
    loginTheme: 'datamigrate'
  });
")

curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/clients" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data-raw "$CLIENT_PAYLOAD"

# Create Initial User
USER_PAYLOAD=$(node -pe "
  JSON.stringify({
    username: 'johndoe@example.com',
    email: 'johndoe@example.com',
    enabled: true,
    emailVerified: true,
    firstName: 'John',
    lastName: 'Doe',
    credentials: [{
      type: 'password',
      value: 'root',
      temporary: true
    }],
  });
")

curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/users" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data-raw "$USER_PAYLOAD"

# Create Client Scope if it doesn't exist
CLIENT_SCOPE_NAME="netapp-cli-dedicated"

CLIENT_SCOPE_PAYLOAD=$(node -pe "
  JSON.stringify({
    name: '${CLIENT_SCOPE_NAME}',
    protocol: 'openid-connect',
    attributes: {},
    enabled: true,
    consentRequired: false,
    displayOnConsentScreen: false
  });
")

curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/client-scopes" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data-raw "$CLIENT_SCOPE_PAYLOAD"

# Create Mapper for Client Scope
MAPPER_PAYLOAD=$(node -pe "
  JSON.stringify({
    name: 'DataMigrate Permission Mapper',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-attribute-mapper',
    consentRequired: false,
    userAttribute: 'user',
    claimName: 'user',
    jsonTypeLabel: 'String',
    addToAccessToken: true,
    addToIdToken: false,
    addToUserInfo: false,
    clientScopeId: '${CLIENT_SCOPE_NAME}'
  });
")

curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/client-scopes/${CLIENT_SCOPE_NAME}/protocol-mappers/models" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data-raw "$MAPPER_PAYLOAD"

# Attach Client Scope to the Client
curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/clients/netapp-cli/client-scopes" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data-raw "[{\"id\":\"${CLIENT_SCOPE_NAME}\", \"protocol\":\"openid-connect\"}]"
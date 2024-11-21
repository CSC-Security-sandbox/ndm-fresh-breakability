#!/bin/bash
 
# Environment variables for local development environment
export KEYCLOAK_BASEURL=http://localhost:8080
export KEYCLOAK_USER=admin
export KEYCLOAK_PASSWORD=admin
export REALM_NAME=netapp
export CLIENT_ID=netapp-cli
export CLIENT_SECRET=OVK9e69r8lkVPYksc8CINrANm74HwAuz
export REDIRECT_URL=http://localhost:3111/dashboard
export INITIAL_USER_EMAIL=johndoe@example.com
export INITIAL_USER_PASSWORD=root
export INITIAL_USER_FIRSTNAME=John
export INITIAL_USER_LASTNAME=Doe
export CLIENT_SCOPE_NAME=netapp-cli-dedicated
export MAPPER_NAME="DataMigrate Permission Mapper"
export MAPPER_USER_ATTRIBUTE="user"
export MAPPER_CLAIM_NAME="user"
 
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
    resetPasswordAllowed: true
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
    clientId: '${CLIENT_ID}',
    name: '${CLIENT_ID}',
    description: 'Client for ${REALM_NAME} realm',
    enabled: true,
    redirectUris: ['${REDIRECT_URL}'],
    webOrigins: ['${REDIRECT_URL}'],
    clientAuthenticatorType: 'client-secret',
    secret: '${CLIENT_SECRET}',
    protocol: 'openid-connect',
    bearerOnly: false,
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: true,
    publicClient: false,
    serviceAccountsEnabled: true,
    rootUrl: '${REDIRECT_URL}',
    baseUrl: '/dashboard',
    adminUrl: '${REDIRECT_URL}',
    attributes: {
      'post.logout.redirect.uris': '${REDIRECT_URL}',
      'client.auth.method': 'client_secret',
      'access.token.lifespan': 3600
    }
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
    username: '${INITIAL_USER_EMAIL}',
    email: '${INITIAL_USER_EMAIL}',
    enabled: true,
    emailVerified: true,
    firstName: '${INITIAL_USER_FIRSTNAME}',
    lastName: '${INITIAL_USER_LASTNAME}',
    credentials: [{
      type: 'password',
      value: '${INITIAL_USER_PASSWORD}',
      temporary: true
    }],
  });
")
 
curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/users" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data-raw "$USER_PAYLOAD"
 
# Create Client Scope
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
    name: '${MAPPER_NAME}',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-attribute-mapper',
    consentRequired: false,
    userAttribute: '${MAPPER_USER_ATTRIBUTE}',
    claimName: '${MAPPER_CLAIM_NAME}',
    jsonTypeLabel: 'String',
    addToAccessToken: true,
    addToIdToken: false,
    addToUserInfo: false
  });
")
 
curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/client-scopes/${CLIENT_SCOPE_NAME}/protocol-mappers/models" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data-raw "$MAPPER_PAYLOAD"
 
# Attach Client Scope to the Client
curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/clients/${CLIENT_ID}/default-client-scopes" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data-raw "[{\"id\":\"${CLIENT_SCOPE_NAME}\", \"protocol\":\"openid-connect\"}]"
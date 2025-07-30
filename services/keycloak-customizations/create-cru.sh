#!/bin/bash

# Environment variables for local development environment
export KEYCLOAK_BASEURL=http://localhost:8080
export KEYCLOAK_USER=admin
export KEYCLOAK_PASSWORD=admin
export REALM_NAME=netapp
export CLIENT_ID=netapp-cli
export CLIENT_SECRET=OVK9e69r8lkVPYksc8CINrANm74HwAuz
export REDIRECT_URL=http://localhost:3111/home
export KC_WEB_ORIGIN=http://localhost:3111
export INITIAL_USER_EMAIL=admin@datamigrate.local
export INITIAL_USER_PASSWORD=root
export INITIAL_USER_FIRSTNAME=John
export INITIAL_USER_LASTNAME=Doe
export INITIAL_USER_STATUS=active
export CLIENT_SCOPE_NAME=netapp-cli-dedicated
export MAPPER_NAME="DataMigrate Permission Mapper"
export MAPPER_USER_ATTRIBUTE="user"
export MAPPER_CLAIM_NAME="user"
export ACCOUNT_ID=964110e9-b896-41cb-9618-4e91b984a608
export ROLE_ID=6a3fe72e-6f9c-4e32-a5b8-36279b70047c

# PostgreSQL configuration
export PG_HOST=localhost
export PG_PORT=5432
export PG_DATABASE=datamigrate
export PG_USER=dmadmin
export PG_PASSWORD=dmadmin

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
if [ -z "$token" ]; then
    echo "Failed to obtain Keycloak token."
    exit 1
fi

# Create Realm
REALM_PAYLOAD=$(cat <<EOF
{
  "realm": "${REALM_NAME}",
  "displayName": "${REALM_NAME}",
  "enabled": true,
  "accessTokenLifespan": 86400,
  "ssoSessionIdleTimeout": 172800,
  "ssoSessionMaxLifespan": 172800,
  "registrationAllowed": true,
  "loginWithEmailAllowed": true,
  "verifyEmail": false,
  "duplicateEmailsAllowed": false,
  "resetPasswordAllowed": true,
  "passwordPolicy": 'passwordHistory(3)'
}
EOF
)

curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data "${REALM_PAYLOAD}"

# Create Client
CLIENT_PAYLOAD=$(cat <<EOF
{
  "clientId": "${CLIENT_ID}",
  "name": "${CLIENT_ID}",
  "description": "Client for ${REALM_NAME} realm",
  "enabled": true,
  "redirectUris": ["${REDIRECT_URL}"],
  "webOrigins": ["${KC_WEB_ORIGIN}"],
  "clientAuthenticatorType": "client-secret",
  "secret": "${CLIENT_SECRET}",
  "protocol": "openid-connect",
  "bearerOnly": false,
  "standardFlowEnabled": true,
  "implicitFlowEnabled": false,
  "directAccessGrantsEnabled": true,
  "publicClient": false,
  "serviceAccountsEnabled": true,
  "rootUrl": "${KC_WEB_ORIGIN}",
  "baseUrl": "/home",
  "adminUrl": "${KC_WEB_ORIGIN}",
  "attributes": {
    "post.logout.redirect.uris": "${REDIRECT_URL}",
    "client.auth.method": "client_secret",
    "access.token.lifespan": 3600
  }
}
EOF
)

curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/clients" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data-raw "$CLIENT_PAYLOAD"

USER_PAYLOAD=$(cat <<EOF
{
  "username": "${INITIAL_USER_EMAIL}",
  "email": "${INITIAL_USER_EMAIL}",
  "enabled": true,
  "emailVerified": true,
  "firstName": "${INITIAL_USER_FIRSTNAME}",
  "lastName": "${INITIAL_USER_LASTNAME}",
  "credentials": [{
    "type": "password",
    "value": "${INITIAL_USER_PASSWORD}",
    "temporary": true
  }],
  "requiredActions": [
    "UPDATE_PROFILE",
    "UPDATE_PASSWORD"
  ]
}
EOF
)

curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/users" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data-raw "$USER_PAYLOAD"

# Add user to PostgreSQL database
PGPASSWORD=$PG_PASSWORD psql -h $PG_HOST -U $PG_USER -d $PG_DATABASE <<EOF
DO \$\$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM migrateadmin.user WHERE email = '${INITIAL_USER_EMAIL}'
  ) THEN
    INSERT INTO migrateadmin.user (email, first_name, last_name, user_status)
    VALUES ('${INITIAL_USER_EMAIL}', '${INITIAL_USER_FIRSTNAME}', '${INITIAL_USER_LASTNAME}', '${INITIAL_USER_STATUS}');
  END IF;
END \$\$;
EOF

PG_USER_ID=$(PGPASSWORD=$PG_PASSWORD psql -h $PG_HOST -U $PG_USER -d $PG_DATABASE -t -c "SELECT id FROM migrateadmin.user WHERE email = '${INITIAL_USER_EMAIL}';" | xargs)

if [ -n "$PG_USER_ID" ]; then
    PGPASSWORD=$PG_PASSWORD psql -h $PG_HOST -U $PG_USER -d $PG_DATABASE <<EOF
INSERT INTO migrateadmin.user_role (role_id, account_id, project_id, user_id)
VALUES ('${ROLE_ID}', '${ACCOUNT_ID}', NULL, '${PG_USER_ID}')
ON CONFLICT DO NOTHING;
EOF
    echo "User role added to PostgreSQL database."
else
    echo "Failed to fetch user_id from PostgreSQL."
fi

# Create Client Scope
CLIENT_SCOPE_PAYLOAD=$(cat <<EOF
{
  "name": "${CLIENT_SCOPE_NAME}",
  "protocol": "openid-connect",
  "attributes": {},
  "enabled": true,
  "consentRequired": false,
  "displayOnConsentScreen": false
}
EOF
)

curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/client-scopes" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data-raw "$CLIENT_SCOPE_PAYLOAD"

# Create Mapper for Client Scope
MAPPER_PAYLOAD=$(cat <<EOF
{
  "name": "${MAPPER_NAME}",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-usermodel-attribute-mapper",
  "consentRequired": false,
  "config": {
    "user.attribute": "${MAPPER_USER_ATTRIBUTE}",
    "claim.name": "${MAPPER_CLAIM_NAME}",
    "jsonType.label": "String",
    "access.token": "true",
    "id.token": "false",
    "userinfo.token": "false"
  }
}
EOF
)

curl -k --silent --show-error --request POST \
--url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/client-scopes/${CLIENT_SCOPE_NAME}/protocol-mappers/models" \
--header "Content-Type: application/json" \
--header "Authorization: Bearer ${token}" \
--data-raw "$MAPPER_PAYLOAD"
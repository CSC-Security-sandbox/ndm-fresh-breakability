#!/bin/bash
#
# Reset a Keycloak user's password in the datamigrator realm.
# Run this on the Control Plane VM as root or a user with kubectl access.
#
# Usage: ./reset-user-password.sh <email_or_username>
#   email_or_username — email (e.g. admin@datamigrator.local) or username
#
# Generates a random temporary password that meets the realm policy and
# displays it. The user must change this password on next login.

set -euo pipefail

KEYCLOAK_BASEURL="http://localhost:8080/keycloak"
REALM_NAME="datamigrator"
KC_POD="keycloak-0"
KC_NAMESPACE="keycloak"

pick_random() {
    local chars="$1"
    local count="$2"
    local result=""
    local len=${#chars}
    for ((i = 0; i < count; i++)); do
        local rand_index
        rand_index=$(od -An -N2 -tu2 /dev/urandom | tr -d ' ')
        result+="${chars:$((rand_index % len)):1}"
    done
    echo -n "$result"
}

generate_password() {
    local upper="ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    local lower="abcdefghijklmnopqrstuvwxyz"
    local digits="0123456789"
    local special='!@#$%&*'
    local all="${upper}${lower}${digits}${special}"

    local pw=""
    pw+=$(pick_random "$upper" 2)
    pw+=$(pick_random "$lower" 2)
    pw+=$(pick_random "$digits" 2)
    pw+=$(pick_random "$special" 2)
    pw+=$(pick_random "$all" 4)
    echo -n "$pw" | fold -w1 | shuf | tr -d '\n'
}

usage() {
    echo "Usage: $0 <email_or_username>"
    echo ""
    echo "  email_or_username  User's email or username in the ${REALM_NAME} realm"
    echo ""
    echo "Generates a temporary password and displays it."
    echo "The user must change this password on next login."
    exit 1
}

if [ $# -ne 1 ]; then
    usage
fi

TARGET_USER="$1"
NEW_PASSWORD=$(generate_password)

kc_curl() {
    kubectl exec -n "${KC_NAMESPACE}" "${KC_POD}" -c keycloak -- \
        curl -s --show-error "$@"
}

echo "==> Retrieving kcadmin credentials from OpenBao..."
KEYCLOAK_CREDS=$(kubectl exec -i openbao-0 -n openbao -- \
    bao kv get -format=json /secrets/keycloak-secrets/keycloak-creds 2>/dev/null) || {
    echo "ERROR: Failed to read credentials from OpenBao."
    echo "       Ensure OpenBao is unsealed and you have kubectl access."
    exit 1
}

KEYCLOAK_USER=$(echo "$KEYCLOAK_CREDS" | tr -d '\r' | jq -r '.data.KEYCLOAK_ADMIN_USER')
KEYCLOAK_PASSWORD=$(echo "$KEYCLOAK_CREDS" | tr -d '\r' | jq -r '.data.KEYCLOAK_ADMIN_PASSWORD')

if [ -z "$KEYCLOAK_USER" ] || [ -z "$KEYCLOAK_PASSWORD" ]; then
    echo "ERROR: Could not extract admin credentials from OpenBao response."
    exit 1
fi

echo "    Admin user: ${KEYCLOAK_USER}"

echo "==> Obtaining access token from master realm..."
TOKEN_RESPONSE=$(kc_curl --request POST \
    --url "${KEYCLOAK_BASEURL}/realms/master/protocol/openid-connect/token" \
    --header "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "client_id=admin-cli" \
    --data-urlencode "grant_type=password" \
    --data-urlencode "username=${KEYCLOAK_USER}" \
    --data-urlencode "password=${KEYCLOAK_PASSWORD}")

TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    echo "ERROR: Failed to obtain Keycloak token."
    echo "       Response: ${TOKEN_RESPONSE}"
    exit 1
fi

echo "    Token acquired."

echo "==> Looking up user: ${TARGET_USER}..."
ENCODED_USER=$(printf '%s' "$TARGET_USER" | jq -sRr @uri)

USERS_RESPONSE=$(kc_curl --request GET \
    --url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/users?username=${ENCODED_USER}&exact=true" \
    --header "Authorization: Bearer ${TOKEN}")

USER_COUNT=$(echo "$USERS_RESPONSE" | jq 'length')

if [ "$USER_COUNT" -eq 0 ]; then
    USERS_RESPONSE=$(kc_curl --request GET \
        --url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/users?email=${ENCODED_USER}&exact=true" \
        --header "Authorization: Bearer ${TOKEN}")
    USER_COUNT=$(echo "$USERS_RESPONSE" | jq 'length')
fi

if [ "$USER_COUNT" -eq 0 ]; then
    echo "ERROR: No user found matching '${TARGET_USER}' in realm '${REALM_NAME}'."
    echo ""
    echo "Available users:"
    ALL_USERS=$(kc_curl --request GET \
        --url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/users?max=50" \
        --header "Authorization: Bearer ${TOKEN}")
    echo "$ALL_USERS" | jq -r '.[] | "  - \(.username) (\(.email // "no email"))"'
    exit 1
fi

USER_ID=$(echo "$USERS_RESPONSE" | jq -r '.[0].id')
USER_EMAIL=$(echo "$USERS_RESPONSE" | jq -r '.[0].email')
USER_NAME=$(echo "$USERS_RESPONSE" | jq -r '.[0].firstName + " " + .[0].lastName')

echo "    Found: ${USER_NAME} (${USER_EMAIL}) [id: ${USER_ID}]"

echo "==> Resetting password..."
RESET_RESPONSE=$(kc_curl --write-out "\n%{http_code}" --request PUT \
    --url "${KEYCLOAK_BASEURL}/admin/realms/${REALM_NAME}/users/${USER_ID}/reset-password" \
    --header "Content-Type: application/json" \
    --header "Authorization: Bearer ${TOKEN}" \
    --data "{\"type\":\"password\",\"value\":\"${NEW_PASSWORD}\",\"temporary\":true}")

HTTP_CODE=$(echo "$RESET_RESPONSE" | tail -n1)
BODY=$(echo "$RESET_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 204 ]; then
    echo ""
    echo "SUCCESS: Password reset for ${USER_EMAIL}."
    echo ""
    echo "  Temporary password:  ${NEW_PASSWORD}"
    echo ""
    echo "  The user must change this password on next login."
else
    echo ""
    echo "ERROR: Password reset failed (HTTP ${HTTP_CODE})."
    if [ -n "$BODY" ]; then
        echo "       Response: ${BODY}"
    fi
    echo ""
    echo "Common causes:"
    echo "  - Password does not meet realm policy"
    echo "  - Password matches one of the last 3 passwords"
    echo "  - Token expired (re-run the script)"
    exit 1
fi

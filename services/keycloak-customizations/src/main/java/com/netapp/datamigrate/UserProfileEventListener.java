package com.netapp.datamigrate;
 
import org.keycloak.events.Event;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventType;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.UserModel;
import org.keycloak.util.JsonSerialization;
import com.netapp.datamigrate.utils.DatabaseConnectionUtil;
import com.netapp.datamigrate.utils.ValidationUtil;
 
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.logging.Logger;
import java.util.List;
import java.util.ArrayList;
import java.util.LinkedHashSet;
 
/**
* An implementation of the Keycloak `EventListenerProvider` interface to handle user events.
* Specifically listens for profile update events and updates the email in the database accordingly.
* Also handles ASUP metrics sharing consent from the instance creator.
*/
public class UserProfileEventListener implements EventListenerProvider {
 
    private final KeycloakSession session;
    private static final Logger logger = Logger.getLogger(UserProfileEventListener.class.getName());
    private static final String DEFAULT_KEYCLOAK_BASE_URL = "http://keycloak.keycloak.svc.cluster.local/keycloak";
    private static final String DEFAULT_KEYCLOAK_REALM = "datamigrator";
    private static final String DEFAULT_KEYCLOAK_CLIENT_ID = "datamigrator-client";
    private static final String DEFAULT_REPORTS_BASE_URL = "http://reports-service-service:3000/api/v1/report";
    private static final HttpClient httpClient = HttpClient.newHttpClient();
    private String accessToken;
    private long expiresAtEpochSeconds;
 
    /**
     * Constructor for the event listener.
     *
     * @param session the Keycloak session
     */
    public UserProfileEventListener(KeycloakSession session) {
        this.session = session;
    }
 
    /**
     * Handles specific Keycloak user events.
     *
     * @param event the user event
     */
    @Override
    public void onEvent(Event event) {
        // Check if the event is a profile update
        if (event.getType() == EventType.UPDATE_PROFILE) {
            handleUpdateProfileEvent(event);
        }
    }
 
    /**
     * Handles specific Keycloak admin events.
     * This handles profile updates made via admin API (e.g., from profile page form submit).
     *
     * @param event the admin event
     * @param includeRepresentation whether to include the resource representation
     */
    @Override
    public void onEvent(AdminEvent event, boolean includeRepresentation) {
        logger.info(String.format("Admin event received: %s, resourceType: %s", 
            event.getOperationType(), event.getResourceType()));
        
        // Handle user updates via admin API
        if (event.getOperationType() == org.keycloak.events.admin.OperationType.UPDATE &&
            event.getResourceType() == org.keycloak.events.admin.ResourceType.USER) {
            
            // Extract user ID from the resource path (format: users/{userId})
            String resourcePath = event.getResourcePath();
            if (resourcePath != null && resourcePath.startsWith("users/")) {
                String userId = resourcePath.substring("users/".length());
                handleAdminUserUpdate(userId);
            }
        }
    }
    
    /**
     * Handles user profile update from admin API.
     * Checks the user's allowMetricsSharing attribute and updates the database.
     *
     * @param userId the user ID that was updated
     */
    private void handleAdminUserUpdate(String userId) {
        try {
            UserModel user = session.users().getUserById(session.getContext().getRealm(), userId);
            if (user != null) {
                List<String> asupAttribute = user.getAttributes().get("allowMetricsSharing");
                if (asupAttribute != null && !asupAttribute.isEmpty()) {
                    String asupValue = asupAttribute.get(0);
                    boolean asupEnabled = "true".equalsIgnoreCase(asupValue);
                    logger.info(String.format("ASUP consent via admin update for user %s: enabled=%s", 
                        user.getUsername(), asupEnabled));
                    updateAsupSettingsInDatabase(asupEnabled, userId);
                }
            }
        } catch (Exception e) {
            logger.warning(String.format("Failed to process admin user update for user %s: %s", userId, e.getMessage()));
        }
    }
 
    /**
     * Handles the `UPDATE_PROFILE` event type.
     * Retrieves the updated email and username from the event and updates the database.
     * Also handles ASUP metrics sharing consent.
     *
     * @param event the event containing user details
     */
    private void handleUpdateProfileEvent(Event event) {
        String username = event.getDetails().get("username");
        String updatedEmail = (event.getDetails().get("updated_email") == null) ?  event.getDetails().get("username") : event.getDetails().get("updated_email");
        String updatedLastName = event.getDetails().get("updated_last_name");
        String updatedFirstName = event.getDetails().get("updated_first_name");
        
        // Validate event details
        if (ValidationUtil.isValid(username) && ValidationUtil.isValid(updatedEmail)) {
            updateUserEmailInDatabase(username, updatedEmail, updatedLastName, updatedFirstName);
        } else {
            logger.warning(String.format("Username or updated email is missing or invalid in the event details."));
        }
        
        // Handle ASUP metrics sharing consent
        // The allowMetricsSharing is saved as a user attribute by Keycloak
        String userId = event.getUserId();
        if (userId != null) {
            UserModel user = session.users().getUserById(session.getContext().getRealm(), userId);
            if (user != null) {
                List<String> asupAttribute = user.getAttributes().get("allowMetricsSharing");
                if (asupAttribute != null && !asupAttribute.isEmpty()) {
                    String asupValue = asupAttribute.get(0);
                    boolean asupEnabled = "true".equalsIgnoreCase(asupValue);
                    logger.info(String.format("ASUP metrics sharing consent from user %s: %s", username, asupEnabled));
                    updateAsupSettingsInDatabase(asupEnabled, userId);
                }
            }
        }
    }
    
    /**
     * Updates ASUP settings through the reports-service asup/settings API.
     * This is a system-wide setting - the instance creator's choice applies to all users.
     *
     * @param enabled whether ASUP metrics sharing is enabled
     * @param userId the user ID who made the change
     */
    private void updateAsupSettingsInDatabase(boolean enabled, String userId) {
        String reportsBaseUrl = getEnv("REPORTS_SERVICE_BASE_URL", DEFAULT_REPORTS_BASE_URL);
        String endpoint = reportsBaseUrl.replaceAll("/+$", "") + "/asup/settings";

        try {
            String token = getAccessToken();
            if (!ValidationUtil.isValid(token)) {
                logger.warning("Unable to update ASUP settings via API: missing access token");
                return;
            }

            String payload = String.format("{\"enabled\":%s}", enabled);
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(endpoint))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + token)
                .PUT(HttpRequest.BodyPublishers.ofString(payload))
                .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (isSuccessfulAsupSettingsResponse(response.statusCode())) {
                logger.info(String.format("ASUP settings updated via reports-service API: enabled=%s, userId=%s", enabled, userId));
            } else {
                logger.warning(String.format("ASUP settings API update failed with status=%d body=%s", response.statusCode(), response.body()));
            }
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            logger.warning(String.format("Error while calling asup/settings API: %s", e.getMessage()));
        }
    }

    private synchronized String getAccessToken() throws IOException, InterruptedException {
        long now = System.currentTimeMillis() / 1000;
        if (ValidationUtil.isValid(accessToken) && now < expiresAtEpochSeconds) {
            return accessToken;
        }

        String realm = getEnv("KEYCLOAK_REALM", DEFAULT_KEYCLOAK_REALM);
        String clientId = getEnv("KEYCLOAK_CLIENT_ID", DEFAULT_KEYCLOAK_CLIENT_ID);
        String clientSecret = getEnv("KEYCLOAK_CLIENT_SECRET", "");
        if (!ValidationUtil.isValid(clientSecret)) {
            logger.warning("KEYCLOAK_CLIENT_SECRET not configured; cannot fetch token for asup/settings");
            return null;
        }

        String formBody = "client_id=" + urlEncode(clientId)
            + "&client_secret=" + urlEncode(clientSecret)
            + "&grant_type=client_credentials";

        for (String tokenUrl : getTokenUrls(getEnv("KEYCLOAK_BASE_URL", DEFAULT_KEYCLOAK_BASE_URL), realm)) {
            HttpRequest tokenRequest = HttpRequest.newBuilder()
                .uri(URI.create(tokenUrl))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(formBody))
                .build();

            HttpResponse<String> tokenResponse = httpClient.send(tokenRequest, HttpResponse.BodyHandlers.ofString());
            if (!isSuccessfulTokenEndpointResponse(tokenResponse.statusCode())) {
                logger.warning(String.format("Failed to fetch Keycloak token at %s. status=%d body=%s", tokenUrl, tokenResponse.statusCode(), tokenResponse.body()));
                continue;
            }

            TokenResponse tokenData = JsonSerialization.readValue(tokenResponse.body(), TokenResponse.class);
            if (tokenData == null || !ValidationUtil.isValid(tokenData.access_token) || tokenData.expires_in == null) {
                logger.warning(String.format("Token response missing access_token or expires_in at %s", tokenUrl));
                continue;
            }

            long expiresIn = tokenData.expires_in;
            accessToken = tokenData.access_token;
            expiresAtEpochSeconds = now + expiresIn - 10;
            logger.info(String.format("Fetched new access token from %s, expires at: %d (in %ds)", tokenUrl, expiresAtEpochSeconds, expiresIn));
            return accessToken;
        }

        return null;
    }

    private static String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static boolean isSuccessfulAsupSettingsResponse(int statusCode) {
        return statusCode == 200 || statusCode == 201 || statusCode == 204;
    }
    private static boolean isSuccessfulTokenEndpointResponse(int statusCode) {
        return statusCode == 200;
    }

    private static String getEnv(String key, String defaultValue) {
        String value = System.getenv(key);
        return ValidationUtil.isValid(value) ? value : defaultValue;
    }

    private static List<String> getTokenUrls(String baseUrl, String realm) {
        String trimmed = baseUrl.replaceAll("/+$", "");
        LinkedHashSet<String> urls = new LinkedHashSet<>();
        if (trimmed.endsWith("/keycloak")) {
            urls.add(String.format("%s/realms/%s/protocol/openid-connect/token", trimmed, realm));
            urls.add(String.format("%s/realms/%s/protocol/openid-connect/token", trimmed.substring(0, trimmed.length() - "/keycloak".length()), realm));
        } else {
            urls.add(String.format("%s/realms/%s/protocol/openid-connect/token", trimmed, realm));
            urls.add(String.format("%s/keycloak/realms/%s/protocol/openid-connect/token", trimmed, realm));
        }
        return new ArrayList<>(urls);
    }

    private static class TokenResponse {
        public String access_token;
        public Long expires_in;
    }

    /**
     * Updates the user's email in the database.
     *
     * @param username    the user's current username
     * @param updatedEmail the new email to update
     */
    private void updateUserEmailInDatabase(String username, String updatedEmail, String updatedLastName, String updatedFirstName) {
        StringBuilder queryBuilder = new StringBuilder("UPDATE \"user\" SET email = ?");
        List<Object> parameters = new ArrayList<>();
        parameters.add(updatedEmail);
     
        if (updatedFirstName != null) {
            queryBuilder.append(", first_name = ?");
            parameters.add(updatedFirstName);
        }
        if (updatedLastName != null) {
            queryBuilder.append(", last_name = ?");
            parameters.add(updatedLastName);
        }
     
        queryBuilder.append(" WHERE email = ?");
        parameters.add(username);
     
        try (Connection connection = DatabaseConnectionUtil.getConnection();
             PreparedStatement statement = connection.prepareStatement(queryBuilder.toString())) {
     
            for (int i = 0; i < parameters.size(); i++) {
                statement.setObject(i + 1, parameters.get(i));
            }
     
            int rowsAffected = statement.executeUpdate();
          
            if (rowsAffected > 0) {
                logger.info(String.format("User email and optionally first/last name updated successfully in the database for username: %s" , username));
            } else {
                logger.warning(String.format("No user found with username: %s", username));
            }
        } catch (SQLException e) {
            logger.severe(String.format("Database connection error while updating user details: %s" , e.getMessage()));
            throw new RuntimeException(e);
        }
    }
 
    /**
     * Closes the event listener provider, releasing any resources if necessary.
     */
    @Override
    public void close() {
        // No specific resources to close for this implementation
    }
}
package com.netapp.datamigrate;
 
import org.keycloak.events.Event;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventType;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.UserModel;
import com.netapp.datamigrate.utils.DatabaseConnectionUtil;
import com.netapp.datamigrate.utils.ValidationUtil;
 
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.logging.Logger;
import java.util.List;
import java.util.ArrayList;
 
/**
* An implementation of the Keycloak `EventListenerProvider` interface to handle user events.
* Specifically listens for profile update events and updates the email in the database accordingly.
* Also handles ASUP metrics sharing consent from the instance creator.
*/
public class UserProfileEventListener implements EventListenerProvider {
 
    private final KeycloakSession session;
    private static final Logger logger = Logger.getLogger(UserProfileEventListener.class.getName());
    private static final String ASUP_SETTING_KEY = "asup_enabled";
 
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
                    boolean asupEnabled = "true".equalsIgnoreCase(asupValue) || "on".equalsIgnoreCase(asupValue);
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
                    boolean asupEnabled = "true".equalsIgnoreCase(asupValue) || "on".equalsIgnoreCase(asupValue);
                    logger.info(String.format("ASUP metrics sharing consent from user %s: %s", username, asupEnabled));
                    updateAsupSettingsInDatabase(asupEnabled, userId);
                }
            }
        }
    }
    
    /**
     * Updates the ASUP settings in the global_settings table.
     * This is a system-wide setting - the instance creator's choice applies to all users.
     *
     * @param enabled whether ASUP metrics sharing is enabled
     * @param userId the user ID who made the change
     */
    private void updateAsupSettingsInDatabase(boolean enabled, String userId) {
        // Use UPSERT to insert or update the ASUP setting
        String query = """
            INSERT INTO datamigrator.global_settings (setting_key, setting_value, description, setting_type, updated_by)
            VALUES (?, ?, 'ASUP metrics sharing consent set by instance creator', 'boolean', ?::uuid)
            ON CONFLICT (setting_key)
            DO UPDATE SET setting_value = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?::uuid
        """;
        
        try (Connection connection = DatabaseConnectionUtil.getConnection();
             PreparedStatement statement = connection.prepareStatement(query)) {
            
            String enabledValue = String.valueOf(enabled);
            statement.setString(1, ASUP_SETTING_KEY);
            statement.setString(2, enabledValue);
            statement.setString(3, userId);
            statement.setString(4, enabledValue);
            statement.setString(5, userId);
            
            int rowsAffected = statement.executeUpdate();
            
            if (rowsAffected > 0) {
                logger.info(String.format("ASUP settings updated successfully: enabled=%s", enabled));
            } else {
                logger.warning("Failed to update ASUP settings in database");
            }
        } catch (SQLException e) {
            logger.severe(String.format("Database connection error while updating ASUP settings: %s", e.getMessage()));
            // Don't throw - ASUP is non-critical, don't break the login flow
        }
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
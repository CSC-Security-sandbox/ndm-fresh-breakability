package com.netapp.datamigrate;
 
import org.keycloak.events.Event;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventType;
import org.keycloak.models.KeycloakSession;
import com.netapp.datamigrate.utils.DatabaseConnectionUtil;
import com.netapp.datamigrate.utils.ValidationUtil;
 
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.logging.Logger;
 
/**
* An implementation of the Keycloak `EventListenerProvider` interface to handle user events.
* Specifically listens for profile update events and updates the email in the database accordingly.
*/
public class UserProfileEventListener implements EventListenerProvider {
 
    private final KeycloakSession session;
    private static final Logger logger = Logger.getLogger(UserProfileEventListener.class.getName());
 
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
     *
     * @param event the admin event
     * @param includeRepresentation whether to include the resource representation
     */
    @Override
    public void onEvent(AdminEvent event, boolean includeRepresentation) {
        logger.info("Admin event received: " + event.getOperationType());
    }
 
    /**
     * Handles the `UPDATE_PROFILE` event type.
     * Retrieves the updated email and username from the event and updates the database.
     *
     * @param event the event containing user details
     */
    private void handleUpdateProfileEvent(Event event) {
        String username = event.getDetails().get("username");
        String updatedEmail = event.getDetails().get("updated_email");
 
        // Validate event details
        if (ValidationUtil.isValid(username) && ValidationUtil.isValid(updatedEmail)) {
            updateUserEmailInDatabase(username, updatedEmail);
        } else {
            logger.warning("Username or updated email is missing or invalid in the event details.");
        }
    }
 
    /**
     * Updates the user's email in the database.
     *
     * @param username    the user's current username
     * @param updatedEmail the new email to update
     */
    private void updateUserEmailInDatabase(String username, String updatedEmail) {
        String query = "UPDATE migrateadmin.\"user\" SET email = ? WHERE email = ?";
 
        // Execute the database update
        try (Connection connection = DatabaseConnectionUtil.getConnection();
             PreparedStatement statement = connection.prepareStatement(query)) {
 
            statement.setString(1, updatedEmail);
            statement.setString(2, username);
            int rowsAffected = statement.executeUpdate();
 
            // Log the outcome
            if (rowsAffected > 0) {
                logger.info("User email updated successfully in the database for username: " + username);
            } else {
                logger.warning("No user found with username: " + username);
            }
        } catch (SQLException e) {
            logger.severe("Database connection error while updating user email: " + e.getMessage());
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
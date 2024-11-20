package com.netapp.datamigrate;
 
import org.keycloak.events.Event;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventType;
import org.keycloak.models.KeycloakSession;
import com.netapp.datamigrate.utils.DatabaseConnectionUtil;
 
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.logging.Logger;
 
public class UserProfileEventListener implements EventListenerProvider {
 
    private final KeycloakSession session;
    private static final Logger logger = Logger.getLogger(UserProfileEventListener.class.getName());
 
    public UserProfileEventListener(KeycloakSession session) {
        this.session = session;
    }
 
    @Override
    public void onEvent(Event event) {
        if (event.getType() == EventType.UPDATE_PROFILE) {
            handleUpdateProfileEvent(event);
        }
    }
 
    @Override
    public void onEvent(AdminEvent event, boolean includeRepresentation) {
        logger.info("Admin event received: " + event.getOperationType());
    }
 
    private void handleUpdateProfileEvent(Event event) {
        String username = event.getDetails().get("username");
        String updatedEmail = event.getDetails().get("updated_email");

 
        if (username != null && !username.isEmpty() && updatedEmail != null && !updatedEmail.isEmpty()) {
            updateUserEmailInDatabase(username, updatedEmail);
        } else {
            logger.warning("Username or updated email is missing in the event details.");
        }
    }
 
    private void updateUserEmailInDatabase(String username, String updatedEmail) {
        String query = "UPDATE migrateadmin.\"user\" SET email = ? WHERE email = ?";
     
        try (Connection connection = DatabaseConnectionUtil.getConnection();
             PreparedStatement statement = connection.prepareStatement(query)) {
     
            statement.setString(1, updatedEmail);
            statement.setString(2, username);
            int rowsAffected = statement.executeUpdate();
     
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
 
    @Override
    public void close() {
    }
}

package com.netapp.datamigrate.utils;
 
import org.keycloak.models.UserSessionModel;
 
import java.sql.*;
import java.util.*;
import java.util.logging.Logger;
 
/**
* Utility class for fetching user permissions and roles from the database.
* This class provides a method to retrieve the roles, permissions, and associated projects
* for a user based on their email address stored in their Keycloak session.
*/
public class UserPermissionFetcher {
 
    private static final Logger logger = Logger.getLogger(UserPermissionFetcher.class.getName());
 
    /**
     * Fetches user permissions, roles, and associated project IDs from the database.
     *
     * @param userSession the Keycloak user session containing user information
     * @return a map containing user ID, roles, permissions, and project IDs
     * @throws RuntimeException if a database connection or query execution fails
     */
    public static Map<String, Object> getUserPermissions(UserSessionModel userSession) {
        String userEmail = userSession.getUser().getEmail();
        Map<String, Object> userPermissionsData = new HashMap<>();
        List<Map<String, Object>> rolePermissionsList = new ArrayList<>();
        String userId = null;
 
        // SQL query to fetch user roles, permissions, and projects
        String query = """
            SELECT
                u.id AS user_id,
                r.role_name,
                array_agg(DISTINCT p.permission_name) AS permissions,
                COALESCE(array_agg(DISTINCT ur.project_id) FILTER (WHERE ur.project_id IS NOT NULL), '{}') AS projects
            FROM
                user_role ur
            JOIN
                role r ON ur.role_id = r.id
            JOIN
                role_permission rp ON rp.role_id = r.id
            JOIN
                permission p ON rp.permission_id = p.id
            JOIN
                "user" u ON ur.user_id = u.id
            WHERE
                LOWER(u.email) = LOWER(?)
            GROUP BY
                u.id, r.role_name;
        """;
 
        try (Connection connection = DatabaseConnectionUtil.getConnection();
             PreparedStatement statement = connection.prepareStatement(query)) {
 
            statement.setString(1, userEmail);
            ResultSet resultSet = statement.executeQuery();
 
            while (resultSet.next()) {
                if (userId == null) {
                    userId = resultSet.getString("user_id");
                }
                Map<String, Object> roleData = new HashMap<>();
                roleData.put("role_name", resultSet.getString("role_name"));
                roleData.put("permissions", resultSet.getArray("permissions").getArray());
                roleData.put("projects", resultSet.getArray("projects").getArray());
                rolePermissionsList.add(roleData);
            }
        } catch (SQLException e) {
            logger.severe(String.format("Database connection error: %s" , e.getMessage()));
            throw new RuntimeException(e);
        }
 
        userPermissionsData.put("id", userId);
        userPermissionsData.put("roles", rolePermissionsList);
        return userPermissionsData;
    }
}
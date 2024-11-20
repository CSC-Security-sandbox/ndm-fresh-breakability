package com.netapp.datamigrate.utils;

import org.keycloak.models.UserSessionModel;

import java.sql.*;
import java.util.*;
import java.util.logging.Logger;
import com.netapp.datamigrate.utils.DatabaseConnectionUtil;

public class UserPermissionFetcher {
    private static final Logger logger = Logger.getLogger(UserPermissionFetcher.class.getName());

    public static Map<String, Object> getUserPermissions(UserSessionModel userSession) {
        String userEmail = userSession.getUser().getEmail();
        Map<String, Object> userPermissionsData = new HashMap<>();
        List<Map<String, Object>> rolePermissionsList = new ArrayList<>();
        String userId = null;

        String query = """
            SELECT
                u.id AS user_id,
                r.role_name,
                array_agg(DISTINCT p.permission_name) AS permissions,
                array_agg(DISTINCT ur.project_id) AS projects
            FROM
                migrateadmin.user_role ur
            JOIN
                migrateadmin.role r ON ur.role_id = r.id
            JOIN
                migrateadmin.role_permission rp ON rp.role_id = r.id
            JOIN
                migrateadmin.permission p ON rp.permission_id = p.id
            JOIN
                migrateadmin."user" u ON ur.user_id = u.id
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
            logger.severe("Database connection error: " + e.getMessage());
            throw new RuntimeException(e);
        }

        userPermissionsData.put("id", userId);
        userPermissionsData.put("roles", rolePermissionsList);
        return userPermissionsData;
    }
}
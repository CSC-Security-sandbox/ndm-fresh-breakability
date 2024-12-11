package com.netapp.datamigrate.utils;
 
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.logging.Logger;
 
public class DatabaseConnectionUtil {
    private static final String JDBC_URL = System.getenv("KC_DB_URL");
    private static final String DB_USER = System.getenv("KC_DB_USERNAME");
    private static final String DB_PASSWORD = System.getenv("KC_DB_PASSWORD");
    private static final Logger logger = Logger.getLogger(DatabaseConnectionUtil.class.getName());
 
    /**
     * Gets a database connection using environment variables.
     *
     * @return a {@link Connection} object
     * @throws SQLException if a database access error occurs
     */
    public static Connection getConnection() throws SQLException {
        try {
            return DriverManager.getConnection(JDBC_URL, DB_USER, DB_PASSWORD);
        } catch (SQLException e) {
            logger.severe(String.format("Failed to create database connection: %s", e.getMessage()));
            throw e;
        }
    }
}
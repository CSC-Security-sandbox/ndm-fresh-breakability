package com.netapp.datamigrate.utils;
 
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.logging.Logger;
 
public class DatabaseConnectionUtil {
    private static final String DB_HOST = System.getenv("DATAMIGRATOR_DB_HOST");
    private static final String DB_PORT = System.getenv("DATAMIGRATOR_DB_PORT");
    private static final String DB_NAME = System.getenv("DATAMIGRATOR_DB_NAME");
    private static final String DB_USER = System.getenv("DATAMIGRATOR_DB_USERNAME");
    private static final String DB_PASSWORD = System.getenv("DATAMIGRATOR_DB_PASSWORD");
    private static final String DB_SCHEMA = System.getenv("DATAMIGRATOR_DB_SCHEMA");
    private static final String DB_SSL_MODE = System.getenv("DATAMIGRATOR_DB_SSL_MODE");
    
    private static final String JDBC_URL = String.format(
        "jdbc:postgresql://%s:%s/%s?currentSchema=%s&sslmode=%s",
        DB_HOST, DB_PORT, DB_NAME, DB_SCHEMA, DB_SSL_MODE
    );

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
            logger.severe("Failed to create database connection: " + e.getMessage());
            throw e;
        }
    }
}
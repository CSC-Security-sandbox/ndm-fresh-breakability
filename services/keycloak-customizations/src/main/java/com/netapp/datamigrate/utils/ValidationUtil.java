package com.netapp.datamigrate.utils;
 
public class ValidationUtil {
 
    private ValidationUtil() {
        // Private constructor to prevent instantiation
    }
 
    /**
     * Validates if a given value is non-null and not empty.
     *
     * @param value the string to validate
     * @return true if the value is valid, false otherwise
     */
    public static boolean isValid(String value) {
        return value != null && !value.isEmpty();
    }
}
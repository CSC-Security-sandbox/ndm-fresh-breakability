import { useEffect, useState, useCallback } from "react";

/**
 * Profile data structure from the Keycloak login profile page.
 */
export interface LoginProfileData {
  firstName: string;
  lastName: string;
  email: string;
  asupEnabled: boolean;
  consentGiven: boolean;
  loginConsent: boolean;
  timestamp: string;
}

const PROFILE_COOKIE_NAME = "ndm_profile_data";
const ASUP_COOKIE_NAME = "asup_login_consent";

/**
 * Parse a cookie value by name from document.cookie.
 */
function getCookieValue(name: string): string | null {
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [cookieName, cookieValue] = cookie.trim().split("=");
    if (cookieName === name && cookieValue) {
      return decodeURIComponent(cookieValue);
    }
  }
  return null;
}

/**
 * Delete a cookie by name.
 */
function deleteCookie(name: string): void {
  document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/**
 * Read and parse the profile data cookie set by the Keycloak profile page.
 * Returns null if no cookie is found or parsing fails.
 */
function readProfileCookie(): LoginProfileData | null {
  try {
    const cookieValue = getCookieValue(PROFILE_COOKIE_NAME);
    if (cookieValue) {
      const parsed = JSON.parse(cookieValue);
      return {
        firstName: parsed.firstName || "",
        lastName: parsed.lastName || "",
        email: parsed.email || "",
        asupEnabled: parsed.asupEnabled === true,
        consentGiven: parsed.consentGiven === true,
        loginConsent: parsed.loginConsent === true,
        timestamp: parsed.timestamp || new Date().toISOString(),
      };
    }
    return null;
  } catch (error) {
    console.error("Failed to parse profile data cookie:", error);
    return null;
  }
}

/**
 * Read and parse the ASUP consent cookie (legacy/fallback).
 * Returns null if no cookie is found or parsing fails.
 */
function readAsupCookie(): Partial<LoginProfileData> | null {
  try {
    const cookieValue = getCookieValue(ASUP_COOKIE_NAME);
    if (cookieValue) {
      const parsed = JSON.parse(cookieValue);
      return {
        asupEnabled: parsed.enabled === true,
        consentGiven: parsed.consentGiven === true,
        loginConsent: parsed.loginConsent === true,
        timestamp: parsed.timestamp || new Date().toISOString(),
      };
    }
    return null;
  } catch (error) {
    console.error("Failed to parse ASUP cookie:", error);
    return null;
  }
}

/**
 * Hook to read profile data from the login page cookie.
 * 
 * This hook reads the cookie set by the Keycloak profile update page
 * (profileVisibility.js) and provides the data for use in the UI.
 * 
 * The data includes:
 * - firstName: User's first name
 * - lastName: User's last name
 * - email: User's email address
 * - asupEnabled: Whether the user opted into ASUP metrics sharing
 * 
 * @param clearAfterRead - If true, clears the cookie after reading (default: true)
 * @returns Object containing profile data and helper functions
 */
export function useProfileDataFromLogin(clearAfterRead: boolean = true) {
  const [profileData, setProfileData] = useState<LoginProfileData | null>(null);
  const [hasData, setHasData] = useState(false);
  const [isRead, setIsRead] = useState(false);

  /**
   * Clear the profile cookies manually.
   */
  const clearCookies = useCallback(() => {
    deleteCookie(PROFILE_COOKIE_NAME);
    deleteCookie(ASUP_COOKIE_NAME);
    console.log("Profile data cookies cleared");
  }, []);

  /**
   * Read the profile data from cookies.
   */
  const readData = useCallback(() => {
    // Try the full profile cookie first
    let data = readProfileCookie();
    
    // If no full profile, try the legacy ASUP cookie
    if (!data) {
      const asupData = readAsupCookie();
      if (asupData) {
        data = {
          firstName: "",
          lastName: "",
          email: "",
          asupEnabled: asupData.asupEnabled || false,
          consentGiven: asupData.consentGiven || false,
          loginConsent: asupData.loginConsent || false,
          timestamp: asupData.timestamp || new Date().toISOString(),
        };
      }
    }

    if (data) {
      console.log("Profile data read from cookie:", {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        asupEnabled: data.asupEnabled,
      });
      setProfileData(data);
      setHasData(true);
    } else {
      setHasData(false);
    }

    setIsRead(true);
    return data;
  }, []);

  // Read profile data on mount
  useEffect(() => {
    if (!isRead) {
      const data = readData();
      
      // Clear cookies after reading if requested
      if (clearAfterRead && data) {
        clearCookies();
      }
    }
  }, [isRead, readData, clearAfterRead, clearCookies]);

  return {
    /**
     * The profile data from the login page, or null if not available.
     */
    profileData,
    
    /**
     * Whether profile data was found in the cookie.
     */
    hasData,
    
    /**
     * Whether the cookie has been read (regardless of whether data was found).
     */
    isRead,
    
    /**
     * Clear the profile cookies manually.
     */
    clearCookies,
    
    /**
     * Re-read the profile data from cookies.
     */
    readData,
    
    // Convenience accessors
    firstName: profileData?.firstName || "",
    lastName: profileData?.lastName || "",
    email: profileData?.email || "",
    asupEnabled: profileData?.asupEnabled || false,
    consentGiven: profileData?.consentGiven || false,
    loginConsent: profileData?.loginConsent || false,
  };
}

export default useProfileDataFromLogin;

/**
 * Profile Update Page - User Details and Metrics Sharing Handler
 * 
 * This script handles the profile update form submission, capturing:
 * - First Name
 * - Last Name  
 * - Email
 * - ASUP Metrics Sharing consent (allowMetricsSharing checkbox)
 * 
 * This page is shown ONLY to the instance creator on first login.
 * 
 * HOW IT WORKS:
 * 1. User fills out the form and checks/unchecks the ASUP checkbox
 * 2. When the form is submitted, Keycloak processes the profile update
 * 3. The UserProfileEventListener (Java) receives the UPDATE_PROFILE event
 * 4. The listener reads the allowMetricsSharing attribute and saves it to global_settings table
 * 5. NDM UI fetches the ASUP setting from the backend API
 * 
 * No cookies or localStorage needed - the setting flows through Keycloak to the database.
 */

/**
 * Log form submission for debugging purposes.
 * The actual ASUP setting is handled server-side by UserProfileEventListener.
 */
function handleProfileFormSubmit() {
  const form = document.getElementById("kc-profile-update-form");
  
  if (!form) {
    console.warn("Profile update form not found");
    return;
  }

  // Get form field references
  const firstNameInput = document.getElementById("firstName");
  const lastNameInput = document.getElementById("lastName");
  const emailInput = document.getElementById("email");
  const asupCheckbox = document.getElementById("allowMetricsSharing");

  form.addEventListener("submit", function() {
    // Log the profile data for debugging
    const profileData = {
      firstName: firstNameInput ? firstNameInput.value.trim() : "",
      lastName: lastNameInput ? lastNameInput.value.trim() : "",
      email: emailInput ? emailInput.value.trim() : "",
      asupEnabled: asupCheckbox ? asupCheckbox.checked : false
    };

    console.log("Profile form submitted:", profileData);
    // The actual saving is handled by Keycloak's UserProfileEventListener on the server side
  });

  console.log("Profile form submit handler initialized");
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", handleProfileFormSubmit);
} else {
  handleProfileFormSubmit();
}

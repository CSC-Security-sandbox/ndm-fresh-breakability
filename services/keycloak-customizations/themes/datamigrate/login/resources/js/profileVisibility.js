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
    // The actual saving is handled by Keycloak's UserProfileEventListener on the server side
  });
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", handleProfileFormSubmit);
} else {
  handleProfileFormSubmit();
}

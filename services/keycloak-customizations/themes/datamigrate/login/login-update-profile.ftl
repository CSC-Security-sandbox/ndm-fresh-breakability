<head>
    <link href="${url.resourcesPath}/css/vendor/tailwind.min.css" rel="stylesheet">
</head>
<#import "template.ftl" as layout>
    <@layout.registrationLayout displayMessage=false; section>
        <#if section="header">
            <nav class="border-blue-200 bg-blue-50 dark:bg-blue-800 dark:border-blue-700">
                <div class="navbarStyles flex flex-wrap items-center justify-between mx-auto p-4">
                    <a href="#" class="flex items-center space-x-3 rtl:space-x-reverse">
                        <div class="flex">
                            <div class="netappNavBarLogo"></div>
                            <div>
                                <span class="self-center text-2xl font-semibold whitespace-nowrap dark:text-white">
                                    NetApp Data Migrator
                                </span>
                            </div>
                        </div>
                    </a>
                </div>
            </nav>
            <#elseif section="form">
                <div class="flex flex-col justify-center items-center gap-3 min-h-screen bg-gray-100 customBackgroundClassColor">
                    <div class="netappLogo"></div>
                    <div class="login-card text-center bg-white shadow-md rounded-lg p-8">
                        <div class="text-2xl mb-4">
                            ${msg("Your Details")}
                        </div>
                        <div class="text-gray-500 text-sm leading-tight py-2 mb-4">
                            Please provide your name and email.
                        </div>
                        <form
                            id="kc-profile-update-form"
                            action="${url.loginAction}"
                            method="post"
                            onsubmit="update.disabled = true; return true;">
                            <div class="flex gap-2 w-full">
                                <!-- First Name -->
                                <div class="w-full my-4 text-left inputClassDiv">
                                    <label for="firstName" class="${properties.kcLabelClass!}">
                                        ${msg("First Name")}
                                    </label>
                                    <div class="${properties.kcInputWrapperClass!}">
                                        <input
                                            type="text"
                                            id="firstName"
                                            name="firstName"
                                            class="${properties.kcInputClass!}"
                                            autocomplete="given-name"
                                            placeholder="${msg("First Name")}"
                                            aria-invalid="<#if messagesPerField.existsError('firstName')>true</#if>" />
                                    </div>
                                    <#if messagesPerField.existsError('firstName')>
                                        <span id="input-error-firstName" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                            ${kcSanitize(messagesPerField.get('firstName'))?no_esc}
                                        </span>
                                    </#if>
                                </div>
                                <!-- Last Name -->
                                <div class="w-full my-4 text-left inputClassDiv">
                                    <label for="lastName" class="${properties.kcLabelClass!}">
                                        ${msg("Last Name")}
                                    </label>
                                    <div class="${properties.kcInputWrapperClass!}">
                                        <input
                                            type="text"
                                            id="lastName"
                                            name="lastName"
                                            class="${properties.kcInputClass!}"
                                            autocomplete="family-name"
                                            placeholder="${msg("Last Name")}"
                                            aria-invalid="<#if messagesPerField.existsError('lastName')>true</#if>" />
                                    </div>
                                    <#if messagesPerField.existsError('lastName')>
                                        <span id="input-error-lastName" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                            ${kcSanitize(messagesPerField.get('lastName'))?no_esc}
                                        </span>
                                    </#if>
                                </div>
                            </div>
                            <!-- Email -->
                            <div class="w-full my-4 text-left inputClassDiv">
                                <label for="email" class="${properties.kcLabelClass!}">
                                    ${msg("Email")}
                                </label>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <input
                                        type="email"
                                        id="email"
                                        name="email"
                                        class="${properties.kcInputClass!}"
                                        autocomplete="email"
                                        placeholder="${msg("Enter Email")}"
                                        aria-invalid="<#if messagesPerField.existsError('email')>true</#if>" />
                                </div>
                                <#if messagesPerField.existsError('email')>
                                    <span id="input-error-email" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                        ${kcSanitize(messagesPerField.get('email'))?no_esc}
                                    </span>
                                </#if>
                            </div>
                            <!-- ASUP Metrics Sharing (Optional) -->
                            <div class="w-full my-4 text-left">
                                <div class="flex items-start gap-2">
                                    <!-- Hidden field to ensure value is always sent (false by default) -->
                                    <!-- Use user.attributes.* naming for Keycloak to save as user attribute -->
                                    <input type="hidden" id="allowMetricsSharingHidden" name="user.attributes.allowMetricsSharing" value="false" />
                                    <input
                                        type="checkbox"
                                        id="allowMetricsSharingCheckbox"
                                        class="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                    <div class="flex flex-col">
                                        <label for="allowMetricsSharingCheckbox" class="text-sm font-medium text-gray-700 cursor-pointer">
                                            ${msg("Allow Metrics Sharing")}
                                            <span class="text-gray-400 font-normal">(Optional)</span>
                                        </label>
                                        <p class="text-xs text-gray-500 mt-1">
                                            Allow sharing usage metrics with NetApp to help improve NetApp Data Migrator.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <!-- EULA Acceptance (Required) -->
                            <div class="w-full my-4 text-left">
                                <div class="flex items-start gap-2">
                                    <input
                                        type="checkbox"
                                        id="eulaAcceptCheckbox"
                                        class="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        required />
                                    <div class="flex flex-col">
                                        <label for="eulaAcceptCheckbox" class="text-sm font-medium text-gray-700 cursor-pointer">
                                            I accept the
                                            <a href="#" id="eula-link" class="text-blue-600 hover:text-blue-800 underline">
                                                End User License Agreement
                                            </a><span class="text-red-500">*</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                            <!-- Submit Button -->
                            <div class="my-2 w-full">
                                <button
                                    id="kc-update-profile"
                                    type="submit"
                                    disabled
                                    style="background-color: #9ca3af; cursor: not-allowed;"
                                    class="${properties.kcButtonClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!} text-white">
                                    ${msg("Proceed")}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
                
                <!-- EULA Modal Overlay -->
                <div id="eula-modal-overlay" class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center" style="display: none;">
                    <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col" style="max-width: 900px;">
                        <!-- Modal Header -->
                        <div class="bg-gray-200 px-6 py-4 rounded-t-lg border-b border-gray-300 flex justify-between items-center">
                            <h2 class="text-lg font-semibold text-gray-800">End User License Agreement</h2>
                            <button id="eula-close-button" type="button" class="text-gray-500 hover:text-gray-700 focus:outline-none">
                                <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                                </svg>
                            </button>
                        </div>
                        
                        <!-- Modal Content - Scrollable EULA -->
                        <div class="flex-1 overflow-y-auto border-b border-gray-300 p-6" style="min-height: 400px; max-height: 60vh;">
                            <#include "eula.ftl">
                        </div>
                        
                        <!-- Modal Footer -->
                        <div class="px-6 py-4 bg-gray-50 rounded-b-lg">
                            <div class="flex justify-end">
                                <button
                                    id="eula-close-footer-button"
                                    type="button"
                                    class="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors">
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <#elseif section="footer">
                    <!-- Optional footer section -->
        </#if>
    </@layout.registrationLayout>
    <style>
        /* Prevent body scroll when modal is open */
        body.modal-open {
            overflow: hidden;
        }
        
        /* Smooth modal transitions */
        #eula-modal-overlay {
            animation: fadeIn 0.3s ease-in-out;
        }
        
        @keyframes fadeIn {
            from {
                opacity: 0;
            }
            to {
                opacity: 1;
            }
        }
        
    </style>
    <script>
        // EULA Modal Control
        (function() {
            var eulaModal = document.getElementById('eula-modal-overlay');
            var eulaLink = document.getElementById('eula-link');
            var closeButton = document.getElementById('eula-close-button');
            var closeFooterButton = document.getElementById('eula-close-footer-button');
            var eulaAcceptCheckbox = document.getElementById('eulaAcceptCheckbox');
            var form = document.getElementById('kc-profile-update-form');
            var submitButton = document.getElementById('kc-update-profile');
            var body = document.body;
            
            // Function to update submit button state and style based on EULA acceptance
            function updateSubmitButtonState() {
                if (submitButton && eulaAcceptCheckbox) {
                    if (eulaAcceptCheckbox.checked) {
                        // EULA accepted - enable button with blue color
                        submitButton.disabled = false;
                        submitButton.style.backgroundColor = '#2563eb'; // blue-600
                        submitButton.style.cursor = 'pointer';
                    } else {
                        // EULA not accepted - disable button with gray color
                        submitButton.disabled = true;
                        submitButton.style.backgroundColor = '#9ca3af'; // gray-400
                        submitButton.style.cursor = 'not-allowed';
                    }
                }
            }
            
            // Listen for EULA checkbox changes
            if (eulaAcceptCheckbox) {
                eulaAcceptCheckbox.addEventListener('change', updateSubmitButtonState);
            }
            
            function showModal() {
                if (eulaModal) {
                    eulaModal.style.display = 'flex';
                }
                if (body) {
                    body.classList.add('modal-open');
                }
            }
            
            function hideModal() {
                if (eulaModal) {
                    eulaModal.style.display = 'none';
                }
                if (body) {
                    body.classList.remove('modal-open');
                }
            }
            
            if (eulaLink) {
                eulaLink.addEventListener('click', function(e) {
                    e.preventDefault();
                    showModal();
                });
            }
            
            if (closeButton) {
                closeButton.addEventListener('click', function() {
                    hideModal();
                });
            }
            
            if (closeFooterButton) {
                closeFooterButton.addEventListener('click', function() {
                    hideModal();
                });
            }
            
            if (eulaModal) {
                eulaModal.addEventListener('click', function(e) {
                    if (e.target === eulaModal) {
                        hideModal();
                    }
                });
            }
            
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && eulaModal && eulaModal.style.display === 'flex') {
                    hideModal();
                }
            });
            
            // Prevent form submission if EULA not accepted (safety check)
            if (form) {
                form.addEventListener('submit', function(e) {
                    if (eulaAcceptCheckbox && !eulaAcceptCheckbox.checked) {
                        e.preventDefault();
                        alert('Please accept the End User License Agreement to continue.');
                        eulaAcceptCheckbox.focus();
                        return false;
                    }
                });
            }
        })();
        
        // Sync checkbox state to hidden field so value is always submitted
        (function() {
            var checkbox = document.getElementById('allowMetricsSharingCheckbox');
            var hidden = document.getElementById('allowMetricsSharingHidden');
            
            if (checkbox && hidden) {
                // Update hidden field when checkbox changes
                checkbox.addEventListener('change', function() {
                    hidden.value = checkbox.checked ? 'true' : 'false';
                });
                
                // Also update on form submit to ensure latest value
                var form = document.getElementById('kc-profile-update-form');
                if (form) {
                    form.addEventListener('submit', function() {
                        hidden.value = checkbox.checked ? 'true' : 'false';
                    });
                }
            }
        })();
    </script>
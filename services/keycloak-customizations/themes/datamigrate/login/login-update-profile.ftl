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
                                    <input type="hidden" id="allowMetricsSharingHidden" name="user.attributes.allowMetricsSharing" value="true" />
                                    <input
                                        type="checkbox"
                                        id="allowMetricsSharingCheckbox"
                                        checked
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
                            <!-- Submit Button -->
                            <div class="my-2 w-full">
                                <button
                                    id="kc-update-profile"
                                    type="submit"
                                    class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}">
                                    ${msg("Proceed")}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
                <#elseif section="footer">
                    <!-- Optional footer section -->
        </#if>
    </@layout.registrationLayout>
    <script>
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
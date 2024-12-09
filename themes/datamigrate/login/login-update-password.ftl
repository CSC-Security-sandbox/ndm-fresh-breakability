<head>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss/dist/tailwind.min.css" rel="stylesheet">
</head>
<#import "template.ftl" as layout>
    <@layout.registrationLayout displayMessage=!messagesPerField.existsError('password', 'password-confirm' ); section>
        <#if section="header">
            <nav class="border-red-200 bg-red-50 dark:bg-red-800 dark:border-red-700">
                <div class="navbarStyles flex flex-wrap items-center justify-between mx-auto p-4">
                    <a href="#" class="flex items-center space-x-3 rtl:space-x-reverse">
                        <div class="flex">
                            <div class="netappNavBarLogo"></div>
                            <div>
                                <span class="self-center text-2xl font-semibold whitespace-nowrap dark:text-white">
                                    NetApp DataMigrate
                                </span>
                            </div>
                        </div>
                    </a>
                </div>
            </nav>
        </#if>
        <#if section="form">
            <div class="flex flex-col justify-center items-center gap-3 min-h-screen bg-gray-100 customBackgroundClassColor">
                <div class="netappLogo"></div>
                <div class="login-card text-center bg-white shadow-md rounded-lg p-8">
                    <div class="text-2xl mb-4">
                        Update Password
                    </div>
                    <div class="text-base-secondary text-sm leading-tight py-2 mb-10">
                        Your new password must be different from <br /> previous used password.
                    </div>
                    <form
                        id="kc-passwd-update-form"
                        action="${url.loginAction}"
                        method="post"
                        onsubmit="update.disabled = true; return validatePasswords();">
                        <div class="flex flex-col gap-10">
                            <!-- New Password -->
                            <div class="w-full text-left">
                                <label for="password-new" class="${properties.kcLabelClass!}">
                                    ${msg("passwordNew")}
                                </label>
                                <div class="relative ${properties.kcInputWrapperClass!}">
                                    <input
                                        type="password"
                                        id="password-new"
                                        name="password-new"
                                        class="${properties.kcInputClass!}"
                                        autocomplete="new-password"
                                        placeholder="Enter ${msg("passwordNew")}"
                                        aria-invalid="<#if messagesPerField.existsError('password')>true</#if>" />
                                    <button type="button" id="toggle-password-new" class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500">
                                        <i id="eye-icon-new" class="fas fa-eye" style="margin-right:1rem;"></i>
                                    </button>
                                </div>
                                <#if messagesPerField.existsError('password')>
                                    <span id="input-error-password" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                        ${kcSanitize(messagesPerField.get('password'))?no_esc}
                                    </span>
                                </#if>
                            </div>
                            <!-- Confirm Password -->
                            <div class="w-full text-left">
                                <label for="password-confirm" class="${properties.kcLabelClass!}">
                                    ${msg("passwordConfirm")}
                                </label>
                                <div class="relative ${properties.kcInputWrapperClass!}">
                                    <input
                                        type="password"
                                        id="password-confirm"
                                        name="password-confirm"
                                        class="${properties.kcInputClass!}"
                                        autocomplete="new-password"
                                        placeholder="Confirm ${msg("password")}"
                                        aria-invalid="<#if messagesPerField.existsError('password-confirm')>true</#if>" />
                                    <button type="button" id="toggle-password-confirm" class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500">
                                        <i id="eye-icon-confirm" class="fas fa-eye" style="margin-right:1rem;"></i>
                                    </button>
                                </div>
                                <#if messagesPerField.existsError('password-confirm')>
                                    <span id="input-error-password-confirm" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                        ${kcSanitize(messagesPerField.get('password-confirm'))?no_esc}
                                    </span>
                                </#if>
                            </div>
                            <!-- Password Match Error -->
                            <div id="password-match-error" class="text-red-500 text-sm hidden">
                                Passwords do not match.
                            </div>
                            <!-- Submit Button -->
                            <div class="my-2 w-full">
                                <button
                                    id="kc-update-password"
                                    type="submit"
                                    class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}">
                                    ${msg("doSubmit")}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
            <script>
            // Toggle password visibility
            const toggleVisibility = (fieldId, iconId) => {
                const field = document.getElementById(fieldId);
                const icon = document.getElementById(iconId);
                if (field.type === 'password') {
                    field.type = 'text';
                    icon.classList.remove('fa-eye');
                    icon.classList.add('fa-eye-slash');
                } else {
                    field.type = 'password';
                    icon.classList.remove('fa-eye-slash');
                    icon.classList.add('fa-eye');
                }
            };
            document.getElementById('toggle-password-new').addEventListener('click', () => toggleVisibility('password-new', 'eye-icon-new'));
            document.getElementById('toggle-password-confirm').addEventListener('click', () => toggleVisibility('password-confirm', 'eye-icon-confirm'));
            // Validate matching passwords
            const validatePasswords = () => {
                const password = document.getElementById('password-new').value;
                const confirmPassword = document.getElementById('password-confirm').value;
                const error = document.getElementById('password-match-error');
                if (password !== confirmPassword) {
                    error.classList.remove('hidden');
                    return false;
                }
                error.classList.add('hidden');
                return true;
            };
            </script>
        </#if>
    </@layout.registrationLayout>
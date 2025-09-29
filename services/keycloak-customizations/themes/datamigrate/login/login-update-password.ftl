<head>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" rel="stylesheet">
    <link href="${url.resourcesPath}/css/all.min.css" rel="stylesheet">
    <style>
    .password-rule {
        font-size: 0.75rem;
        font-family: 'Roboto', sans-serif;
        letter-spacing: 1px;
        margin-top: 0.4rem;
        line-height: 1.2;
    }
    .rule-passed {
        color: green;
    }
    .rule-failed {
        color: red;
    }
    .password-policy-heading {
        font-size: 0.85rem;
        font-weight: bold;
        font-family: 'Roboto', sans-serif;
        color: #000000;
        margin-top: 1.3rem;
    }
</style>
</head>

<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
    <#if section="header">
        <nav class="border-red-200 bg-red-50 dark:bg-red-800 dark:border-red-700">
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
    </#if>

    <#if section="form">
        <div class="flex flex-col justify-center items-center gap-3 min-h-screen bg-gray-100 customBackgroundClassColor">
            <div class="netappLogo"></div>
            <div class="login-card text-center bg-white shadow-md rounded-lg p-8">
                <div class="text-2xl mb-4">
                    Reset Password
                </div>
                <div class="text-gray-500 text-sm leading-tight py-2 mb-10">
                    Your new password must be different from <br /> previous used password.
                </div>

                <form id="kc-passwd-update-form" action="${url.loginAction}" method="post" onsubmit="update.disabled = true; return validatePasswords();">
                    <div class="flex flex-col gap-10">
                        <!-- New Password -->
                        <div class="w-full text-left">
                            <label for="password-new" class="${properties.kcLabelClass!}">
                                ${msg("passwordNew")}
                            </label>
                            <div class="relative ${properties.kcInputWrapperClass!}">
                                <input type="password" id="password-new" name="password-new" class="${properties.kcInputClass!}" autocomplete="new-password" placeholder="${msg("passwordNew")}" aria-invalid="<#if messagesPerField.existsError('password')>true</#if>" />
                                <button type="button" id="toggle-password-new" class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500">
                                    <i id="eye-icon-new" class="fa-regular fa-eye" style="margin-right:1rem;"></i>
                                </button>
                            </div>
                            <#if messagesPerField.existsError('password')>
                                <span id="input-error-password" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                    ${kcSanitize(messagesPerField.get('password'))?no_esc}
                                </span>
                            </#if>

                            <!-- Password Rules -->
                           <!-- Password Rules -->
                            <div id="password-rules-container">
                                <div class="password-policy-heading">Password Policy</div>
                                    <div id="password-rules" class="password-rule">
                                    <div id="rule-length" class="rule-failed">At least 8 characters</div>
                                    <div id="rule-uppercase" class="rule-failed">At least one uppercase letter</div>
                                    <div id="rule-lowercase" class="rule-failed">At least one lowercase letter</div>
                                    <div id="rule-number" class="rule-failed">At least one number</div>
                                    <div id="rule-special" class="rule-failed">At least one special character: ! @ # $ % ^ & * ( ) , . ? " : { } | < > + ]</div>
                                </div>
                            </div>
                        </div>

                        <!-- Confirm Password -->
                        <div class="w-full text-left">
                            <label for="password-confirm" class="${properties.kcLabelClass!}">
                                ${msg("passwordConfirm")}
                            </label>
                            <div class="relative ${properties.kcInputWrapperClass!}">
                                <input type="password" id="password-confirm" name="password-confirm" class="${properties.kcInputClass!}" autocomplete="new-password" placeholder="Confirm ${msg("password")}" aria-invalid="<#if messagesPerField.existsError('password-confirm')>true</#if>" />
                                <button type="button" id="toggle-password-confirm" class="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500">
                                    <i id="eye-icon-confirm" class="fa-regular fa-eye" style="margin-right:1rem;"></i>
                                </button>
                            </div>
                            <#if messagesPerField.existsError('password-confirm')>
                                <span id="input-error-password-confirm" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                    ${kcSanitize(messagesPerField.get('password-confirm'))?no_esc}
                                </span>
                            </#if>
                        </div>

                        <!-- Submit Button -->
                        <div class="my-2 w-full">
                            <button id="kc-update-password" type="submit" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}" disabled style="opacity: 0.5;">
                                Reset Password
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

            // Password validation rules
            const passwordRules = () => {
                const password = document.getElementById('password-new').value;
                const confirmPassword = document.getElementById('password-confirm').value;
                const rules = {
                    length: password.length >= 8,
                    uppercase: /[A-Z]/.test(password),
                    lowercase: /[a-z]/.test(password),
                    number: /[0-9]/.test(password),
                    special: /[!@#$%^&*(),.?":{}|<>+\]]/.test(password),
                };

                // Update rule status
                document.getElementById('rule-length').className = rules.length ? 'rule-passed' : 'rule-failed';
                document.getElementById('rule-uppercase').className = rules.uppercase ? 'rule-passed' : 'rule-failed';
                document.getElementById('rule-lowercase').className = rules.lowercase ? 'rule-passed' : 'rule-failed';
                document.getElementById('rule-number').className = rules.number ? 'rule-passed' : 'rule-failed';
                document.getElementById('rule-special').className = rules.special ? 'rule-passed' : 'rule-failed';

                const allRulesPassed = Object.values(rules).every(rule => rule);
                
                const passwordsMatch = password === confirmPassword;
                const bothFieldsHaveValues = password && confirmPassword;
                
                const canSubmit = allRulesPassed && bothFieldsHaveValues && passwordsMatch;
                const submitButton = document.getElementById('kc-update-password');
                submitButton.disabled = !canSubmit;
                submitButton.style.opacity = canSubmit ? '1' : '0.5';
            };

            // Call password validation on input for both fields
            document.getElementById('password-new').addEventListener('input', passwordRules);
            document.getElementById('password-confirm').addEventListener('input', passwordRules);

            // Additional validation for matching passwords before submitting the form
            function validatePasswords() {
                const password = document.getElementById('password-new').value;
                const confirmPassword = document.getElementById('password-confirm').value;
                
                if (password !== confirmPassword) {
                    return false;
                }
                return true;
            }
        </script>
    </#if>
</@layout.registrationLayout>
<head>
    <link href="${url.resourcesPath}/css/vendor/font-awesome.min.css" rel="stylesheet">
    <link href="${url.resourcesPath}/css/vendor/tailwind.min.css" rel="stylesheet">
    <style>
        .emailInputLable {
        margin-bottom: 0.8rem;
        }
    </style>
</head>
<#import "template.ftl" as layout>
    <@layout.registrationLayout displayMessage=false displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>

        <#if section="form">
            <nav class="border-red-200 bg-red-50 dark:bg-red-800 dark:border-red-700">
                <div class="navbarStyles flex flex-wrap items-center justify-between mx-auto p-4">
                    <a href="#" class="flex items-center space-x-3 rtl:space-x-reverse">
                        <div class="flex">
                            <div class="netappNavBarLogo"></div>
                            <div>
                                <span class="self-center text-2xl font-semibold whitespace-nowrap dark:text-white">NetApp Data Migrator</span>
                            </div>
                        </div>
                    </a>
                </div>
                </div>
            </nav>
            <div class="flex flex-col justify-center items-center gap-3 min-h-screen bg-gray-100 customBackgroundClassColor">
                <div class="netappLogo"></div>
                <div class="login-card text-center bg-white shadow-md rounded-lg p-8">
                    <div class="text-2xl mb-2">Welcome!</div>
                    <div class="text-gray-500 text-sm leading-tight py-2 mb-10">Log in to Data Migrator</div>
                    <div>
                        <form
                            id="kc-form-login"
                            onsubmit="login.disabled = true; return true;"
                            action="${url.loginAction}"
                            method="post">
                            <div class="flex flex-col gap-10">
                                <!-- Username -->
                                <div class="w-full text-left">
                                    <label class="${properties.kcLabelWrapperClass!} emailInputLable">Email/Username</label>
                                    <div class="${properties.kcInputWrapperClass!} mt-3 mb-2">
                                        <input
                                            tabindex="1"
                                            id="username"
                                            class="${properties.kcInputClass!}"
                                            name="username"
                                            value="${(login.username!'admin@datamigrator.local')}"
                                            type="text"
                                            autofocus
                                            autocomplete="off"
                                            aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                                            placeholder="Enter Email" />
                                    </div>
                                </div>
                                <!-- Password -->
                                <div class="w-full text-left">
                                    <label class="${properties.kcLabelWrapperClass!}">Password</label>
                                    <div class="${properties.kcInputWrapperClass!} relative mt-3">
                                        <input
                                            tabindex="2"
                                            id="password"
                                            class="${properties.kcInputClass!}"
                                            name="password"
                                            type="password"
                                            value="Welcome@123"
                                            autocomplete="off"
                                            aria-invalid="<#if messagesPerField.existsError('password')>true</#if>"
                                            placeholder="Enter ${msg("password")}" />
                                        <!-- Show/Hide Password Button -->
                                        <button type="button" id="toggle-password" class="eyeIconClass right-4" >
                                            <i id="eye-icon" class="fa-regular fa-eye"></i> <!-- Show Icon -->
                                        </button>
                                        <!-- Display Password Error -->
                                    
                                    </div>
                                </div>

                                <!-- Submit Button --> 
                                <#if message?has_content>
                                    <div class="text-red-500 text-sm">
                                      ${kcSanitize(message.summary)?no_esc}
                                    </div>
                                </#if>
                                <div class="w-full">
                                    <button
                                        tabindex="4"
                                        class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!} submit-btn my-4"
                                        name="login"
                                        label="login"
                                        id="kc-login"
                                        type="submit">
                                        ${msg("doLogIn")}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
            <script type="module" src="${url.resourcesPath}/js/passwordVisibility.js"></script>
            <script>
            // Toggle password visibility
            document.getElementById('toggle-password').addEventListener('click', function() {
                const passwordField = document.getElementById('password');
                const eyeIcon = document.getElementById('eye-icon');
                if (passwordField.type === 'password') {
                    passwordField.type = 'text';
                    eyeIcon.classList.remove('fa-eye');
                    eyeIcon.classList.add('fa-eye-slash'); // Change icon to "eye-slash"
                } else {
                    passwordField.type = 'password';
                    eyeIcon.classList.remove('fa-eye-slash');
                    eyeIcon.classList.add('fa-eye'); // Change icon back to "eye"
                }
            });
            </script>
        </#if>
    </@layout.registrationLayout>
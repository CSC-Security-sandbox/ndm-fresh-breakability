<#import "template.ftl" as layout>
    <@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>

        <head>
            <!-- Add Font Awesome for icons -->
            <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" rel="stylesheet">
            <!-- Other head elements such as title, meta tags, etc. -->
        </head>
        <#if section="form">
            <nav class="border-red-200 bg-red-50 dark:bg-red-800 dark:border-red-700">
                <div class="max-w-screen-xl navbarStyles flex flex-wrap items-center justify-between mx-auto p-4">
                    <a href="#" class="flex items-center space-x-3 rtl:space-x-reverse">
                        <div class="flex">
                            <div class="netappNavBarLogo"></div>
                            <div>
                                <span class="self-center text-2xl font-semibold whitespace-nowrap dark:text-white">NetApp DataMigrate</span>
                            </div>
                        </div>
                    </a>
                </div>
                </div>
            </nav>
            <div class="flex flex-col justify-center items-center gap-3 min-h-screen bg-gray-100 customBackgroundClassColor">
                <div class="netappLogo"></div>
                <div class="login-card text-center bg-white shadow-md rounded-lg p-8">
                    <div class="text-2xl mb-4">Welcome!</div>
                    <div class="text-base-secondary text-sm leading-tight py-2 mb-4">Login To Datamigrate</div>
                    <div>
                        <form
                            id="kc-form-login"
                            onsubmit="login.disabled = true; return true;"
                            action="${url.loginAction}"
                            method="post">
                            <!-- Username -->
                            <div class="w-full my-7 text-left inputClassDiv">
                                <label class="${properties.kcLabelWrapperClass!}">Email</label>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <input
                                        tabindex="1"
                                        id="username"
                                        class="${properties.kcInputClass!}"
                                        name="username"
                                        value="${(login.username!'')}"
                                        type="text"
                                        autofocus
                                        autocomplete="off"
                                        aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                                        placeholder="Enter ${msg("username")}" />
                                </div>
                            </div>
                            <!-- Password -->
                            <div class="w-full my-4 text-left inputClassDiv">
                                <label class="${properties.kcLabelWrapperClass!}">Password</label>
                                <div class="${properties.kcInputWrapperClass!}">
                                        <input
                                            tabindex="2"
                                            id="password"
                                            class="${properties.kcInputClass!}"
                                            name="password"
                                            type="password"
                                            autocomplete="off"
                                            aria-invalid="<#if messagesPerField.existsError('password')>true</#if>"
                                            placeholder="Enter ${msg("password")}" />
                                        <!-- Show/Hide Password Button -->
                                        <button type="button" id="toggle-password" class="eyeIconClass" >
                                            <i id="eye-icon" class="fas fa-eye"></i> <!-- Show Icon -->
                                        </button>
                                        <div>
                                        </div>
                                        <!-- Display Password Error -->
                                        
                                    </div>
                                    <!-- Submit Button --> 
                                    <#if messagesPerField.existsError('password')>
                                            <div class="text-red-500 text-sm mt-2">
                                                ${kcSanitize(messagesPerField.get('password'))?no_esc}
                                            </div>
                                        </#if>
                                    <div class="my-2 w-full">
                                        <button
                                            tabindex="4"
                                            class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!} submit-btn"
                                            name="login"
                                            label="login"
                                            id="kc-login"
                                            type="submit">
                                            ${msg("doLogIn")}
                                        </button>
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
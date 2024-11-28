<#import "template.ftl" as layout>
    <@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>
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
                                        aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                                        placeholder="Enter ${msg("password")}" />
                                </div>
                            </div>
                            <!-- Submit Button -->
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
        </#if>
    </@layout.registrationLayout>
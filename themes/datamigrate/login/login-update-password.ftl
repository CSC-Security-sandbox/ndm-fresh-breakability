<#import "template.ftl" as layout>
    <#import "password-commons.ftl" as passwordCommons>
    <@layout.registrationLayout displayMessage=!messagesPerField.existsError('password', 'password-confirm' ); section>
        <#if section="header">
            <nav class="border-red-200 bg-red-50 dark:bg-red-800 dark:border-red-700">
                <div class="max-w-screen-xl navbarStyles flex flex-wrap items-center justify-between mx-auto p-4">
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
            <#elseif section="form">
                <div class="flex flex-col justify-center items-center gap-3 min-h-screen bg-gray-100 customBackgroundClassColor">
                    <div class="netappLogo"></div>
                    <div class="login-card text-center bg-white shadow-md rounded-lg p-8">
                        <div class="text-2xl mb-4">
                            ${msg("updatePasswordTitle")}
                        </div>
                        <div class="text-base-secondary text-sm leading-tight py-2 mb-4">
                            Please update your password to continue.
                        </div>
                        <form
                            id="kc-passwd-update-form"
                            action="${url.loginAction}"
                            method="post"
                            onsubmit="update.disabled = true; return true;">
                            <!-- New Password -->
                            <div class="w-full my-4 text-left inputClassDiv">
                                <label for="password-new" class="${properties.kcLabelClass!}">
                                    ${msg("passwordNew")}
                                </label>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <input
                                        type="password"
                                        id="password-new"
                                        name="password-new"
                                        class="${properties.kcInputClass!}"
                                        autofocus
                                        autocomplete="new-password"
                                        placeholder="Enter ${msg("passwordNew")}"
                                        aria-invalid="<#if messagesPerField.existsError('password')>true</#if>" />
                                </div>
                                <#if messagesPerField.existsError('password')>
                                    <span id="input-error-password" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                        ${kcSanitize(messagesPerField.get('password'))?no_esc}
                                    </span>
                                </#if>
                            </div>
                            <!-- Confirm Password -->
                            <div class="w-full my-4 text-left inputClassDiv">
                                <label for="password-confirm" class="${properties.kcLabelClass!}">
                                    ${msg("passwordConfirm")}
                                </label>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <input
                                        type="password"
                                        id="password-confirm"
                                        name="password-confirm"
                                        class="${properties.kcInputClass!}"
                                        autocomplete="new-password"
                                        placeholder="Confirm ${msg("password")}"
                                        aria-invalid="<#if messagesPerField.existsError('password-confirm')>true</#if>" />
                                </div>
                                <#if messagesPerField.existsError('password-confirm')>
                                    <span id="input-error-password-confirm" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                        ${kcSanitize(messagesPerField.get('password-confirm'))?no_esc}
                                    </span>
                                </#if>
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
                        </form>
                    </div>
                </div>
                <#elseif section="footer">
                    <!-- Optional footer section -->
        </#if>
    </@layout.registrationLayout>
    <script type="module" src="${url.resourcesPath}/js/passwordVisibility.js"></script>
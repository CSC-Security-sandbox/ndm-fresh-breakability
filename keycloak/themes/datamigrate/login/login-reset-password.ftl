<#import "template.ftl" as layout>
<@layout.registrationLayout displayInfo=true displayMessage=!messagesPerField.existsError('username'); section>
    <#if section = "form">
        <div class="min-h-full md:flex">
            <div class="md:w-8/12 flex items-center justify-center flex-col h-screen">
                <div class="w-9/12 xl:max-w-lg mx-4 p-8 gap-8 bg-white rounded-lg">
                    <div>Welcome to DoCUS</div>
                    <div class="text-4xl">Forgot your password?</div>
                    <div class="text-base-secondary text-sm leading-tight py-2">
                        <#if realm.duplicateEmailsAllowed>
                            ${msg("emailInstructionUsername")}
                        <#else>
                            ${msg("emailInstruction")}
                        </#if>
                    </div>
                    <div>
                        <form id="kc-reset-password-form" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post">
                            <#--  email/username  -->
                            <div class="w-full my-4">
                                <div class="${properties.kcLabelWrapperClass!}">
                                    <label for="username" class="${properties.kcLabelClass!} text-sm font-normal text-base-primary mb-1"><#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if></label>
                                </div>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <input type="text" id="username" name="username" class="${properties.kcInputClass!}" autofocus value="${(auth.attemptedUsername!'')}" aria-invalid="<#if messagesPerField.existsError('username')>true</#if>"/>
                                </div>
                            </div>
                            </div>

                            <#--  back to login  -->
                            <div>
                                <a class="text-primary-main cursor-pointer text-xs mt-3" tabindex="5" href="${url.loginUrl}">${kcSanitize(msg("backToLogin"))?no_esc}</a>
                            </div>

                            <#--  submit btn  -->
                            <div class="my-2 w-full">
                                <div id="kc-form-buttons" class="${properties.kcFormButtonsClass!}">
                                    <input class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}" type="submit" value="${msg("doSubmit")}"/>
                                </div>
                            </div>
                            
                            <#--  error message  -->
                            <#if messagesPerField.existsError('username')>
                                <span id="input-error-username" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                            ${kcSanitize(messagesPerField.get('username'))?no_esc}
                                </span>
                            </#if>
                        </form>
                </div>
            </div>
            <#--  Sidebar  -->
            <div class="md:w-4/12 relative flex flex-col justify-center items-center text-white p-4 bg-login-page-overview-bg">
                <div class="flex flex-col justify-center items-center gap-4">
                    <div class="text-center sidebar-text">
                        <h6 class="text-xl p-5">DoCUS</h6>
                        <div class="text-xs pl-10 pr-10 pb-10">
                            <p class="text-base">(c) Calfus, Inc. 2024</p>
                        </div>
                    </div>
                </div>
            </div>
    </#if>
</@layout.registrationLayout>
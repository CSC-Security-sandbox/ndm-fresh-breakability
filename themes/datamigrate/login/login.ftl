<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>
    
    <#if section = "form">
        <div class="flex justify-between">
            <#--  Sidebar  -->
            <div class="sidebar w-6/12 h-screen">
            </div>

            <div class="bg-white flex flex-grow items-center justify-center p-8">
                <div class="md:w-6/12">
                    <div class="text-4xl">Hi! Welcome to Datamigrate</div>
                    <div class="text-base-secondary text-sm leading-tight py-2">Build strong connections with customers to enhance brand loyalty and drive business growth.</div>
                    <div>
                        <form 
                            id="kc-form-login" 
                            onsubmit="login.disabled = true; return true;" 
                            action="${url.loginAction}" 
                            method="post"
                        >
                            <#--  username  -->
                            <div class="w-full my-4">
                                <div class="${properties.kcLabelWrapperClass!}">Username</div>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <#if !usernameHidden??>
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
                                            placeholder="Enter ${msg("username")}"
                                        />
                                    </#if>
                                </div>
                            </div>

                            <#--  password   -->
                            <div class="w-full my-4">
                                <div class="${properties.kcLabelWrapperClass!}">Password</div>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <input 
                                        tabindex="2" 
                                        id="password" 
                                        class="${properties.kcInputClass!}" 
                                        name="password" 
                                        type="password" 
                                        autocomplete="off"
                                        aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                                        placeholder="Enter ${msg("password")}"
                                    />
                                </div>
                            </div>

                            <#-- not being used at the moment, but leaving here in case we want to add in the future  -->
                            <#if realm.resetPasswordAllowed>
                                <div>
                                    <a class="text-primary-main cursor-pointer text-xs mt-3" tabindex="5" href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a>
                                </div>
                            </#if>

                            <#--  Submit button  -->
                            <div class="my-2 w-full">
                                <div id="kc-form-buttons" class="${properties.kcFormGroupClass!}">
                                    <input 
                                        type="hidden" 
                                        id="id-hidden-input" 
                                        name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>
                                    />
                                    <input 
                                        tabindex="4" 
                                        class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}" 
                                        name="login" 
                                        id="kc-login" 
                                        type="submit" 
                                        value="${msg("doLogIn")}"
                                    />
                                </div>
                            </div>

                            <#--  error message  -->
                            <#if messagesPerField.existsError('username','password')>
                                <span id="input-error" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                    ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
                                </span>
                            </#if>

                            
                        </form>
                    </div>
                </div>
            </div>
        </div>

        <script type="module" src="${url.resourcesPath}/js/passwordVisibility.js"></script>
    <#elseif section = "info" >
        <#--  not being used at the moment but leaving here in case we want to add in the future  -->
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <#--  <div id="kc-registration-container">
                <div id="kc-registration">
                    <span>${msg("noAccount")} <a tabindex="6" href="${url.registrationUrl}">${msg("doRegister")}</a></span>
                </div>
            </div>  -->
        </#if>
    </#if>
</@layout.registrationLayout>

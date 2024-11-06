<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','email','password','password-confirm','firstName','lastName') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>

    <#if section = "form">
        <div class="flex justify-between">
            
            <#--  Sidebar  -->
            <div class="sidebar w-6/12 h-screen">
            </div>

            <div class="bg-white flex flex-grow items-center justify-center p-8">
                <div class="md:w-6/12">
                    <div class="text-4xl">Welcome to DoCUS</div>
                    <div class="text-base-secondary text-sm leading-tight py-2">Create an account to build strong connections with customers and enhance brand loyalty.</div>
                    <div>
                        <form 
                            id="kc-form-register" 
                            onsubmit="register.disabled = true; return true;" 
                            action="${url.registrationAction}" 
                            method="post"
                        >
                            <#--  first name  -->
                            <div class="w-full my-4">
                                <div class="${properties.kcLabelWrapperClass!}">First Name</div>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <input 
                                        tabindex="1" 
                                        id="firstName" 
                                        class="${properties.kcInputClass!}" 
                                        name="firstName" 
                                        value="${(register.firstName!'')}"  
                                        type="text" 
                                        autofocus 
                                        autocomplete="off"
                                        aria-invalid="<#if messagesPerField.existsError('firstName')>true</#if>"
                                        placeholder="Enter ${msg("firstName")}"
                                    />
                                </div>
                            </div>

                            <#--  last name  -->
                            <div class="w-full my-4">
                                <div class="${properties.kcLabelWrapperClass!}">Last Name</div>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <input 
                                        tabindex="2" 
                                        id="lastName" 
                                        class="${properties.kcInputClass!}" 
                                        name="lastName" 
                                        value="${(register.lastName!'')}"  
                                        type="text" 
                                        autocomplete="off"
                                        aria-invalid="<#if messagesPerField.existsError('lastName')>true</#if>"
                                        placeholder="Enter ${msg("lastName")}"
                                    />
                                </div>
                            </div>

                            <#--  username  -->
                            <div class="w-full my-4">
                                <div class="${properties.kcLabelWrapperClass!}">Username</div>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <input 
                                        tabindex="3" 
                                        id="username" 
                                        class="${properties.kcInputClass!}" 
                                        name="username" 
                                        value="${(register.username!'')}"  
                                        type="text" 
                                        autocomplete="off"
                                        aria-invalid="<#if messagesPerField.existsError('username')>true</#if>"
                                        placeholder="Enter ${msg("username")}"
                                    />
                                </div>
                            </div>

                            <#--  email  -->
                            <div class="w-full my-4">
                                <div class="${properties.kcLabelWrapperClass!}">Email</div>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <input 
                                        tabindex="4" 
                                        id="email" 
                                        class="${properties.kcInputClass!}" 
                                        name="email" 
                                        value="${(register.email!'')}"  
                                        type="email" 
                                        autocomplete="off"
                                        aria-invalid="<#if messagesPerField.existsError('email')>true</#if>"
                                        placeholder="Enter ${msg("email")}"
                                    />
                                </div>
                            </div>

                            <#--  password  -->
                            <div class="w-full my-4">
                                <div class="${properties.kcLabelWrapperClass!}">Password</div>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <input 
                                        tabindex="5" 
                                        id="password" 
                                        class="${properties.kcInputClass!}" 
                                        name="password" 
                                        type="password" 
                                        autocomplete="off"
                                        aria-invalid="<#if messagesPerField.existsError('password')>true</#if>"
                                        placeholder="Enter ${msg("password")}"
                                    />
                                </div>
                            </div>

                            <#--  password confirmation  -->
                            <div class="w-full my-4">
                                <div class="${properties.kcLabelWrapperClass!}">Confirm Password</div>
                                <div class="${properties.kcInputWrapperClass!}">
                                    <input 
                                        tabindex="6" 
                                        id="password-confirm" 
                                        class="${properties.kcInputClass!}" 
                                        name="password-confirm" 
                                        type="password" 
                                        autocomplete="off"
                                        aria-invalid="<#if messagesPerField.existsError('password-confirm')>true</#if>"
                                        placeholder="Confirm ${msg("password")}"
                                    />
                                </div>
                            </div>

                            <#--  Submit button  -->
                            <div class="my-2 w-full">
                                <div id="kc-form-buttons" class="${properties.kcFormGroupClass!}">
                                    <input 
                                        tabindex="7" 
                                        class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}" 
                                        name="register" 
                                        id="kc-register" 
                                        type="submit" 
                                        value="${msg("doRegister")}"
                                    />
                                </div>
                            </div>

                            <#--  error message  -->
                            <#if messagesPerField.existsError('username','email','password','password-confirm','firstName','lastName')>
                                <span id="input-error" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                                    ${kcSanitize(messagesPerField.getFirstError('username','email','password','password-confirm','firstName','lastName'))?no_esc}
                                </span>
                            </#if>
                        </form>
                    </div>
                </div>
            </div>
        </div>

        <script type="module" src="${url.resourcesPath}/js/passwordVisibility.js"></script>
    <#elseif section = "info">
        <#--  not being used at the moment but leaving here in case we want to add in the future  -->
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <#--  <div id="kc-registration-container">
                <div id="kc-registration">
                    <span>${msg("noAccount")} <a tabindex="8" href="${url.registrationUrl}">${msg("doRegister")}</a></span>
                </div>
            </div>  -->
        </#if>
    </#if>

</@layout.registrationLayout>
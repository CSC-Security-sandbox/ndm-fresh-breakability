<#import "template.ftl" as layout>

<@layout.registrationLayout section="section">
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
</@layout.registrationLayout>

<#if section == "form">
    <div class="flex flex-col justify-center items-center gap-3 min-h-screen bg-gray-100 customBackgroundClassColor">
        <div class="netappLogo"></div>
        <div class="login-card text-center bg-white shadow-md rounded-lg p-8">
            <div class="text-2xl mb-4">
                ${msg("updateProfileTitle")}
            </div>
            <div class="text-base-secondary text-sm leading-tight py-2 mb-4">
                Please update your profile information.
            </div>

            <form id="kc-profile-update-form" action="${url.updateProfileAction}" method="post">
                <!-- First Name -->
                <div class="w-full my-4 text-left inputClassDiv">
                    <label for="first-name" class="${properties.kcLabelClass!}">
                        First Name
                    </label>
                    <div class="${properties.kcInputWrapperClass!}">
                        <input
                            type="text"
                            id="first-name"
                            name="first-name"
                            class="${properties.kcInputClass!}"
                            value="${user.firstName!''}"
                            placeholder="Enter your First Name"
                            aria-invalid="<#if messagesPerField.existsError('first-name')>true</#if>"
                        />
                    </div>
                    <#if messagesPerField.existsError('first-name')>
                        <span id="input-error-first-name" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                            ${kcSanitize(messagesPerField.get('first-name'))?no_esc}
                        </span>
                    </#if>
                </div>

                <!-- Last Name -->
                <div class="w-full my-4 text-left inputClassDiv">
                    <label for="last-name" class="${properties.kcLabelClass!}">
                        Last Name
                    </label>
                    <div class="${properties.kcInputWrapperClass!}">
                        <input
                            type="text"
                            id="last-name"
                            name="last-name"
                            class="${properties.kcInputClass!}"
                            value="${user.lastName!''}"
                            placeholder="Enter your Last Name"
                            aria-invalid="<#if messagesPerField.existsError('last-name')>true</#if>"
                        />
                    </div>
                    <#if messagesPerField.existsError('last-name')>
                        <span id="input-error-last-name" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                            ${kcSanitize(messagesPerField.get('last-name'))?no_esc}
                        </span>
                    </#if>
                </div>

                <!-- Email -->
                <div class="w-full my-4 text-left inputClassDiv">
                    <label for="email" class="${properties.kcLabelClass!}">
                        Email
                    </label>
                    <div class="${properties.kcInputWrapperClass!}">
                        <input
                            type="email"
                            id="email"
                            name="email"
                            class="${properties.kcInputClass!}"
                            value="${user.email!''}"
                            placeholder="Enter your Email"
                            aria-invalid="<#if messagesPerField.existsError('email')>true</#if>"
                        />
                    </div>
                    <#if messagesPerField.existsError('email')>
                        <span id="input-error-email" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
                            ${kcSanitize(messagesPerField.get('email'))?no_esc}
                        </span>
                    </#if>
                </div>

                <!-- Submit Button -->
                <div class="my-2 w-full">
                    <button
                        id="kc-update-profile"
                        type="submit"
                        class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!} ${properties.kcButtonLargeClass!}">
                        ${msg("doSubmit")}
                    </button>
                </div>
            </form>
        </div>
    </div>
</#if>

<#if section == "footer">
    <!-- Optional Footer Section -->
</#if>
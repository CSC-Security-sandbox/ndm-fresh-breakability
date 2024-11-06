<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
    <#elseif section = "form">
        <div class="min-h-full">
            <div class="flex items-center justify-center flex-col h-screen">
                <div class="xl:max-w-lg mx-4 p-8 gap-8 bg-white rounded-lg">
                    ${kcSanitize(msg("errorTitle"))?no_esc}
                    <div id="kc-error-message">
                        <p class="instruction">${kcSanitize(message.summary)?no_esc}</p>
                        <#if skipLink??>
                        <#else>
                            <#if client?? && client.baseUrl?has_content>
                                <p><a id="backToApplication" href="${client.baseUrl}">${kcSanitize(msg("backToApplication"))?no_esc}</a></p>
                            </#if>
                        </#if>
                    </div>
                </div>
            </div>
        </div>
        
    </#if>
</@layout.registrationLayout>
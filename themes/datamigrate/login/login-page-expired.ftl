<#import "template.ftl" as layout>
<@layout.registrationLayout; section>
    <#if section = "form">
        <div class="min-h-full">
            <div class="flex items-center justify-center flex-col h-screen">
                <div class="xl:max-w-lg mx-4 p-8 gap-8 bg-white rounded-lg">
                    <div>${msg("pageExpiredTitle")}</div>
                    <p id="instruction1" class="instruction">
                        ${msg("pageExpiredMsg1")} <a id="loginRestartLink" href="${url.loginRestartFlowUrl}">${msg("doClickHere")}</a> .<br/>
                        ${msg("pageExpiredMsg2")} <a id="loginContinueLink" href="${url.loginAction}">${msg("doClickHere")}</a> .
                    </p>
                </div>
            </div>
        </div>
    </#if>
</@layout.registrationLayout>
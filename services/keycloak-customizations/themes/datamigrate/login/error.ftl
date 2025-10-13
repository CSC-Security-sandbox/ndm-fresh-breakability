<head>
    <link href="${url.resourcesPath}/css/vendor/font-awesome.min.css" rel="stylesheet">
    <link href="${url.resourcesPath}/css/vendor/tailwind.min.css" rel="stylesheet">
    <style>
        .customBackgroundClassColor {
            background-color: #f3f4f6;
        }
        .login-card {
            max-width: 500px;
            width: 90%;
        }
        .back-btn {
            transition: all 0.3s ease;
        }
        .back-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
        }
        .main-content {
            min-height: calc(100vh - 80px);
        }
    </style>
</head>

<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        <nav style="background-color: #3B82F6; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); width: 100%; position: fixed; top: 0; z-index: 1000;">
            <div class="navbarStyles" style="display: flex; align-items: center; justify-content: space-between; margin: 0 auto; padding: 1rem;">
                <a href="#" style="display: flex; align-items: center; text-decoration: none;">
                    <div style="display: flex; align-items: center;">
                        <div class="netappNavBarLogo"></div>
                        <span style="font-size: 1.5rem; font-weight: 600; color: white;">NetApp Data Migrator</span>
                    </div>
                </a>
            </div>
        </nav>
    <#elseif section = "form">
        <div class="customBackgroundClassColor" style="min-height: 100vh; padding-top: 80px;">
            <div class="main-content" style="display: flex; flex-direction: column; justify-content: center; align-items: center;">
                <div class="login-card" style="text-align: center; background-color: white; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border-radius: 0.5rem; padding: 2rem;">
                    <div style="margin-bottom: 1rem;">
                        <i class="fas fa-exclamation-triangle" style="color: #EF4444; font-size: 2.5rem;"></i>
                    </div>
                    
                    <div style="font-size: 1.5rem; margin-bottom: 1.5rem; color: #DC2626; font-weight: 600;">
                        <#if message??>
                            We are sorry...
                        <#else>
                            Error
                        </#if>
                    </div>
                    
                    <div id="kc-error-message" style="margin-bottom: 2rem;">
                        <div style="color: #EF4444; font-size: 0.875rem; margin-bottom: 1rem; padding: 1rem; background-color: #FEF2F2; border-radius: 0.375rem; border: 1px solid #FECACA;">
                            <p class="instruction" style="font-weight: 500; margin: 0;">
                                <#if message??>
                                    ${kcSanitize(message.summary)?no_esc}
                                <#else>
                                    An error occurred. Please try again.
                                </#if>
                            </p>
                        </div>
                        
                        <div style="width: 100%; margin-top: 1rem;">
                            <#if client?? && client.baseUrl?has_content>
                                <#assign redirectUrl = client.baseUrl + "/login">
                            <#elseif client?? && client.rootUrl?has_content>
                                <#assign redirectUrl = client.rootUrl + "/login">
                            <#else>
                                <#assign redirectUrl = "/auth/realms/" + realm.name + "/protocol/openid-connect/auth">
                            </#if>
                            
                            <a id="backToApplication" 
                               href="${redirectUrl}"
                               class="back-btn"
                               style="display: inline-block; text-align: center; color: white; background-color: #2563EB; padding: 0.625rem 1.25rem; font-weight: 500; border-radius: 0.5rem; font-size: 0.875rem; text-decoration: none; width: 100%; box-sizing: border-box;">
                                <#if msg??>
                                    ${kcSanitize(msg("backToApplication"))?no_esc}
                                <#else>
                                    Back to Application
                                </#if>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </#if>
</@layout.registrationLayout>
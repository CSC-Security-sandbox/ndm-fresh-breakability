package tests_test

import (
    "testing"
    // . "ndm-api-tests/tests/smoke/scenerios-go"
    . "ndm-api-tests/utils"

    . "github.com/onsi/ginkgo/v2"
    . "github.com/onsi/gomega"
)

var _ = BeforeSuite(func() {
    By("Setting before the suite")
    InitTestEnv()

    // KeycloakUser ="kcadmin"
    // KeycloakPassword ="1LKWYGI0OFwPx6MyMpiX"
    // CLIENT_SECRET ="04b4sbiOBPDJzLbZyDn4QVlBQzMqqS3K"
    // // Try to get bearer token directly
    // authToken, refreshToken, err := GetBearerToken("", "")
    // if err != nil {
    //     // If direct token fails, try with the admin@admin.com user
    //     authToken, refreshToken, err = GetBearerToken("admin@datamigrator.local", "Welcome@1234")
    //     if err != nil {
    //         Fail("Failed to get authentication token: " + err.Error())
    //     }
    // }
 
    // AuthToken = authToken
    // RefreshToken = refreshToken
 
    // // Get real role IDs from the system
    // appAdminId, projectAdminId, projectViewerId, roleErr := GetRoleId(AuthToken)
    // if roleErr != nil {
    //     Fail("Failed to get role IDs: " + roleErr.Error())
    // }
 
    // AppAdminId = appAdminId
    // ProjectAdminId = projectAdminId
    // ProjectViewerId = projectViewerId
 
    // // Set default account ID
    // AccountId = DEFAULT_ACCOUNT_ID
})


func TestSceneriosGo(t *testing.T) {
    RegisterFailHandler(Fail)
    RunSpecs(t, "SceneriosGo Suite")
}


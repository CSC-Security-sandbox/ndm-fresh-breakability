package tests
import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Project Viewer Discovery Migration Cutover Test", func() {
    var (
        projectId             string
        headers               map[string]string
        userIDs               []interface{}
        usernames             []string
        userRoleIDs           []string
        password               string
        keycloakAuthToken      string
        userKeycloakID         string
        authToken              string
        refreshToken           string
        resp                   *http.Response
    )

    BeforeEach(func() {
		headers = GetHeaders(AuthToken, ContentTypeJSON)
        ProjectID, err := CreateProject(AuthToken, AccountId)
		Expect(err).To(BeNil(), "Error creating project")
        projectId = ProjectID
	})

    AfterEach(func() {
        // Cleanup user roles
        var roleIDs []string
        for _, roleID := range userRoleIDs {
            if roleID != "" {
                roleIDs = append(roleIDs, roleID)
            }
        }
        if len(roleIDs) > 0 {
            DeleteUserRolesByIDs(roleIDs)
        }
        
        // Cleanup users
        for _, userID := range userIDs {
            if userID != nil {
                DeleteUserByID(userID.(string))
            }
        }
        
        // Cleanup Keycloak users
        for _, username := range usernames {
            if username != "" {
                DeleteKeycloakUser(username)
            }
        }

    })

	It("Should complete the full discovery migration cutover workflow", func() {
        By("########################## Project Viewer E2E Tests Begins ################################")

        By("Creating a new user")
        usernames = make([]string, 1)
        userIDs = make([]interface{}, 1)
        userRoleIDs = make([]string, 1)

        usernames[0] = fmt.Sprintf("testprojectviewer-%d-%d@email.com", GinkgoRandomSeed(), time.Now().UnixNano())
        responseData, err := CreateNewUser(usernames[0], "test1", "user1", headers)
        Expect(err).To(BeNil())
        userIDs[0] = responseData["id"]
        Expect(responseData["first_name"]).To(Equal("test1"))
        Expect(userIDs[0]).ToNot(BeNil())

        

        By("Assigning project viewer role to user")
        roleData, err := CreateUserRole(projectId, AccountId, userIDs[0].(string), ProjectViewerId, headers)
        Expect(err).To(BeNil())
        userRoleIDs[0] = fmt.Sprintf("%v", roleData["id"])
        Expect(userRoleIDs[0]).ToNot(BeEmpty())

        

        By("Resetting user password in Keycloak")
        password = "Root@123"
        keycloakAuthToken, err = GetKeyCloakAccessToken(KeycloakUser, KeycloakPassword)
        Expect(err).To(BeNil())
        userKeycloakID, err = FetchUserID(usernames[0], keycloakAuthToken)
        Expect(err).To(BeNil())
        err = ResetUserPassword(userKeycloakID, keycloakAuthToken, password)
        password = PASSWORD
        Expect(err).To(BeNil())

        By("Logging in with project admin credentials")
        authToken, refreshToken, err = GetBearerToken(usernames[0], password)
        Expect(err).To(BeNil())
        Expect(authToken).ToNot(BeEmpty())
        Expect(refreshToken).ToNot(BeEmpty())
        headers = GetHeaders(authToken, ContentTypeJSON)

		By("Creating the source file server")
        sourceParams := CreateServereParams{
            ConfigName:       "Project_viewer_config_source",
            ConfigType:       ConfigTypeFile,
            ProjectID:        projectId,
            ServerType:       ServerTypeOtherNAS,
            UserName:         PROTOCOL_USERNAME,
            Password:         PROTOCOL_PASSWORD,
            Protocol:         PROTOCOL_TYPE,
            ProtocolVersion:  ProtocolVersion3,
            Host:             SOURCE_HOST_IPs[0],
            Workers:          []string{},
            WorkingDirectory: "",
        }
        
        _, resp, err = CreateFileServer(sourceParams, headers)
        Expect(resp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 Forbidden")
        defer resp.Body.Close()

		By("Creating and running discovery job for source")
        jobParams := DiscoveryJobParams{
            SourcePathIDs:            []string{},
            ExcludeOlderThan:         nil,
            ExcludeFilePatterns:      "",
            PreserveAccessTime:       false,
            FirstRunAt:               GetCurrentUTCTimestamp(),
            CreatedBy:                nil,
            WorkflowExecutionTimeout: "60s",
            WorkflowTaskTimeout:      "30s",
            WorkflowRunTimeout:       "30s",
            StartDelay:               "10s",
        }
        
        _, resp, _ := CreateDiscoveryJob(jobParams, headers)
        Expect(resp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 Forbidden")
        defer resp.Body.Close()

		By("Creating and running migration job")
        migrationParams := MigrationJobParams{
            FirstRunAt:         GetCurrentUTCTimestamp(),
            FutureRunSchedule:  "",
            SourcePathIDs:      []string{},
            DestinationPathIDs: []string{},
            SidMapping:         false,
            Options: map[string]interface{}{
                "excludeFilePatterns": "*/snapshots/*, */logs/*, */tmp/*",
                "preserveAccessTime":  true,
                "skipFile":            "15-M",
            },
        }

        _, resp, _  = CreateMigrationJob(migrationParams, headers)
		Expect(resp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 Forbidden")
        defer resp.Body.Close()

		By("Creating first bulk cutover job")
        cutoverParams := BulkCutoverJobParams{
            SourcePathIDs:      []string{},
            DestinationPathIDs: []string{},
        }

        _ , resp, _ = CreateBulkCutoverJob(cutoverParams, headers)
		Expect(resp.StatusCode).To(Equal(http.StatusForbidden), "Expected HTTP 403 Forbidden")

        defer resp.Body.Close()
	})
})
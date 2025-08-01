package tests

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	. "ndm-api-tests/utils"
	"net/http"
	"strings"
	"time"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)


func sendPostAPIRequest(url string, data map[string]string, authToken string) (map[string]interface{}, error) {
	reqBody, err := json.Marshal(data)
	if err != nil {
		log.Printf("Error marshaling JSON: %v", err)
		return nil, err
	}
	headers := GetHeaders(authToken, ContentTypeJSON)
	resp, err := SendAPIRequest("POST", url, reqBody, headers)
	if err != nil {
		log.Printf("Error sending API request: %v", err)
		return nil, err
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Error reading response body: %v", err)
		return nil, err
	}

	var jsonResponse map[string]interface{}
	if err = json.Unmarshal(respBody, &jsonResponse); err != nil {
		log.Printf("Error parsing JSON response: %v", err)
		return nil, err
	}
	return jsonResponse, nil
}

func createProject(authToken string, accountId string) (string, error) {
	fullURL := ADMIN_SERVICE_URL + "/api/v1/projects"
	data := map[string]string{
		"account_id":          accountId,
		"project_name":        AutoGenerateProjectName("test"),
		"project_description": "Project For Automation testing",
		"start_date":          time.Now().UTC().Format(time.RFC3339),
	}

	jsonResponse, err := sendPostAPIRequest(fullURL, data, authToken)
	if err != nil {
		log.Printf("error while sending API request: %v", err)
		return "", err
	}

	dataMap, ok := jsonResponse["data"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("data not found in response in createProject")
	}
	projectID, ok := dataMap["id"].(string)
	if !ok {
		return "", fmt.Errorf("id not found in response in createProject")
	}

	ProjectID = projectID

	return ProjectID, nil
}

var _ = Describe("App Admin Source File Server Test", Ordered, func() {

    var (
        headers                    map[string]string 
        projectId                 string            
        workerId                   string            
        sourceHostIP               string            
        configID                   string           
        jobConfigID                string            
        sourceConfigId             string
        destinationConfigId       string           
        destinationPathId    string
        discoveryJobConfigId      string
        discoveryJobRunId         string     
        // destinationVolumePath1 string
        // sourceVolumePath1          string               
    )

    BeforeAll(func() {
        fmt.Println("Initializing App Admin Source File Server Test environment.")

		projectID, err := createProject(AuthToken, AccountId)
		if err != nil {
			Fail(fmt.Sprintf("Failed to create project: %v", err))
		}
		fmt.Printf("Project created with ID: %s\n", projectID)
        projectId = projectID 

		workersURL := fmt.Sprintf("%s/api/v1/workers", JOB_SERVICE_URL)
		workersHeaders := GetHeaders(AuthToken, ContentTypeJSON)
		workersResp, err := SendAPIRequest("GET", workersURL, nil, workersHeaders)
		
		if err != nil {
        fmt.Printf("DEBUG: Error getting workers: %v\n", err)
        workerId = "fallback-worker-id" 
    } else {
        defer workersResp.Body.Close()
        if workersResp.StatusCode == 200 {
            bodyBytes, _ := io.ReadAll(workersResp.Body)
            var workersResponse map[string]interface{}
            json.Unmarshal(bodyBytes, &workersResponse)
            
            fmt.Printf("DEBUG: Workers API response: %s\n", string(bodyBytes))
            
            if data, ok := workersResponse["data"].([]interface{}); ok && len(data) > 0 {
                if firstWorker, ok := data[0].(map[string]interface{}); ok {
                    if id, ok := firstWorker["workerId"].(string); ok {
                        workerId = id
                        fmt.Printf("DEBUG: Found worker ID: %s\n", workerId)
                    } else if id, ok := firstWorker["id"].(string); ok {
                        workerId = id
                        fmt.Printf("DEBUG: Found worker ID (as 'id'): %s\n", workerId)
                    }
                }
            }
            
            if workerId == "" {
                workerId = "fallback-worker-id"
                fmt.Printf("DEBUG: No worker ID found in response, using fallback\n")
            }
        } else {
            fmt.Printf("DEBUG: Workers API returned status: %d\n", workersResp.StatusCode)
            workerId = "fallback-worker-id"
        }
    }
    
		
		sourceHostIP = SOURCE_HOST_IP 

		fmt.Printf("DEBUG: Using project_id: %s\n", projectId)
		fmt.Printf("DEBUG: Using workerId: %s\n", workerId)
		fmt.Printf("DEBUG: Using sourceHostIP: %s\n", sourceHostIP)
		
		Expect(projectId).NotTo(BeEmpty(), "Project ID should not be empty")
		Expect(sourceHostIP).NotTo(BeEmpty(), "Source Host IP should not be empty")

		fmt.Printf("Test environment initialized - ProjectID: %s, WorkerID: %s, SourceHost: %s\n",
			projectId, workerId, sourceHostIP)

        // destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, NFS_DESTINATION_VOLUME)

        // sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IP, NFS_SOURCE_VOLUME)

    })

    BeforeEach(func() {
        headers = GetHeaders(AuthToken, ContentTypeJSON)
        fmt.Println("Headers initialized for test execution.")
    })

    It("should complete the source file server management workflow", func() {
        By("########################## TC-001 Creating the source file server ################################")
            
        sourceParams := CreateServereParams{
            ConfigName:       "Project_admin_config_source",
            ConfigType:       ConfigTypeFile,
            ProjectID:        projectId,
            ServerType:       ServerTypeOtherNAS,
            UserName:         "Root",
            Password:         "",
            Protocol:         ProtocolNFS,
            ProtocolVersion:  ProtocolVersion3,
            Host:             SOURCE_HOST_IP,
            Workers:          []string{workerId},
            WorkingDirectory: "",
        }
        
        var err error
        var resp *http.Response
        sourceConfigId, resp, err = CreateFileServer(sourceParams, headers)
        fmt.Println("DEBUG: Source file server creation response:", resp)
        fmt.Println("DEBUG: Source file server config ID:", sourceConfigId)
        Expect(err).NotTo(HaveOccurred(), "Error creating source file server")
        Expect(sourceConfigId).NotTo(BeEmpty(), "Source config ID should not be empty")
        Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
        defer resp.Body.Close()
        By(fmt.Sprintf("Source file server created with config ID: %#v", resp))


        Wait(60)
        By("########################## TC-002 Retrieving file server information by ID ################################")

        sourcePathId, err := GetExportPathID("source", NFS_SOURCE_VOLUME, sourceConfigId, headers)
        Expect(err).NotTo(HaveOccurred(), "Error getting source export path ID")
        Expect(sourcePathId).NotTo(BeEmpty(), "Source path ID should not be empty")

        Wait(5) 

        By("########################## TC-003 Creating a new discovery job for the source server ################################")

        jobParams := DiscoveryJobParams{
                SourcePathIDs:            []string{sourcePathId},
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
            
        discoveryJobConfigIds, resp, err := CreateDiscoveryJob(jobParams, headers)
        Expect(err).NotTo(HaveOccurred(), "Error creating discovery job")
        Expect(len(discoveryJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one job config ID")
        Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
        defer resp.Body.Close()
        
        discoveryJobConfigId = discoveryJobConfigIds[0]
        fmt.Println("DEBUG: Discovery job config ID:", discoveryJobConfigId)
        fmt.Println(projectId)
        

        By("########################## TC-004 Monitoring job execution by retrieving job status ################################")
        
        
        jobConfigDetails, resp, err := GetJobRunDetails(discoveryJobConfigId, headers, false)
        Expect(err).NotTo(HaveOccurred(), "Error getting job run details")
        Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
        defer resp.Body.Close()
        
        Expect(jobConfigDetails.JobRuns).NotTo(BeEmpty(), "Job runs should not be empty")
        discoveryJobRunId = jobConfigDetails.JobRuns[0].JobRunId
        Expect(discoveryJobRunId).NotTo(BeEmpty(), "Discovery job run ID should not be empty")

        fmt.Println("DEBUG: Discovery job run ID:", discoveryJobRunId)

        err = WaitForJobState(discoveryJobRunId, COMPLETED_JOBRUN)
        Expect(err).NotTo(HaveOccurred(), "Discovery job should complete successfully")

        Wait(30)

        By("########################## TC-005 Creating the destination file server ################################")
        destinationParams := CreateServereParams{
            ConfigName:       "Project_admin_config_destination",
            ConfigType:       ConfigTypeFile,
            ServerType:       ServerTypeOtherNAS,
            ProjectID:        projectId,
            UserName:         "Root",
            Password:         "",
            Protocol:         ProtocolNFS,
            ProtocolVersion:  ProtocolVersion3,
            Host:             DESTINATION_HOST_IP,
            Workers:          []string{workerId},
            WorkingDirectory: "",
        }
            
        destinationConfigId, resp, err = CreateFileServer(destinationParams, headers)
        Expect(err).NotTo(HaveOccurred(), "Error creating destination file server")
        Expect(destinationConfigId).NotTo(BeEmpty(), "Destination config ID should not be empty")
        Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
        defer resp.Body.Close()
        
        Wait(60) 

        By("########################## TC-006 Getting destination file server details ################################")
        destinationPathId, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME, destinationConfigId, headers)
        Expect(err).NotTo(HaveOccurred(), "Error getting destination export path ID")
        Expect(destinationPathId).NotTo(BeEmpty(), "Destination path ID should not be empty")

        Wait(5)

        By("########################## TC-007 Creating a new discovery job for the destination server ################################")
        destJobParams := DiscoveryJobParams{
            SourcePathIDs:            []string{destinationPathId},
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

        destinationDiscoveryJobConfigIds, resp, err := CreateDiscoveryJob(destJobParams, headers)
        Expect(err).NotTo(HaveOccurred(), "Error creating discovery job")
        Expect(len(destinationDiscoveryJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one job config ID")
        Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
        defer resp.Body.Close()

        destDiscoveryJobConfigId := destinationDiscoveryJobConfigIds[0]
        fmt.Println("DEBUG: Discovery job config ID:", destDiscoveryJobConfigId)
        fmt.Println(projectId)
               
        By("########################## TC-008 Monitoring destination discovery job execution ################################")
        
        destJobConfigDetails, resp, err := GetJobRunDetails(destDiscoveryJobConfigId, headers)
        Expect(err).NotTo(HaveOccurred(), "Error getting job run details")
        Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
        defer resp.Body.Close()

        Expect(destJobConfigDetails.JobRuns).NotTo(BeEmpty(), "Job runs should not be empty")
        destDiscoveryJobRunId := destJobConfigDetails.JobRuns[0].JobRunId
        Expect(destDiscoveryJobRunId).NotTo(BeEmpty(), "Discovery job run ID should not be empty")

        fmt.Println("DEBUG: Discovery job run ID:", destDiscoveryJobRunId)

        Wait(30)


        By("########################## TC-009 Creating and running migration job ################################")
        migrationParams := MigrationJobParams{
            FirstRunAt:         GetCurrentUTCTimestamp(),
            FutureRunSchedule:  "", 
            SourcePathIDs:      []string{sourcePathId},
            DestinationPathIDs: []string{destinationPathId},
            SidMapping:         false,
            Options: map[string]interface{}{
                "excludeFilePatterns": "*/snapshots/*, */logs/*, */tmp/*",
                "preserveAccessTime":  true,
                "skipFile":            "15-M",
            },
        }
        
        
        fmt.Printf("DEBUG: Migration params: %+v\n", migrationParams)
        fmt.Printf("DEBUG: Source Path ID: %s\n", sourcePathId)
        fmt.Printf("DEBUG: Destination Path ID: %s\n", destinationPathId)

        migrationJobConfigIds, resp, err := CreateMigrationJob(migrationParams, headers)

        if resp != nil && resp.StatusCode != http.StatusCreated {
            bodyBytes, _ := io.ReadAll(resp.Body)
            fmt.Printf("DEBUG: Migration job creation failed. Status: %d, Response: %s\n", resp.StatusCode, string(bodyBytes))
            resp.Body.Close()
            resp.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))
        }

        Expect(err).NotTo(HaveOccurred(), "Error creating migration job")
        Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
        defer resp.Body.Close()
        
        Expect(len(migrationJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one migration job config ID")
        Wait(150) 


        By("########################## TC-010 Creating first bulk cutover job ################################")
        cutoverParams := BulkCutoverJobParams{
            SourcePathIDs:      []string{sourcePathId},
            DestinationPathIDs: []string{destinationPathId},
        }
        
        cutoverJobConfigIds, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
        Expect(err).NotTo(HaveOccurred(), "Error creating bulk cutover job")
        Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
        defer resp.Body.Close()
        
        Expect(len(cutoverJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one cutover job config ID")
        Wait(120) 
    })

    AfterAll(func() {

        if jobConfigID != "" {
            deleteJobURL := fmt.Sprintf("%s/api/v1/jobs/%s", JOB_SERVICE_URL, jobConfigID)
            resp, err := SendAPIRequest("DELETE", deleteJobURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up discovery job: %s\n", jobConfigID)
        }

        if configID != "" {
            deleteServerURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, configID)
            resp, err := SendAPIRequest("DELETE", deleteServerURL, nil, headers)
            if err == nil {
                resp.Body.Close()
            }
            fmt.Printf("Cleaned up file server configuration: %s\n", configID)
        }

        // err := RemoveDeltaFromVolume(sourceVolumePath1)
        // Expect(err).NotTo(HaveOccurred(), "Error restoring original data to %s", sourceVolumePath1)
        // fmt.Println("Restored original data to source volume:", sourceVolumePath1)

        // err = ClearVolume(destinationVolumePath1)
        // Expect(err).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath1)
        // fmt.Println("Cleared volume of destination:", destinationVolumePath1)

        // fmt.Println("All source file server test cleanup operations completed.")
    })
})
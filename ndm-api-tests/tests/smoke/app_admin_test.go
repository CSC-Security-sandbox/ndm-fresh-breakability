package tests

import (
	"encoding/json"
	"fmt"
	"io"
	. "ndm-api-tests/utils"
	"net/http"
	"strings"
	
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)


var _ = Describe("App Admin Source File Server Test", Ordered, func() {

    var (
        headers                    map[string]string 
        projectId                 string            
        workerId                   string            
        sourceHostIP               string                    
        sourceConfigId             string
        destinationConfigId       string           
        destinationPathId    string
        discoveryJobConfigId      string
        discoveryJobRunId         string     
        // destinationVolumePath1    string
        // sourceVolumePath1         string               
    )

    BeforeAll(func() {
        fmt.Println("Initializing App Admin Source File Server Test environment.")

		projectID, err := CreateProject(AuthToken, AccountId)
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
            bodyBytes, err := io.ReadAll(workersResp.Body)
			if err != nil {
				fmt.Printf("DEBUG: Error reading workers response body: %v\n", err)
				workerId = "fallback-worker-id"
			}
			
            var workersResponse map[string]interface{}
            err = json.Unmarshal(bodyBytes, &workersResponse)
            if err != nil {
                fmt.Printf("DEBUG: Error unmarshalling workers response: %v\n", err)
                workerId = "fallback-worker-id"
            }

            fmt.Printf("DEBUG: Workers API response: %s\n", string(bodyBytes))
            
            if data, ok := workersResponse["data"].([]interface{}); ok && len(data) > 0 {
				if firstWorker, ok := data[0].(map[string]interface{}); ok {
					if id, ok := firstWorker["workerId"].(string); ok && id != "" {
						workerId = id
						fmt.Printf("DEBUG: Found worker ID: %s\n", workerId)
					} else if id, ok := firstWorker["id"].(string); ok && id != "" {
						workerId = id
						fmt.Printf("DEBUG: Found worker ID (as 'id'): %s\n", workerId)
					} else {
						fmt.Printf("DEBUG: Worker ID fields are empty or invalid\n")
						workerId = "fallback-worker-id"
					}
				} else {
					fmt.Printf("DEBUG: First worker data is not a valid map\n")
					workerId = "fallback-worker-id"
				}
			} else {
				fmt.Printf("DEBUG: No workers data found or data is not an array\n")
				workerId = "fallback-worker-id"
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
		By("########################## App Admin Test Begins ################################")

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
        
		Wait(30)
        
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

		Wait(30)
        
        destJobConfigDetails, resp, err := GetJobRunDetails(destDiscoveryJobConfigId, headers, false)
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

		

        // err := RemoveDeltaFromVolume(sourceVolumePath1)
        // Expect(err).NotTo(HaveOccurred(), "Error restoring original data to %s", sourceVolumePath1)
        // fmt.Println("Restored original data to source volume:", sourceVolumePath1)

        // err = ClearVolume(destinationVolumePath1)
        // Expect(err).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath1)
        // fmt.Println("Cleared volume of destination:", destinationVolumePath1)

        fmt.Println("All source file server test cleanup operations completed.")
    })
})
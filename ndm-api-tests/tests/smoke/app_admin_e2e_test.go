package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("App Admin Source File Server Test", Ordered, func() {

    var (
        headers                    map[string]string 
        projectId                 string            
        workerId                   string            
        sourceConfigId             string
        destinationConfigId       string           
        destinationPathId    string
        discoveryJobConfigId      string
        discoveryJobRunId         string     
        destinationVolumePath1    string
        sourceVolumePath1         string               
    )
    
    BeforeEach(func() {
        headers = GetHeaders(AuthToken, ContentTypeJSON)
        fmt.Println("Headers initialized for test execution.")
        numberOfWorker := 1
        ProjectID, attachedWorkersConfig, err := SetupTestEnv(numberOfWorker)
        Expect(err).To(BeNil(), "Error during test environment setup")
        Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 1), "Expected 1 worker to be attached")
        workerIds := GetWorkerIds()
        workerId = workerIds[0]
        projectId = ProjectID
        destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IP, NFS_DESTINATION_VOLUME)
        sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IP, NFS_SOURCE_VOLUME)

    })

    It("should complete the source file server management workflow", func() {
		By("########################## App Admin E2E Tests Begins ################################")

        By("Creating the source file server")
        sourceParams := CreateServereParams{
            ConfigName:       "source-file-server",
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
        Expect(err).NotTo(HaveOccurred(), "Error creating source file server")
        Expect(sourceConfigId).NotTo(BeEmpty(), "sourceConfigID is empty")
        Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")
        defer resp.Body.Close()
        By(fmt.Sprintf("Source file server created with config ID: %#v", resp))
        Wait(60)


        By("Retrieving file server information by ID")
        sourcePathId, err := GetExportPathID("source", NFS_SOURCE_VOLUME, sourceConfigId, headers)
		Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
        Expect(sourcePathId).NotTo(BeEmpty(), "Source path ID should not be empty")
        Wait(5) 

        By("Creating a new discovery job for the source server")
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
		Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for source: %v", err))
        defer resp.Body.Close()
        discoveryJobConfigId = discoveryJobConfigIds[0]
        Wait(30)

        By("Monitoring job execution by retrieving job status")
        jobConfigDetails, resp, err := GetJobRunDetails(discoveryJobConfigId, headers, false)
        Expect(err).NotTo(HaveOccurred(), "Error getting job run details")
        Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
        defer resp.Body.Close()
        
        Expect(jobConfigDetails.JobRuns).NotTo(BeEmpty(), "Job runs should not be empty")
        discoveryJobRunId = jobConfigDetails.JobRuns[0].JobRunId
        Expect(discoveryJobRunId).NotTo(BeEmpty(), "Discovery job run ID should not be empty")
        err = WaitForJobState(discoveryJobRunId, COMPLETED_JOBRUN)
        Expect(err).NotTo(HaveOccurred(), "Discovery job %s did not complete", discoveryJobRunId)


        By("Creating the destination file server")
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

        By("Getting destination file server details")
        destinationPathId, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME, destinationConfigId, headers)
        Expect(err).NotTo(HaveOccurred(), "Error getting destination export path ID")
        Wait(5)

        By("Creating a new discovery job for the destination server")
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
		Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for destination: %v", err))
        defer resp.Body.Close()
        destDiscoveryJobConfigId := destinationDiscoveryJobConfigIds[0]
        Wait(30)

        By("Monitoring destination discovery job execution")
        destJobConfigDetails, resp, err := GetJobRunDetails(destDiscoveryJobConfigId, headers, false)
        Expect(err).NotTo(HaveOccurred(), "Error getting job run details")
        Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
        defer resp.Body.Close()
        Expect(destJobConfigDetails.JobRuns).NotTo(BeEmpty(), "Job runs should not be empty")
        destDiscoveryJobRunId := destJobConfigDetails.JobRuns[0].JobRunId
        Expect(destDiscoveryJobRunId).NotTo(BeEmpty(), "Discovery job run ID should not be empty")
        err = WaitForJobState(destDiscoveryJobRunId, COMPLETED_JOBRUN)
		Expect(err).NotTo(HaveOccurred(), "Discovery job %s did not complete", destDiscoveryJobRunId)

        By("Creating and running migration job")
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
        migrationJobConfigIds, resp, err := CreateMigrationJob(migrationParams, headers)
        Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
		defer resp.Body.Close()

        for _, migrationJobConfigID := range migrationJobConfigIds {
            getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers, false)
            migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
            Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
            defer resp.Body.Close()
            Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
            Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
            err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
            Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")
        }

        By("Creating first bulk cutover job")
        cutoverParams := BulkCutoverJobParams{
            SourcePathIDs:      []string{sourcePathId},
            DestinationPathIDs: []string{destinationPathId},
        }
        cutoverJobConfigIds, resp, err := CreateBulkCutoverJob(cutoverParams, headers)
		Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating bulk cutover job: %v", err))
        defer resp.Body.Close()
        Expect(len(cutoverJobConfigIds)).To(BeNumerically(">", 0), "Should have at least one cutover job config ID")
    })

    AfterAll(func() {

        err := RemoveDeltaFromVolume(sourceVolumePath1)
        Expect(err).NotTo(HaveOccurred(), "Error restoring original data to %s", sourceVolumePath1)
        fmt.Println("Restored original data to source volume:", sourceVolumePath1)

        err = ClearVolume(destinationVolumePath1)
        Expect(err).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath1)
        fmt.Println("Cleared volume of destination:", destinationVolumePath1)

        err = CleanupTestEnv()
        Expect(err).To(BeNil(), "Error during test environment cleanup")
        By("Cleanup complete.")

        fmt.Println("All source file server test cleanup operations completed.")
    })
})

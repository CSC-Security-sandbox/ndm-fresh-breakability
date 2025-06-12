package tests

import (
	. "ndm-api-tests/utils"
	"net/http"
	"time"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-002: Create a fileserver with 2 workers (1 offline) and check discovery and migration", func() {
	var headers map[string]string
	var (
		ProjectId       string
		workerId        string
		workerId1       string
		workerIds       []string
		err             error
		getSourceResp   GetServerResponse
		currentDateTime string
	)
	BeforeEach(func() {
		ProjectId, workerIds, err = SetupTestEnv(2)
		Expect(err).To(BeNil(), "Error during test environment setup")
		Expect(len(workerIds)).Should(BeNumerically(">", 0), "Expected at least one worker to be attached")
		workerId = workerIds[0]
		workerId1 = workerIds[1]
		headers = GetHeaders(AuthToken, ContentTypeJSON)
		currentDateTime = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	})

	It("TC-002: Create a fileserver with 2 workers (1 offline) and check discovery and migration", func() {
		var sourceConfigID, sourceConfigID1, sourcePathID, sourcePathID1, sourceDiscoveryJobRunID, sourceDiscoveryJobRunID1 string
		var sourceJobConfigIDs, destinationJobConfigIDs, jobConfigIDs, migrationJobConfigIDs []string
		var jobConfigID, jobConfigID1, idCutover, idCutover1, migrationJobRunID string
		var destinationConfigID, destinationPathID, destinationPathID1, destinationJobConfigID, destinationJobConfigID1, destinationDiscoveryJobRunID, destinationDiscoveryJobRunID1 string

		By("Creating the source file server")
		time.Sleep(20 * time.Second)
		sourceParams := CreateServereParams{
			ConfigName:       "source-file-server",
			ConfigType:       "FILE",
			ProjectID:        ProjectId,
			ServerType:       "OtherNAS",
			UserName:         "Root",
			Password:         "",
			Protocol:         "NFS",
			ProtocolVersion:  "v3",
			Host:             SOURCE_HOST_IP,
			Workers:          []string{workerId, workerId1},
			WorkingDirectory: "",
		}
		sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
		Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
		defer resp.Body.Close()
		// CheckResponse(resp, http.StatusCreated)

		By("Getting the source file server by config ID")
		sourcePathID, getSourceResp, err = GetExportPathID("source", NFS_SOURCE_VOLUME, sourceConfigID, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
		Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
		Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")
		Expect(sourcePathID).NotTo(BeEmpty(), "Expected a valid sourcePathID")

		sourcePathID1, getSourceResp, err = GetExportPathID("source", NFS_SOURCE_VOLUME_1, sourceConfigID, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
		Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
		Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")
		Expect(sourcePathID1).NotTo(BeEmpty(), "Expected a valid sourcePathID1")

		By("Creating the destination file server")
		destinationParams := CreateServereParams{
			ConfigName:       "destination-file-server",
			ConfigType:       "FILE",
			ProjectID:        ProjectId,
			ServerType:       "OtherNAS",
			UserName:         "Root",
			Password:         "",
			Protocol:         "NFS",
			ProtocolVersion:  "v3",
			Host:             DESTINATION_HOST_IP,
			Workers:          []string{workerId, workerId1},
			WorkingDirectory: "",
		}
		destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
		Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
		defer resp.Body.Close()
		// CheckResponse(resp, http.StatusCreated)

		By("Getting the destination file server by configId")
		destinationPathID, getSourceResp, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME, destinationConfigID, headers)
		Expect(destinationPathID).NotTo(BeEmpty(), "Expected a valid sourcePathID")
		Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
		Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
		Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")

		destinationPathID1, getSourceResp, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME_1, destinationConfigID, headers)
		Expect(destinationPathID1).NotTo(BeEmpty(), "Expected a valid sourcePathID")
		Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
		Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
		Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")

		DetachWorkers(1)
		// time.Sleep(182 * time.Second)

		By("Creating a new discovery job for the source")
		jobParams := DiscoveryJobParams{
			SourcePathIDs:            []string{sourcePathID, sourcePathID1},
			ExcludeOlderThan:         nil,
			ExcludeFilePatterns:      "",
			PreserveAccessTime:       false,
			FirstRunAt:               currentDateTime,
			CreatedBy:                nil,
			WorkflowExecutionTimeout: "60s",
			WorkflowTaskTimeout:      "30s",
			WorkflowRunTimeout:       "30s",
			StartDelay:               "10s",
		}
		sourceJobConfigIDs, resp, err = CreateDiscoveryJob(jobParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error creating new discovery for source")
		Expect(len(sourceJobConfigIDs)).To(BeNumerically(">", 0), "No valid sourceJobConfigIDs found in response")
		defer resp.Body.Close()
		// CheckResponse(resp, http.StatusCreated)

		sourceConfigID = sourceJobConfigIDs[0]
		sourceConfigID1 = sourceJobConfigIDs[1]

		By("Getting jobs by jobConfigId for source")
		getJobsResp, resp, err := GetJobRunDetails(sourceConfigID, headers)
		sourceDiscoveryJobRunID = getJobsResp.JobRuns[0].JobRunId
		Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(sourceDiscoveryJobRunID).NotTo(BeEmpty(), "source Discovery JobRun ID should not be empty")

		getJobsResp, resp, err = GetJobRunDetails(sourceConfigID1, headers)
		sourceDiscoveryJobRunID1 = getJobsResp.JobRuns[0].JobRunId
		Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(sourceDiscoveryJobRunID1).NotTo(BeEmpty(), "source Discovery JobRun ID should not be empty")

		// Wait for both discovery jobs to complete
		err = WaitForJobState(sourceDiscoveryJobRunID, COMPLETED_JOBRUN, 25)
		Expect(err).NotTo(HaveOccurred(), "Source discovery job did not complete")
		err = WaitForJobState(sourceDiscoveryJobRunID1, COMPLETED_JOBRUN)
		Expect(err).NotTo(HaveOccurred(), "Source discovery job 1 did not complete")

		By("Creating a new discovery job for destination")
		destinationJobParams := DiscoveryJobParams{
			SourcePathIDs:            []string{destinationPathID, destinationPathID1},
			ExcludeOlderThan:         nil,
			ExcludeFilePatterns:      "",
			PreserveAccessTime:       false,
			FirstRunAt:               currentDateTime,
			CreatedBy:                nil,
			WorkflowExecutionTimeout: "60s",
			WorkflowTaskTimeout:      "30s",
			WorkflowRunTimeout:       "30s",
			StartDelay:               "10s",
		}
		destinationJobConfigIDs, resp, err = CreateDiscoveryJob(destinationJobParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error creating new discovery for destination")
		Expect(len(destinationJobConfigIDs)).To(BeNumerically(">", 0), "No valid destinationJobConfigIDs found in response")
		defer resp.Body.Close()
		// CheckResponse(resp, http.StatusCreated)

		destinationJobConfigID = destinationJobConfigIDs[0]
		destinationJobConfigID1 = destinationJobConfigIDs[1]

		By("Getting jobs by jobConfigId for destination")
		getJobsResp, resp, err = GetJobRunDetails(destinationJobConfigID, headers)
		destinationDiscoveryJobRunID = getJobsResp.JobRuns[0].JobRunId
		Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(destinationDiscoveryJobRunID).NotTo(BeEmpty(), "source Discovery JobRun ID should not be empty")

		getJobsResp, resp, err = GetJobRunDetails(destinationJobConfigID1, headers)
		destinationDiscoveryJobRunID1 = getJobsResp.JobRuns[0].JobRunId
		Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(destinationDiscoveryJobRunID1).NotTo(BeEmpty(), "source Discovery JobRun ID should not be empty")
		// Wait for both discovery jobs to complete
		err = WaitForJobState(destinationDiscoveryJobRunID, COMPLETED_JOBRUN, 25)
		Expect(err).NotTo(HaveOccurred(), "Source discovery job did not complete")
		err = WaitForJobState(destinationDiscoveryJobRunID1, COMPLETED_JOBRUN, 25)
		Expect(err).NotTo(HaveOccurred(), "Source discovery job 1 did not complete")

		By("Creating a migration job")
		migrationParams := MigrationJobParams{
			FirstRunAt:         currentDateTime,
			FutureRunSchedule:  "",
			SourcePathIDs:      []string{sourcePathID, sourcePathID1},
			DestinationPathIDs: []string{destinationPathID, destinationPathID1},
			SidMapping:         false,
			Options: map[string]interface{}{
				"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
				"preserveAccessTime":  true,
				"skipFile":            "15-M",
			},
		}
		migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error creating migration job")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 Created")
		Expect(len(migrationJobConfigIDs)).To(BeNumerically(">", 0), "Expected at least one jobConfigID")

		// Get migration job run IDs and wait for completion
		for _, migrationJobConfigID := range migrationJobConfigIDs {
			getJobsResp, resp, err = GetJobRunDetails(migrationJobConfigID, headers)
			migrationJobRunID = getJobsResp.JobRuns[0].JobRunId
			Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
			err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN, 30)
			Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")
		}

		By("Creating bulk cutover job")
		cutoverParams := BulkCutoverJobParams{
			SourcePathIDs:      []string{sourcePathID, sourcePathID1},
			DestinationPathIDs: []string{destinationPathID, destinationPathID1},
		}
		jobConfigIDs, resp, err = CreateBulkCutoverJob(cutoverParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error creating bulk cutover job")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 Created")
		Expect(len(jobConfigIDs)).To(BeNumerically(">", 0), "No valid jobConfigIDs found in response")
		Expect(jobConfigIDs).NotTo(BeEmpty(), "Expected a valid jobConfigID")

		jobConfigID = jobConfigIDs[0]
		jobConfigID1 = jobConfigIDs[1]
		time.Sleep(20 * time.Second)

		// By("Getting jobs by job config id")
		// getJobsResp, resp, err := GetBlockedJobRunID(jobConfigID, headers)
		// Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID")
		// defer resp.Body.Close()
		// Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		// Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found in response")
		// Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID")
		// idCutover = getJobsResp.JobRuns[0].JobRunId
		// err = WaitForJobState(idCutover, BLOCKED_JOBRUN, 30)
		// Expect(err).NotTo(HaveOccurred(), "Cutover job did not reach BLOCKED state")

		// getJobsResp, resp, err = GetBlockedJobRunID(jobConfigID1, headers)
		// Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID")
		// defer resp.Body.Close()
		// Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		// Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found in response")
		// Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID")
		// idCutover1 = getJobsResp.JobRuns[0].JobRunId
		// err = WaitForJobState(idCutover1, BLOCKED_JOBRUN, 30)
		// Expect(err).NotTo(HaveOccurred(), "Cutover job 1 did not reach BLOCKED state")
		// Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected jobRuns[0].status to be BLOCKED")

		By("Getting jobs by job config id")
		getJobsResp, resp, err = GetJobRunDetails(jobConfigID, headers)
		Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID")
		defer resp.Body.Close()
		idCutover = getJobsResp.JobRuns[0].JobRunId
		WaitForJobState(idCutover, BLOCKED_JOBRUN, 30)
		getJobsResp, resp, err = GetJobRunDetails(jobConfigID, headers)
		Expect(err).NotTo(HaveOccurred(), "Cutover1 job did not reach BLOCKED state")
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found in response")
		Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID")
		Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected jobRuns[0].status to be BLOCKED")

		getJobsResp, resp, err = GetJobRunDetails(jobConfigID1, headers)
		Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID")
		defer resp.Body.Close()

		idCutover1 = getJobsResp.JobRuns[0].JobRunId
		WaitForJobState(idCutover1, BLOCKED_JOBRUN, 30)
		getJobsResp, resp, err = GetJobRunDetails(jobConfigID1, headers)
		Expect(err).NotTo(HaveOccurred(), "Cutover2 job did not reach BLOCKED state")
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found in response")
		Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID")
		Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected jobRuns[0].status to be BLOCKED")

		By("Approving bulk cutover job")
		resp, err = ApproveRejectBulkCutoverJob(idCutover, "APPROVED", headers)
		Expect(err).NotTo(HaveOccurred(), "Error approving/rejecting bulk cutover job")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

		resp, err = ApproveRejectBulkCutoverJob(idCutover1, "APPROVED", headers)
		Expect(err).NotTo(HaveOccurred(), "Error approving/rejecting bulk cutover job")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
	})

	AfterEach(func() {
		err := CleanupTestEnv()
		Expect(err).To(BeNil(), "Error during test environment cleanup")
		LogDebug("Cleanup complete.")
	})
})

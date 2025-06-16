package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"time"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-001: Create a fileserver with 2 workers and check discovery and migration", func() {
	var (
		ProjectId       string
		workerId1       string
		workerId2       string
		workerIds       []string
		err             error
		headers         map[string]string
		getSourceResp   GetServerResponse
		currentDateTime string
	)
	BeforeEach(func() {
		numberOfWorker := 2
		ProjectId, workerIds, err = SetupTestEnv(numberOfWorker)
		Expect(err).To(BeNil(), "Error during test environment setup")
		Expect(len(workerIds)).Should(BeNumerically(">", 0), "Expected at least one worker to be attached")
		workerId1 = workerIds[0]
		workerId2 = workerIds[1]
		headers = GetHeaders(AuthToken, ContentTypeJSON)
		currentDateTime = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	})

	It("TC-001: Create a fileserver with 2 workers and check discovery and migration", func() {
		var sourceConfigID, sourceJobConfigID1, sourceJobConfigID2, sourcePathID1, sourcePathID2, sourceDiscoveryJobRunID1, sourceDiscoveryJobRunID2 string
		var sourceJobConfigIDs, destinationJobConfigIDs, jobConfigIDs, migrationJobConfigIDs []string
		var jobConfigID1, jobConfigID2, cutoverRunID1, cutoverRunID2 string
		var destinationConfigID, destinationPathID1, destinationPathID2 string
		var destinationJobConfigID1, destinationJobConfigID2, destinationDiscoveryJobRunID1, destinationDiscoveryJobRunID2 string

		By("Creating the source file server")
		IntroduceDelay(20)
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
			Workers:          []string{workerId1, workerId2},
			WorkingDirectory: "",
		}
		sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
		Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")

		By("Getting the source file server by config ID")
		sourcePathID1, getSourceResp, err = GetExportPathID("source", NFS_SOURCE_VOLUME_1, sourceConfigID, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
		Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
		Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")
		Expect(sourcePathID1).NotTo(BeEmpty(), "Expected a valid sourcePathID1")

		sourcePathID2, getSourceResp, err = GetExportPathID("source", NFS_SOURCE_VOLUME_2, sourceConfigID, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
		Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
		Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")
		Expect(sourcePathID2).NotTo(BeEmpty(), "Expected a valid sourcePathID2")

		By("Creating a new discovery job for the source")
		jobParams := DiscoveryJobParams{
			SourcePathIDs:            []string{sourcePathID1, sourcePathID2},
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
		Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")

		sourceJobConfigID1 = sourceJobConfigIDs[0]
		sourceJobConfigID2 = sourceJobConfigIDs[1]

		By("Getting jobs by jobConfigId for source")
		getJobsResp, resp, err := GetJobRunDetails(sourceJobConfigID1, headers)
		sourceDiscoveryJobRunID1 = getJobsResp.JobRuns[0].JobRunId
		Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(sourceDiscoveryJobRunID1).NotTo(BeEmpty(), "source Discovery JobRun ID should not be empty")

		getJobsResp, resp, err = GetJobRunDetails(sourceJobConfigID2, headers)
		sourceDiscoveryJobRunID2 = getJobsResp.JobRuns[0].JobRunId
		Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(sourceDiscoveryJobRunID2).NotTo(BeEmpty(), "source Discovery JobRun ID should not be empty")

		// Wait for both discovery jobs to complete
		err = WaitForJobState(sourceDiscoveryJobRunID1, COMPLETED_JOBRUN, 25)
		Expect(err).NotTo(HaveOccurred(), "Source discovery job did not complete")
		err = WaitForJobState(sourceDiscoveryJobRunID2, COMPLETED_JOBRUN)
		Expect(err).NotTo(HaveOccurred(), "Source discovery job 1 did not complete")

		result, err := ValidateReport(sourceDiscoveryJobRunID1, JobTypeDiscovery, "../utils/validator/PDFDetails.json")
		Expect(err).NotTo(HaveOccurred(), "error while discovery report validation")
		LogDebug(fmt.Sprintf("validate report result : %s", result))
		result, err = ValidateReport(sourceDiscoveryJobRunID2, JobTypeDiscovery, "../utils/validator/PDFDetails.json")
		Expect(err).NotTo(HaveOccurred(), "error while discovery report validation")
		LogDebug(fmt.Sprintf("validate report result : %s", result))

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
			Workers:          []string{workerId1, workerId2},
			WorkingDirectory: "",
		}
		destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
		Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")

		By("Getting the destination file server by configId")
		destinationPathID1, getSourceResp, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME_1, destinationConfigID, headers)
		Expect(destinationPathID1).NotTo(BeEmpty(), "Expected a valid sourcePathID")
		Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
		Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
		Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")

		destinationPathID2, getSourceResp, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME_2, destinationConfigID, headers)
		Expect(destinationPathID2).NotTo(BeEmpty(), "Expected a valid sourcePathID")
		Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
		Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
		Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")

		By("Creating a new discovery job for destination")
		destinationJobParams := DiscoveryJobParams{
			SourcePathIDs:            []string{destinationPathID1, destinationPathID2},
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

		Expect(err).NotTo(HaveOccurred(), "Error creating new discovery for source")
		Expect(len(destinationJobConfigIDs)).To(BeNumerically(">", 0), "No valid destinationJobConfigIDs found in response")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 CREATED")

		destinationJobConfigID1 = destinationJobConfigIDs[0]
		destinationJobConfigID2 = destinationJobConfigIDs[1]

		By("Getting jobs by jobConfigId for destination")
		getJobsResp, resp, err = GetJobRunDetails(destinationJobConfigID1, headers)
		destinationDiscoveryJobRunID1 = getJobsResp.JobRuns[0].JobRunId
		Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(destinationDiscoveryJobRunID1).NotTo(BeEmpty(), "Destination Discovery JobRun ID should not be empty")

		getJobsResp, resp, err = GetJobRunDetails(destinationJobConfigID2, headers)
		destinationDiscoveryJobRunID2 = getJobsResp.JobRuns[0].JobRunId
		Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(destinationDiscoveryJobRunID2).NotTo(BeEmpty(), "Destination Discovery JobRun ID should not be empty")

		// Wait for both discovery jobs to complete
		err = WaitForJobState(destinationDiscoveryJobRunID1, COMPLETED_JOBRUN)
		Expect(err).NotTo(HaveOccurred(), "Source discovery job did not complete")
		err = WaitForJobState(destinationDiscoveryJobRunID2, COMPLETED_JOBRUN)
		Expect(err).NotTo(HaveOccurred(), "Source discovery job 1 did not complete")

		result, err = ValidateReport(destinationDiscoveryJobRunID1, JobTypeDiscovery, "../utils/validator/PDFDetails.json")
		Expect(err).NotTo(HaveOccurred(), "error while discovery report validation")
		LogDebug(fmt.Sprintf("validate report result : %s", result))
		result, err = ValidateReport(destinationDiscoveryJobRunID2, JobTypeDiscovery, "../utils/validator/PDFDetails.json")
		Expect(err).NotTo(HaveOccurred(), "error while discovery report validation")
		LogDebug(fmt.Sprintf("validate report result : %s", result))

		By("Creating a migration job")
		migrationParams := MigrationJobParams{
			FirstRunAt:         currentDateTime,
			FutureRunSchedule:  "",
			SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
			DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
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
			migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
			Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
			err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN, 30)
			Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

			result, err := ValidateReport(migrationJobRunID, JobTypeMigration, "../utils/validator/COCDetails.json")
			Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
			LogDebug(fmt.Sprintf("validate report result : %s", result))
		}

		By("Creating bulk cutover job")
		cutoverParams := BulkCutoverJobParams{
			SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
			DestinationPathIDs: []string{destinationPathID1, destinationPathID2},
		}
		jobConfigIDs, resp, err = CreateBulkCutoverJob(cutoverParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error creating bulk cutover job")
		defer resp.Body.Close()

		Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 Created")
		Expect(len(jobConfigIDs)).To(BeNumerically(">", 0), "No valid jobConfigIDs found in response")
		Expect(jobConfigIDs).NotTo(BeEmpty(), "Expected a valid jobConfigID")

		jobConfigID1 = jobConfigIDs[0]
		jobConfigID2 = jobConfigIDs[1]

		By("Getting jobs by job config id")
		getJobsResp, resp, err = GetJobRunDetails(jobConfigID1, headers)
		Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID")
		defer resp.Body.Close()
		cutoverRunID1 = getJobsResp.JobRuns[0].JobRunId
		WaitForJobState(cutoverRunID1, BLOCKED_JOBRUN, 30)
		// Fetch the latest status
		getJobsResp, resp, err = GetJobRunDetails(jobConfigID1, headers)
		Expect(err).NotTo(HaveOccurred(), "cutoverRunID job did not reach BLOCKED state")
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found in response")
		Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID")
		Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected jobRuns[0].status to be BLOCKED")

		getJobsResp, resp, err = GetJobRunDetails(jobConfigID2, headers)
		Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID")
		defer resp.Body.Close()
		cutoverRunID2 = getJobsResp.JobRuns[0].JobRunId
		WaitForJobState(cutoverRunID2, BLOCKED_JOBRUN, 30)
		// Fetch the latest status
		getJobsResp, resp, err = GetJobRunDetails(jobConfigID2, headers)
		Expect(err).NotTo(HaveOccurred(), "cutoverRunID1 job did not reach BLOCKED state")
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found in response")
		Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID")
		Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected jobRuns[0].status to be BLOCKED")

		By("Approving bulk cutover job")
		resp, err = ApproveRejectBulkCutoverJob(cutoverRunID1, "APPROVED", headers)
		Expect(err).NotTo(HaveOccurred(), "Error approving/rejecting bulk cutover job")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

		resp, err = ApproveRejectBulkCutoverJob(cutoverRunID2, "APPROVED", headers)
		Expect(err).NotTo(HaveOccurred(), "Error approving/rejecting bulk cutover job")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

		result, err = ValidateReport(cutoverRunID1, JobTypeCutover, "../utils/validator/COCDetails.json")
		Expect(err).NotTo(HaveOccurred(), "error while cutover report validation")
		LogDebug(fmt.Sprintf("validate report result : %s", result))
		result, err = ValidateReport(cutoverRunID2, JobTypeCutover, "../utils/validator/COCDetails.json")
		Expect(err).NotTo(HaveOccurred(), "error while cutover report validation")
		LogDebug(fmt.Sprintf("validate report result : %s", result))
	})

	AfterEach(func() {
		err := CleanupTestEnv()
		Expect(err).To(BeNil(), "Error during test environment cleanup")
		LogDebug("Cleanup complete.")
	})
})

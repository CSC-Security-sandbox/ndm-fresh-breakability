package tests

import (
	"fmt"
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
		workerId1       string
		workerId2       string
		workerIds       []string
		err             error
		getSourceResp   GetServerResponse
		currentDateTime string
	)
	BeforeEach(func() {
		ProjectId, workerIds, err = SetupTestEnv(2)
		Expect(err).To(BeNil(), "Error during test environment setup")
		Expect(len(workerIds)).Should(BeNumerically(">", 0), "Expected at least one worker to be attached")
		workerId1 = workerIds[0]
		workerId2 = workerIds[1]
		headers = GetHeaders(AuthToken, ContentTypeJSON)
		currentDateTime = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	})

	It("TC-002: Create a fileserver with 2 workers (1 offline) and check discovery and migration", func() {
		var sourceConfigID1, sourceConfigID2, sourcePathID1, sourcePathID2, sourceDiscoveryJobRunID1, sourceDiscoveryJobRunID2 string
		var sourceJobConfigIDs, destinationJobConfigIDs, jobConfigIDs, migrationJobConfigIDs []string
		var jobConfigID1, jobConfigID2, idCutover1, idCutover2, migrationJobRunID string

		// DO NOT CHANGE THIS ROW
		var destinationConfigID, destinationPathID, destinationPathID1, destinationJobConfigID1, destinationJobConfigID2, destinationDiscoveryJobRunID1, destinationDiscoveryJobRunID2 string

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
			Workers:          []string{workerId1, workerId2},
			WorkingDirectory: "",
		}
		sourceConfigID1, resp, err := CreateFileServer(sourceParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
		Expect(sourceConfigID1).NotTo(BeEmpty(), "sourceConfigID1 is empty")
		defer resp.Body.Close()

		By("Getting the source file server by config ID")
		sourcePathID1, getSourceResp, err = GetExportPathID("source", NFS_SOURCE_VOLUME, sourceConfigID1, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
		Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
		Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")
		Expect(sourcePathID1).NotTo(BeEmpty(), "Expected a valid sourcePathID1")

		sourcePathID2, getSourceResp, err = GetExportPathID("source", NFS_SOURCE_VOLUME_1, sourceConfigID1, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
		Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
		Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")
		Expect(sourcePathID2).NotTo(BeEmpty(), "Expected a valid sourcePathID2")

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

		By("Getting the destination file server by configId")
		destinationPathID, getSourceResp, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME, destinationConfigID, headers)
		Expect(destinationPathID).NotTo(BeEmpty(), "Expected a valid destinationPathID")
		Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
		Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
		Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")

		destinationPathID1, getSourceResp, err = GetExportPathID("destination", NFS_DESTINATION_VOLUME_1, destinationConfigID, headers)
		Expect(destinationPathID1).NotTo(BeEmpty(), "Expected a valid destinationPathID1")
		Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
		Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
		Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")

		DetachWorkers(1)
		IntroduceDelay(40)

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

		sourceConfigID1 = sourceJobConfigIDs[0]
		sourceConfigID2 = sourceJobConfigIDs[1]

		By("Getting jobs by jobConfigId for source")
		getJobsResp, resp, err := GetJobRunDetails(sourceConfigID1, headers)
		sourceDiscoveryJobRunID1 = getJobsResp.JobRuns[0].JobRunId
		Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(sourceDiscoveryJobRunID1).NotTo(BeEmpty(), "sourceDiscoveryJobRunID1 should not be empty")

		getJobsResp, resp, err = GetJobRunDetails(sourceConfigID2, headers)
		sourceDiscoveryJobRunID2 = getJobsResp.JobRuns[0].JobRunId
		Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(sourceDiscoveryJobRunID2).NotTo(BeEmpty(), "sourceDiscoveryJobRunID2 should not be empty")

		// Wait for both discovery jobs to complete
		err = WaitForJobState(sourceDiscoveryJobRunID1, COMPLETED_JOBRUN)
		Expect(err).NotTo(HaveOccurred(), "Source discovery job did not complete")
		IntroduceDelay(40)
		result, err := ValidateReport(sourceDiscoveryJobRunID1, JobTypeDiscovery, "../validator/PDFDetails.json")
		Expect(err).NotTo(HaveOccurred(), "Error while validate PDF report")
		LogDebug(fmt.Sprintf("validate report result : %s", result))

		err = WaitForJobState(sourceDiscoveryJobRunID2, COMPLETED_JOBRUN)
		Expect(err).NotTo(HaveOccurred(), "Source discovery job 2 did not complete")

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

		destinationJobConfigID1, destinationJobConfigID2 = destinationJobConfigIDs[0], destinationJobConfigIDs[1]

		By("Getting jobs by jobConfigId for destination")
		getJobsResp, resp, err = GetJobRunDetails(destinationJobConfigID1, headers)
		destinationDiscoveryJobRunID1 = getJobsResp.JobRuns[0].JobRunId
		Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(destinationDiscoveryJobRunID1).NotTo(BeEmpty(), "destinationDiscoveryJobRunID1 should not be empty")

		getJobsResp, resp, err = GetJobRunDetails(destinationJobConfigID2, headers)
		destinationDiscoveryJobRunID2 = getJobsResp.JobRuns[0].JobRunId
		Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(destinationDiscoveryJobRunID2).NotTo(BeEmpty(), "destinationDiscoveryJobRunID2 should not be empty")

		// Wait for both discovery jobs to complete
		err = WaitForJobState(destinationDiscoveryJobRunID1, COMPLETED_JOBRUN)
		Expect(err).NotTo(HaveOccurred(), "destination discovery job did not complete")

		err = WaitForJobState(destinationDiscoveryJobRunID2, COMPLETED_JOBRUN)
		Expect(err).NotTo(HaveOccurred(), "destination discovery job 1 did not complete")
		IntroduceDelay(40)
		result, err = ValidateReport(destinationDiscoveryJobRunID1, JobTypeDiscovery, "../validator/PDFDetails.json")
		Expect(err).NotTo(HaveOccurred(), "Error while validate PDF report")
		LogDebug(fmt.Sprintf("validate report result : %s", result))

		By("Creating a migration job")
		migrationParams := MigrationJobParams{
			FirstRunAt:         currentDateTime,
			FutureRunSchedule:  "",
			SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
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
			err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")
			IntroduceDelay(30)
			res, err := ValidateReport(migrationJobRunID, JobTypeMigration, "../utils/validator/PDFDetails.json")
			Expect(err).NotTo(HaveOccurred(), "error while migration report validation")
			LogDebug(fmt.Sprintf("validate report result : %s", res))
		}

		By("Creating bulk cutover job")
		cutoverParams := BulkCutoverJobParams{
			SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
			DestinationPathIDs: []string{destinationPathID, destinationPathID1},
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
		idCutover1 = getJobsResp.JobRuns[0].JobRunId
		WaitForJobState(idCutover1, BLOCKED_JOBRUN)
		getJobsResp, resp, err = GetJobRunDetails(jobConfigID1, headers)
		Expect(err).NotTo(HaveOccurred(), "Cutover1 job did not reach BLOCKED state")
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found in response")
		Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID")
		Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected jobRuns[0].status to be BLOCKED")

		getJobsResp, resp, err = GetJobRunDetails(jobConfigID2, headers)
		Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID")
		defer resp.Body.Close()

		idCutover2 = getJobsResp.JobRuns[0].JobRunId
		WaitForJobState(idCutover2, BLOCKED_JOBRUN)
		getJobsResp, resp, err = GetJobRunDetails(jobConfigID2, headers)
		Expect(err).NotTo(HaveOccurred(), "Cutover2 job did not reach BLOCKED state")
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found in response")
		Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID")
		Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected jobRuns[0].status to be BLOCKED")

		By("Approving bulk cutover job")
		resp, err = ApproveRejectBulkCutoverJob(idCutover1, "APPROVED", headers)
		Expect(err).NotTo(HaveOccurred(), "Error approving/rejecting bulk cutover job")
		defer resp.Body.Close()
		Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
		WaitForJobState(idCutover1, APPROVED_JOBRUN)
		IntroduceDelay(40)
		result, err = ValidateReport(idCutover1, JobTypeCutover, "../validator/COCDetails.json")
		Expect(err).NotTo(HaveOccurred(), "Error while validate COC report")
		LogDebug(fmt.Sprintf("validate COC  report result : %s", result))

		resp, err = ApproveRejectBulkCutoverJob(idCutover2, "APPROVED", headers)
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

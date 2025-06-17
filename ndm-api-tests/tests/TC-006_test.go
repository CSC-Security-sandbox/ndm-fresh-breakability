package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"time"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-006: Run migration to the same destination", func() {
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
		Expect(len(workerIds)).Should(BeNumerically("=", 2), "Expected 2 workers to be attached")
		workerId1 = workerIds[0]
		workerId2 = workerIds[1]
		headers = GetHeaders(AuthToken, ContentTypeJSON)
		currentDateTime = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	})

	It("TC-006: Run migration to the same destination", func() {
		var sourceConfigID, sourcePathID1, sourcePathID2 string
		var jobConfigIDs, migrationJobConfigIDs, cutoverRunIDs []string
		var destinationConfigID, destinationPathID1, destinationPathID2 string

		By("Creating the source file server")
		IntroduceDelay(20)
		sourceParams := CreateServereParams{
			ConfigName:       "source-file-server",
			ConfigType:       CONFIG_TYPE_FILE,
			ProjectID:        ProjectId,
			ServerType:       SERVER_TYPE,
			UserName:         USERNAME_ROOT,
			Password:         PASSWORD_ROOT,
			Protocol:         PROTOCOL,
			ProtocolVersion:  PROTOCOL_VERSION_3,
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

		By("Creating the destination file server")
		destinationParams := CreateServereParams{
			ConfigName:       "destination-file-server",
			ConfigType:       CONFIG_TYPE_FILE,
			ProjectID:        ProjectId,
			ServerType:       SERVER_TYPE,
			UserName:         USERNAME_ROOT,
			Password:         PASSWORD_ROOT,
			Protocol:         PROTOCOL,
			ProtocolVersion:  PROTOCOL_VERSION_3,
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

		By("Creating a migration job")
		migrationParams := MigrationJobParams{
			FirstRunAt:         currentDateTime,
			FutureRunSchedule:  "",
			SourcePathIDs:      []string{sourcePathID1, sourcePathID2},
			DestinationPathIDs: []string{destinationPathID1, destinationPathID1},
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
			getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
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
			DestinationPathIDs: []string{destinationPathID1, destinationPathID1},
		}
		jobConfigIDs, resp, err = CreateBulkCutoverJob(cutoverParams, headers)
		Expect(err).NotTo(HaveOccurred(), "Error creating bulk cutover job")
		defer resp.Body.Close()

		Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 Created")
		Expect(len(jobConfigIDs)).To(BeNumerically(">", 0), "No valid jobConfigIDs found in response")
		Expect(jobConfigIDs).NotTo(BeEmpty(), "Expected a valid jobConfigID")

		By("Getting jobs by job config id")
		for _, jobConfigID := range jobConfigIDs {
			getJobsResp, resp, err := GetJobRunDetails(jobConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID for config %s", jobConfigID)
			defer resp.Body.Close()

			cutoverRunID := getJobsResp.JobRuns[0].JobRunId
			Expect(cutoverRunID).NotTo(BeEmpty(), "Expected a valid cutoverID for config %s", cutoverRunID)

			WaitForJobState(cutoverRunID, BLOCKED_JOBRUN, 30)
			// Fetch the latest status
			getJobsResp, resp, err = GetJobRunDetails(jobConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), "cutoverRunID job did not reach BLOCKED state")
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for config %s", jobConfigID)
			defer resp.Body.Close()

			Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found for config %s", jobConfigID)
			Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID for config %s", jobConfigID)
			Expect(getJobsResp.JobRuns[0].Status).To(Equal("BLOCKED"), "Expected status BLOCKED for config %s", jobConfigID)

			cutoverRunIDs = append(cutoverRunIDs, cutoverRunID)
		}

		By("Approving bulk cutover job")
		for _, cutoverRunID := range cutoverRunIDs {
			resp, err := ApproveRejectBulkCutoverJob(cutoverRunID, "APPROVED", headers)
			Expect(err).NotTo(HaveOccurred(), "Error approving bulk cutover job for run %s", cutoverRunID)
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK for run %s", cutoverRunID)
			defer resp.Body.Close()
		}

		By("Validating cutover reports")
		for _, cutoverRunID := range cutoverRunIDs {
			result, err := ValidateReport(cutoverRunID, JobTypeCutover, "../utils/validator/COCDetails.json")
			Expect(err).NotTo(HaveOccurred(), "Error while cutover report validation for run %s", cutoverRunID)
			LogDebug(fmt.Sprintf("validate report result for %s: %s", cutoverRunID, result))
		}
	})

	AfterEach(func() {
		err := CleanupTestEnv()
		Expect(err).To(BeNil(), "Error during test environment cleanup")
		LogDebug("Cleanup complete.")
	})
})

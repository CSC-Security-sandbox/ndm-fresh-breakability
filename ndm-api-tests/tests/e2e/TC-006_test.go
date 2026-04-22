package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-006: Run bulk cutover with concurrent migration jobs - batch pause/resume and stop/restart", func() {
	var headers map[string]string
	var (
		ProjectId             string
		ProjectName           string
		workerId1             string
		workerId2             string
		workerIds             []string
		err                   error
		attachedWorkersConfig map[string]SSHConfig
		sourceVolumePath1     string
		clonedSourceVolumes   []string
		clonedDestVolumes     []string
		sourceVolumeManager   *TestVolumeManager
		destVolumeManager     *TestVolumeManager
		testStartTime         time.Time
	)
	Context("TC-006: Run bulk cutover with concurrent migration jobs - batch pause/resume and stop/restart", func() {
		BeforeEach(func() {
			// Use globally created project and workers (created once in InitTestEnv)
			ProjectId, ProjectName, attachedWorkersConfig, err = GetGlobalTestEnv()
			Expect(err).To(BeNil(), "Error getting global test environment")
			LogDebug(fmt.Sprintf("[BeforeEach] Using Project: %s (ID: %s)", ProjectName, ProjectId))
			Expect(len(attachedWorkersConfig)).Should(BeNumerically(">", 1), "Expected at least one worker to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			// Setup ONTAP volume cloning for parallel test execution
			clonedSourceVolumes, clonedDestVolumes, sourceVolumeManager, destVolumeManager, err = SetupTestVolumesBeforeEach()
			if err != nil {
				Skip(fmt.Sprintf("Failed to setup test volumes: %v", err))
			}

			// Guarantee cleanup even on manual interrupt (Ctrl+C)
			DeferCleanup(func() {
				err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
				if err != nil {
					LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
				}
			})

			// Set volume paths using THIS test's cloned volumes
			sourceVolumePath1 = fmt.Sprintf("%s:%s", SOURCE_HOST_IPs[0], clonedSourceVolumes[0])
		})

		It("TC-006: Run bulk cutover with concurrent migration jobs - batch pause/resume and stop/restart", func() {
			testStartTime = time.Now()
			By("########################## TC-006 start ################################")
			LogDebug(fmt.Sprintf("[TC-006 START] Test execution started at: %s", testStartTime.Format("2006-01-02 15:04:05")))
			var sourceConfigID1, sourcePathID1, sourcePathID2 string
			var jobConfigIDs, migrationJobConfigIDs []string
			var migrationJobRunID string
			var destinationConfigID, destinationPathID1, destinationPathID2 string

			// Generate unique ID for FileServer names
			uniqueID := uuid.New().String()[:8]
			protocol := strings.ToLower(string(PROTOCOL_TYPE))

			By("Creating the source file server")
			sourceParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-006-%s-src-fs-%s", protocol, uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             SOURCE_HOST_IPs[0],
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			sourceConfigID1, resp, err := CreateFileServer(sourceParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
			Expect(sourceConfigID1).NotTo(BeEmpty(), "sourceConfigID1 is empty")
			defer resp.Body.Close()

			By("Getting the source file server by config ID")
			sourcePathID1, err = GetExportPathID("source", clonedSourceVolumes[0], sourceConfigID1, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			sourcePathID2, err = GetExportPathID("source", clonedSourceVolumes[1], sourceConfigID1, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating the destination file server")
			destinationParams := CreateServereParams{
				ConfigName:       fmt.Sprintf("tc-006-%s-dest-fs-%s", protocol, uniqueID),
				ConfigType:       ConfigTypeFile,
				ProjectID:        ProjectId,
				ServerType:       ServerTypeOtherNAS,
				UserName:         PROTOCOL_USERNAME,
				Password:         PROTOCOL_PASSWORD,
				Protocol:         PROTOCOL_TYPE,
				ProtocolVersion:  ProtocolVersion3,
				Host:             DESTINATION_HOST_IPs[0],
				Workers:          []string{workerId1, workerId2},
				WorkingDirectory: "",
			}
			destinationConfigID, resp, err = CreateFileServer(destinationParams, headers)
			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
			defer resp.Body.Close()

			By("Getting the destination file server by configId")
			destinationPathID1, err = GetExportPathID("destination", clonedDestVolumes[0], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			destinationPathID2, err = GetExportPathID("destination", clonedDestVolumes[1], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating a first migration job")
			migrationParams := MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID1},
				DestinationPathIDs: []string{destinationPathID1},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"preservePermissions": true,
					"skipFile":            "0-M",
				},
			}
			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()

			getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigIDs[0], headers)
			migrationJobRunID = getJobsResp.JobRuns[0].JobRunId
			Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
			defer resp.Body.Close()
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")

			err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

			By("Creating a second migration job")
			migrationParams = MigrationJobParams{
				FirstRunAt:         GetCurrentUTCTimestamp(),
				FutureRunSchedule:  "",
				SourcePathIDs:      []string{sourcePathID2},
				DestinationPathIDs: []string{destinationPathID2},
				SidMapping:         false,
				Options: map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"preservePermissions": true,
					"skipFile":            "0-M",
				},
			}
			migrationJobConfigIDs, resp, err = CreateMigrationJob(migrationParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
			defer resp.Body.Close()

			By("Adding Delta Data")
			_, err = AddDataToVolume(sourceVolumePath1)
			Expect(err).NotTo(HaveOccurred(), "Error adding delta data to %s", sourceVolumePath1)

			By("Creating bulk cutover job")
			cutoverParams := BulkCutoverJobParams{
				SourcePathIDs:      []string{sourcePathID1},
				DestinationPathIDs: []string{destinationPathID1},
			}
			jobConfigIDs, resp, err = CreateBulkCutoverJob(cutoverParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating bulk cutover job: %v", err))
			defer resp.Body.Close()

			getJobsResp, resp, err = GetJobRunDetails(jobConfigIDs[0], headers)
			Expect(err).NotTo(HaveOccurred(), "Error getting blocked job run ID")
			defer resp.Body.Close()
			firstCutoverjobRunID := getJobsResp.JobRuns[0].JobRunId

			getJobsResp, resp, err = GetJobRunDetails(jobConfigIDs[0], headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Cutover%d job did not reach BLOCKED state", 1))
			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
			Expect(len(getJobsResp.JobRuns)).To(BeNumerically(">", 0), "No jobRuns found in response")
			Expect(getJobsResp.JobRuns[0].JobRunId).NotTo(BeEmpty(), "Expected a valid cutoverID")

			By("Changing migration job run state")
			migrationJobRunIds := []string{}
			for _, migrationJobConfigID := range migrationJobConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigID, headers)
				migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
				defer resp.Body.Close()
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")
				migrationJobRunIds = append(migrationJobRunIds, migrationJobRunID)
				err = HandleJobRunStateChange(migrationJobRunID, "PAUSE", []string{migrationJobRunID})
				Expect(err).NotTo(HaveOccurred(), "Error while pause job run ID")
			}

			err = WaitForJobState(firstCutoverjobRunID, BLOCKED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Cutover job did not reach BLOCKED state")

			By("Testing PAUSE/RESUME operations on migration jobs")
			for _, jubrunid := range migrationJobRunIds {
				err = WaitForJobState(jubrunid, "PAUSED", 30)
				Expect(err).NotTo(HaveOccurred(), "Job did not reach PAUSED state")
				Wait(5) // wait for 5 seconds before resuming
				err = HandleJobRunStateChange(jubrunid, "RESUME", []string{jubrunid})
				Expect(err).NotTo(HaveOccurred(), "Error while resuming job run ID")
			}

			By("Waiting for all resumed migration jobs to complete")
			for _, jubrunid := range migrationJobRunIds {
				err = WaitForJobState(jubrunid, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete after resume")
			}

			By("Testing STOP/RESTART operations with ad-hoc job runs")
			for _, migrationJobConfigID := range migrationJobConfigIDs {
				By("Triggering ad-hoc run for migration job to test stop/restart")
				adHocJobRunId, resp, err := TriggerAdHocJobRun(migrationJobConfigID)
				Expect(err).NotTo(HaveOccurred(), "Error triggering ad-hoc job run")
				defer resp.Body.Close()
				Expect(adHocJobRunId).NotTo(BeEmpty(), "Ad-hoc JobRun ID should not be empty")

				By("Waiting for ad-hoc job to start running before stopping")
				err = WaitForJobState(adHocJobRunId, RUNNING_JOBRUN, 60)
				Expect(err).NotTo(HaveOccurred(), "Ad-hoc job did not reach RUNNING state")

				By("Stopping ad-hoc migration job")
				err = HandleJobRunStateChange(adHocJobRunId, "STOP", []string{adHocJobRunId})
				Expect(err).NotTo(HaveOccurred(), "Error while stopping job run ID")

				err = WaitForJobState(adHocJobRunId, STOPPED_JOBRUN, 60)
				Expect(err).NotTo(HaveOccurred(), "Ad-hoc migration job did not stop")
			}

			By("Verifying cutover job remains in BLOCKED state while migrations are stopped")
			err = WaitForJobState(firstCutoverjobRunID, BLOCKED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "Cutover job did not remain in BLOCKED state")

			By("Restarting all stopped migration jobs with new ad-hoc runs")
			for _, migrationJobConfigID := range migrationJobConfigIDs {
				By("Triggering new ad-hoc run to restart migration job")
				restartedJobRunId, resp, err := TriggerAdHocJobRun(migrationJobConfigID)
				Expect(err).NotTo(HaveOccurred(), "Error triggering restart ad-hoc job run")
				defer resp.Body.Close()

				err = WaitForJobState(restartedJobRunId, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Restarted migration job did not complete")
			}

			// result, err := ValidateReport(firstCutoverjobRunID, JobTypeCutover, fmt.Sprintf("../../validators/%s/cutover_validation.json", PROTOCOL_TYPE))
			// Expect(err).NotTo(HaveOccurred(), "Error while cutover report validation for run %s", firstCutoverjobRunID)
			// By(fmt.Sprintf("validate report result for %s: %s", firstCutoverjobRunID, result))

			By("########################## TC-006 end ################################")
		})

		AfterEach(func() {
			testEndTime := time.Now()
			testDuration := testEndTime.Sub(testStartTime)
			
			By("Cleanup started")

			// Cleanup ONTAP cloned volumes (this removes all test data)
			// Note: This is redundant with DeferCleanup in BeforeEach, but provides defense in depth
			err := CleanupTestVolumesAfterEach(sourceVolumeManager, destVolumeManager)
			if err != nil {
				LogError(fmt.Sprintf("Failed to cleanup test volumes: %v", err))
			}

			LogDebug("Cleanup completed")
			LogDebug(fmt.Sprintf("[TC-006 END] Test execution completed at: %s", testEndTime.Format("2006-01-02 15:04:05")))
			LogDebug(fmt.Sprintf("[TC-006 DURATION] Total test execution time: %s (%.2f minutes)", testDuration, testDuration.Minutes()))
		})
	})
})

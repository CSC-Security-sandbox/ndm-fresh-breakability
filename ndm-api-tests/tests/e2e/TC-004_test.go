package tests

import (
	"fmt"
	. "ndm-api-tests/utils"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("TC-004: Running discovery and batch pause/resume/stop/adhoc-run", func() {
	var headers map[string]string
	var (
		ProjectId             string
		workerId1             string
		workerId2             string
		workerIds             []string
		err                   error
		attachedWorkersConfig map[string]SSHConfig
	)
	Context("TC-004", func() {
		BeforeEach(func() {
			NumberOfWorker := 2
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(NumberOfWorker)
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically(">", 1), "Expected at least one worker to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			workerId2 = workerIds[1]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("TC-004 : Running discovery and batch pause/resume/stop/adhoc-run", func() {
			By("########################## TC-004 start ################################")
			var sourceConfigID1, sourceConfigID2, sourcePathID1, sourcePathID2 string
			var sourceJobConfigIDs, destinationJobConfigIDs []string
			var destinationConfigID, destinationPathID1, destinationPathID2, destinationJobConfigID1, destinationJobConfigID2 string
			var list []string

			By("Creating the source file server")
			// Adding a delay because sometimes the worker takes 10 to 15 seconds to attach
			Wait(20)
			sourceParams := CreateServereParams{
				ConfigName:       "source-file-server",
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
			sourcePathID1, err = GetExportPathID("source", SOURCE_VOLUMES[0], sourceConfigID1, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			sourcePathID2, err = GetExportPathID("source", SOURCE_VOLUMES[1], sourceConfigID1, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating the destination file server")
			destinationParams := CreateServereParams{
				ConfigName:       "destination-file-server",
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
			destinationPathID1, err = GetExportPathID("destination", DESTINATION_VOLUMES[0], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			destinationPathID2, err = GetExportPathID("destination", DESTINATION_VOLUMES[1], destinationConfigID, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))

			By("Creating a new discovery job for the source")
			jobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{sourcePathID1, sourcePathID2},
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
			sourceJobConfigIDs, resp, err = CreateDiscoveryJob(jobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for source: %v", err))
			defer resp.Body.Close()

			sourceConfigID1 = sourceJobConfigIDs[0]
			sourceConfigID2 = sourceJobConfigIDs[1]

			By("Getting jobs by jobConfigId for source")
			sourceConfigIDs := []string{sourceConfigID1, sourceConfigID2}
			sourceDiscoveryJobRunIDs := make([]string, len(sourceConfigIDs))
			discovery_validators := []string{
				"src_vol_discovery.json",
				"src_vol2_discovery.json",
			}
			for i, configID := range sourceConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(configID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				defer resp.Body.Close()
				jobRunID := getJobsResp.JobRuns[0].JobRunId
				sourceDiscoveryJobRunIDs[i] = jobRunID
				Expect(jobRunID).NotTo(BeEmpty(), fmt.Sprintf("sourceDiscoveryJobRunID%d should not be empty", i+1))

				if i == 0 {

					list = nil
					list = append(list, jobRunID)

					err = HandleJobRunStateChange(jobRunID, "PAUSE", list)
					Expect(err).NotTo(HaveOccurred(), "Error while pause job run ID")
					Wait(1)
					err = HandleJobRunStateChange(jobRunID, "RESUME", list)
					Expect(err).NotTo(HaveOccurred(), "Error while resume job run ID")
					Wait(1)
					err = HandleJobRunStateChange(jobRunID, "STOP", list)
					Expect(err).NotTo(HaveOccurred(), "Error while stop job run ID")

					err = WaitForJobState(jobRunID, "STOPPED", 30)
					Expect(err).NotTo(HaveOccurred(), "Source discovery job did not complete")
					_, _, err := TriggerAdHocJobRun(configID)
					Expect(err).NotTo(HaveOccurred(), "Error triggering ad-hoc job run")
					continue
				}
				err = WaitForJobState(jobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "Source discovery job did not complete")
				result, err := ValidateReport(jobRunID, JobTypeDiscovery, fmt.Sprintf("../../validators/%s/%s", PROTOCOL_TYPE, discovery_validators[i]))
				Expect(err).NotTo(HaveOccurred(), "Error while validate PDF report")
				By(fmt.Sprintf("validate report result : %s", result))
			}

			By("Creating a new discovery job for destination")
			destinationJobParams := DiscoveryJobParams{
				SourcePathIDs:            []string{destinationPathID1, destinationPathID2},
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
			destinationJobConfigIDs, resp, err = CreateDiscoveryJob(destinationJobParams, headers)
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating discovery job for destination: %v", err))
			defer resp.Body.Close()

			destinationJobConfigID1 = destinationJobConfigIDs[0]
			destinationJobConfigID2 = destinationJobConfigIDs[1]

			By("Getting jobs by jobConfigId for destination")
			destinationConfigIDs := []string{destinationJobConfigID1, destinationJobConfigID2}
			destinationDiscoveryJobRunIDs := make([]string, len(destinationConfigIDs))
			for i, configID := range destinationConfigIDs {
				getJobsResp, resp, err := GetJobRunDetails(configID, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting job run ID")
				defer resp.Body.Close()
				jobRunID := getJobsResp.JobRuns[0].JobRunId
				destinationDiscoveryJobRunIDs[i] = jobRunID
				Expect(jobRunID).NotTo(BeEmpty(), fmt.Sprintf("destinationDiscoveryJobRunID%d should not be empty", i+1))
			}

			// Wait for both discovery jobs to complete
			for i, jobRunID := range destinationDiscoveryJobRunIDs {

				if i == 0 {
					err = WaitForJobState(jobRunID, COMPLETED_JOBRUN)
					Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Destination discovery job %d did not complete", i+1))
					continue
				}
				err = WaitForJobState(jobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Destination discovery job %d did not complete", i+1))
			}

			By("########################## TC-004 end ################################")
		})

		AfterEach(func() {
			By("Cleanup started")
			err = CleanupTestEnv()
			Expect(err).To(BeNil(), "Error during test environment cleanup")
			LogDebug("Cleanup complete.")
		})
	})
})

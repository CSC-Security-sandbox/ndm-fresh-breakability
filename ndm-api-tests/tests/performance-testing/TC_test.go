package performance_testing

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

const (
	numPacks          = 5
	migrationsPerPack = 5
)

var _ = Describe("TC-PERFORMANCE-TEST", func() {
	var (
		ProjectId          string
		workerId1          string
		headers            map[string]string
		err                error
		migrationConfigID  string // <--- store configID globally
		sourcePathID1      string
		destinationPathID1 string
	)

	Context("TC-001", func() {
		BeforeEach(func() {
			numberOfWorker := 1
			var attachedWorkersConfig map[string]SSHConfig
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
			Expect(err).To(BeNil(), "error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(Equal(1), "expected 1 worker to be attached")

			workerIds := GetWorkerIds()
			workerId1 = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)

			// --- Create file servers only once ---
			_, sourcePathID1 = createFileServer(
				"source-file-server",
				SOURCE_HOST_IPs[0],
				SOURCE_VOLUMES[0],
				ProjectId,
				workerId1,
				headers,
			)

			_, destinationPathID1 = createFileServer(
				"destination-file-server",
				DESTINATION_HOST_IPs[0],
				DESTINATION_VOLUMES[0],
				ProjectId,
				workerId1,
				headers,
			)

			// --- Trigger migration only once ---
			if migrationConfigID == "" {
				By("Creating initial migration job (only once)")
				migrationParams := MigrationJobParams{
					FirstRunAt:         GetCurrentUTCTimestamp(),
					SourcePathIDs:      []string{sourcePathID1},
					DestinationPathIDs: []string{destinationPathID1},
					SidMapping:         false,
					Options: map[string]interface{}{
						"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
						"preserveAccessTime":  true,
						"skipFile":            "0-M",
					},
				}

				migrationJobConfigIDs, resp, err := CreateMigrationJob(migrationParams, headers)
				Expect(err).NotTo(HaveOccurred(), "failed to create migration job")
				_ = resp.Body.Close()

				migrationConfigID = migrationJobConfigIDs[0]
				Expect(migrationConfigID).NotTo(BeEmpty(), "migration config ID should not be empty")

				// Wait for the initial migration to complete
				getJobsResp, resp, err := GetJobRunDetails(migrationConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "failed to get job run details")
				_ = resp.Body.Close()

				jobRunID := getJobsResp.JobRuns[0].JobRunId
				Expect(jobRunID).NotTo(BeEmpty(), "job run ID should not be empty")

				err = WaitForJobState(jobRunID, COMPLETED_JOBRUN)
				Expect(err).NotTo(HaveOccurred(), "initial migration job did not complete")
			}
		})

		It("TC-001: Run performance packs with same migration config", func() {
			By("########################## TC-001 start ################################")

			// Run performance test packs
			packTimings := runPerformancePacks(migrationConfigID, headers)

			// Print timings
			for pack, times := range packTimings {
				fmt.Printf("%s: %v\n", pack, times)
			}

			By("########################## TC-001 end ################################")
		})

		AfterEach(func() {
			By("Cleanup started")
			err := StopAllWorkersAndWait()
			Expect(err).NotTo(HaveOccurred(), "error stopping workers")
			LogDebug("Cleanup completed")
		})
	})
})

// --- Helpers ---

func createFileServer(name, host, volume, projectId, workerId string, headers map[string]string) (string, string) {
	params := CreateServereParams{
		ConfigName:       name,
		ConfigType:       ConfigTypeFile,
		ProjectID:        projectId,
		ServerType:       ServerTypeOtherNAS,
		UserName:         PROTOCOL_USERNAME,
		Password:         PROTOCOL_PASSWORD,
		Protocol:         PROTOCOL_TYPE,
		ProtocolVersion:  ProtocolVersion3,
		Host:             host,
		Workers:          []string{workerId},
		WorkingDirectory: "",
	}

	By(fmt.Sprintf("Creating File Server: %s", host))
	configID, resp, err := CreateFileServer(params, headers)
	Expect(err).NotTo(HaveOccurred(), "failed to create file server")
	Expect(configID).NotTo(BeEmpty(), "configID is empty")
	Expect(resp.StatusCode).To(Equal(http.StatusOK), "expected HTTP 200 OK")
	_ = resp.Body.Close()

	pathID, err := GetExportPathID(name, volume, configID, headers)
	Expect(err).NotTo(HaveOccurred(), "failed to get export path ID")
	LogDebug(fmt.Sprintf("%s File Server Export Path ID: [%s]", name, pathID))

	return configID, pathID
}

func runPerformancePacks(migrationConfigID string, headers map[string]string) map[string][]int {
	packTimings := make(map[string][]int)

	for pack := 1; pack <= numPacks; pack++ {
		packName := fmt.Sprintf("perf_pack%d", pack)
		var timings []int
		// script
		// Only trigger ad-hoc runs (reuse migrationConfigID)
		for run := 1; run < migrationsPerPack; run++ {
			By(fmt.Sprintf("Starting migration %d in %s", run, packName))
			start := time.Now()

			jobRunID, _, err := TriggerAdHocJobRun(migrationConfigID)
			Expect(err).NotTo(HaveOccurred(), "failed to trigger ad-hoc job run")

			err = WaitForJobState(jobRunID, COMPLETED_JOBRUN)
			Expect(err).NotTo(HaveOccurred(), "ad-hoc migration job did not complete")

			// small delay between runs

			duration := int(time.Since(start).Seconds())
			if duration == 0 {
				duration = 1
			}
			timings = append(timings, duration)
			By(fmt.Sprintf("Migration %d in %s took %d seconds", run, packName, duration))
		}

		packTimings[packName] = timings
		// clearVolumer(destinationPathID1)
	}

	return packTimings
}

// package performance_testing

// import (
// 	"fmt"
// 	. "ndm-api-tests/utils"
// 	"net/http"
// 	"time"

// 	. "github.com/onsi/ginkgo/v2"
// 	. "github.com/onsi/gomega"
// )

// var _ = Describe("TC-PERFORMACNCE-TEST", func() {
// 	var (
// 		ProjectId string
// 		workerId1 string
// 		workerIds []string
// 		err       error
// 		// destinationVolumePath1 string
// 		headers               map[string]string
// 		attachedWorkersConfig map[string]SSHConfig
// 	)

// 	Context("TC-001", func() {
// 		BeforeEach(func() {
// 			numberOfWorker := 1
// 			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
// 			fmt.Println("Attached Workers Config:", attachedWorkersConfig)
// 			Expect(err).To(BeNil(), "Error during test environment setup")
// 			Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 1), "Expected 1 workers to be attached")

// 			workerIds = GetWorkerIds()
// 			workerId1 = workerIds[0]
// 			headers = GetHeaders(AuthToken, ContentTypeJSON)
// 			// destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], DESTINATION_VOLUMES[0])
// 		})

// 		It("TC-001: Create file servers and run performance packs", func() {
// 			By("########################## TC-001 start ################################")

// 			// ----- Create Source File Server -----
// 			sourceParams := CreateServereParams{
// 				ConfigName:       "source-file-server",
// 				ConfigType:       ConfigTypeFile,
// 				ProjectID:        ProjectId,
// 				ServerType:       ServerTypeOtherNAS,
// 				UserName:         PROTOCOL_USERNAME,
// 				Password:         PROTOCOL_PASSWORD,
// 				Protocol:         PROTOCOL_TYPE,
// 				ProtocolVersion:  ProtocolVersion3,
// 				Host:             SOURCE_HOST_IPs[0],
// 				Workers:          []string{workerId1},
// 				WorkingDirectory: "",
// 			}

// 			By(fmt.Sprintf("Creating Source File Server : %s", SOURCE_HOST_IPs[0]))
// 			sourceConfigID, resp, err := CreateFileServer(sourceParams, headers)
// 			Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
// 			Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")
// 			defer resp.Body.Close()
// 			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

// 			By("Getting the Source File Server Export Path ID")
// 			sourcePathID1, err := GetExportPathID("source", SOURCE_VOLUMES[0], sourceConfigID, headers)
// 			fmt.Println("Source Path ID 1:", sourcePathID1)
// 			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
// 			LogDebug(fmt.Sprintf("Source File Server Export Path ID : [%s]", sourcePathID1))

// 			// ----- Create Destination File Server -----
// 			By(fmt.Sprintf("Creating Destination File Server : %s", DESTINATION_HOST_IPs[0]))
// 			destinationParams := CreateServereParams{
// 				ConfigName:       "destination-file-server",
// 				ConfigType:       ConfigTypeFile,
// 				ProjectID:        ProjectId,
// 				ServerType:       ServerTypeOtherNAS,
// 				UserName:         PROTOCOL_USERNAME,
// 				Password:         PROTOCOL_PASSWORD,
// 				Protocol:         PROTOCOL_TYPE,
// 				ProtocolVersion:  ProtocolVersion3,
// 				Host:             DESTINATION_HOST_IPs[0],
// 				Workers:          []string{workerId1},
// 				WorkingDirectory: "",
// 			}

// 			destinationConfigID, resp, err := CreateFileServer(destinationParams, headers)
// 			Expect(err).NotTo(HaveOccurred(), "Error sending create destination file server API request")
// 			Expect(destinationConfigID).NotTo(BeEmpty(), "destinationConfigID is empty")
// 			defer resp.Body.Close()
// 			Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

// 			By("Getting the Destination File Server Export Path ID")
// 			destinationPathID1, err := GetExportPathID("destination", DESTINATION_VOLUMES[0], destinationConfigID, headers)
// 			fmt.Println("Destination Path ID 1:", destinationPathID1)
// 			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error while getting export path, err : %s", err))
// 			LogDebug(fmt.Sprintf("Destination File Server Export Path ID : [%s]", destinationPathID1))

// 			// ----- Performance Packs -----
// 			const numPacks = 5
// 			const migrationsPerPack = 5
// 			packTimings := make(map[string][]int)

// 			for pack := 1; pack <= numPacks; pack++ {
// 				packName := fmt.Sprintf("perf_pack%d", pack)
// 				var timings []int

// 				migrationParams := MigrationJobParams{
// 					FirstRunAt:         GetCurrentUTCTimestamp(),
// 					FutureRunSchedule:  "",
// 					SourcePathIDs:      []string{sourcePathID1},
// 					DestinationPathIDs: []string{destinationPathID1},
// 					SidMapping:         false,
// 					Options: map[string]interface{}{
// 						"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
// 						"preserveAccessTime":  true,
// 						"skipFile":            "0-M",
// 					},
// 				}
// 				migrationJobConfigIDs, resp, err := CreateMigrationJob(migrationParams, headers)
// 				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error creating migration job: %v", err))
// 				defer resp.Body.Close()
// 				fmt.Println("Migration Job Config IDs:", migrationJobConfigIDs)
// 				getJobsResp, resp, err := GetJobRunDetails(migrationJobConfigIDs[0], headers)
// 				Expect(err).NotTo(HaveOccurred(), "Error getting migration job run ID")
// 				defer resp.Body.Close()
// 				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")

// 				migrationJobRunID := getJobsResp.JobRuns[0].JobRunId
// 				Expect(migrationJobRunID).NotTo(BeEmpty(), "Migration JobRun ID should not be empty")

// 				err = WaitForJobState(migrationJobRunID, COMPLETED_JOBRUN)
// 				Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")

// 				for run := 1; run < migrationsPerPack; run++ {
// 					By(fmt.Sprintf("Starting migration %d in %s", run, packName))
// 					start := time.Now()

// 					// Create Migration Job

// 					jobRunID, _, err := TriggerAdHocJobRun(migrationJobConfigIDs[0])
// 					Expect(err).NotTo(HaveOccurred(), "Error triggering ad-hoc job run")

// 					err = WaitForJobState(jobRunID, COMPLETED_JOBRUN)
// 					Expect(err).NotTo(HaveOccurred(), "Migration job did not complete")
// 					// cleanup after migration
// 					// err = ClearVolume(destinationVolumePath1)
// 					// Expect(err).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath1)
// 					Wait(10)

// 					// Get Job Run ID & Wait

// 					// Record timing
// 					duration := time.Since(start)
// 					minutes := int(duration.Minutes())
// 					if minutes == 0 {
// 						minutes = 1
// 					}
// 					timings = append(timings, minutes)
// 					By(fmt.Sprintf("Migration %d in %s took %d minutes", run, packName, minutes))
// 				}

// 				packTimings[packName] = timings
// 			}

// 			// Print timings
// 			for pack, times := range packTimings {
// 				fmt.Printf("%s: %v\n", pack, times)
// 			}

// 			By("########################## TC-001 end ################################")
// 		})

// 		AfterEach(func() {
// 			By("Cleanup started")
// 			fmt.Println("Cleanup started")
// 			err := StopAllWorkersAndWait()
// 			Expect(err).NotTo(HaveOccurred(), "Error stopping workers")

// 			// err = ClearVolume(destinationVolumePath1)
// 			// Expect(err).NotTo(HaveOccurred(), "Error clearing volume of %s", destinationVolumePath1)

// 			// err = CleanupTestEnv()
// 			// Expect(err).To(BeNil(), "Error during test environment cleanup")
// 			LogDebug("Cleanup completed")
// 		})
// 	})
// })

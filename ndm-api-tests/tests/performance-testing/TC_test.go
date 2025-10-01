package performance_testing

import (
	"encoding/csv"
	"fmt"
	"math"
	. "ndm-api-tests/utils"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

const (
	NUMBER_OF_PACKS     = 5
	MIGRATIONS_PER_PACK = 5
	DATASET_SIZE        = "188.13 MiB"
)

var CSV_REPORT_HEADERS = []string{"Pack", "Worker-Host", "Protocol", "Source-FileServer", "Destination-FileServer",
	"Source-Path", "Destination-Path", "Job-Run-ID", "Dataset-Size",
	"MAX_WRITE_CONCURRENCY", "JOB_TASK_ACTIVITY_CONCURRENCY", "MAX_BUFFER_SIZE (MiB)",
	"Migration-Duration", "Line-Rate", "Worker-Downtime", "Worker-Max-CPU-Usage"}

var PERF_PACK_CONFIG = map[int]map[string]int{
	1: {
		"MAX_WRITE_CONCURRENCY":         10,
		"JOB_TASK_ACTIVITY_CONCURRENCY": 20,
		"MAX_BUFFER_SIZE":               OneMB,
	},
	2: {
		"MAX_WRITE_CONCURRENCY":         30,
		"JOB_TASK_ACTIVITY_CONCURRENCY": 40,
		"MAX_BUFFER_SIZE":               ThreeMB,
	},
	3: {
		"MAX_WRITE_CONCURRENCY":         50,
		"JOB_TASK_ACTIVITY_CONCURRENCY": 60,
		"MAX_BUFFER_SIZE":               FiveMB,
	},
	4: {
		"MAX_WRITE_CONCURRENCY":         70,
		"JOB_TASK_ACTIVITY_CONCURRENCY": 80,
		"MAX_BUFFER_SIZE":               SevenMB,
	},
	5: {
		"MAX_WRITE_CONCURRENCY":         100,
		"JOB_TASK_ACTIVITY_CONCURRENCY": 100,
		"MAX_BUFFER_SIZE":               TenMB,
	},
}

var _ = Describe("TC-PERFORMANCE-TEST", func() {
	var (
		ProjectId              string
		workerId1              string
		headers                map[string]string
		err                    error
		jobRunID               string
		resp                   *http.Response
		migrationConfigID      string
		sourcePathID1          string
		destinationPathID1     string
		destinationVolumePath1 string
		migrationParams        MigrationJobParams
	)

	Context("TC-001", func() {
		BeforeEach(func() {
			numberOfWorker := 1
			var attachedWorkersConfig map[string]SSHConfig
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
			Expect(err).To(BeNil(), "error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(Equal(1), "expected 1 worker to be attached")

			// Send  CPU monitoring script to worker
			err = scpCPUMonitoringScript()
			Expect(err).To(BeNil(), "error during sending CPU monitoring script to worker")

			workerIds := GetWorkerIds()
			workerId1 = workerIds[0]

			headers = GetHeaders(AuthToken, ContentTypeJSON)

			destinationVolumePath1 = fmt.Sprintf("%s:%s", DESTINATION_HOST_IPs[0], DESTINATION_VOLUMES[0])

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

			// --- Trigger migration job only once ---
			migrationParams = MigrationJobParams{
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
		})

		It("TC-001: Run performance packs with same migration config", func() {
			By("########################## TC-001 start Perf Test ################################")
			for packNumb := 1; packNumb <= NUMBER_OF_PACKS; packNumb++ {
				err = UpdateWorkerEnvAndRestart(PERF_PACK_CONFIG[packNumb]["MAX_WRITE_CONCURRENCY"], PERF_PACK_CONFIG[packNumb]["JOB_TASK_ACTIVITY_CONCURRENCY"],
					PERF_PACK_CONFIG[packNumb]["MAX_BUFFER_SIZE"])
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("failed to update worker env, pack=%d, err = %v", packNumb, err))

				for run := 1; run <= MIGRATIONS_PER_PACK; run++ {
					var maxCPUUsageInPercentage string
					if migrationConfigID == "" {
						migrationJobConfigIDs, resp, err := CreateMigrationJob(migrationParams, headers)
						Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("failed to create migration job, pack=%d, iteration=%d", packNumb, run))
						_ = resp.Body.Close()

						migrationConfigID = migrationJobConfigIDs[0]
						Expect(migrationConfigID).NotTo(BeEmpty(), fmt.Sprintf("migration config ID should not be empty, pack=%d, iteration=%d", packNumb, run))

						// Wait for the initial migration to complete
						getJobsResp, resp, err := GetJobRunDetails(migrationConfigID, headers)
						Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("failed to get job run details, pack=%d, iteration=%d", packNumb, run))
						_ = resp.Body.Close()

						jobRunID = getJobsResp.JobRuns[0].JobRunId
						Expect(jobRunID).NotTo(BeEmpty(), fmt.Sprintf("job run ID should not be empty, pack=%d, iteration=%d", packNumb, run))
					} else {
						jobRunID, resp, err = TriggerAdHocJobRun(migrationConfigID)
						Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("failed to trigger ad-hoc job run, pack=%d, iteration=%d", packNumb, run))
						_ = resp.Body.Close()
					}

					// Start CPU monitoring before waiting for job to complete
					err = startCPUMonitoring(jobRunID)
					Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("failed to start CPU monitoring, pack=%d, iteration=%d", packNumb, run))

					isMigrationCompleted := make(chan struct{})
					workerDownTimeSec := 0
					go getWorkerDowntime(isMigrationCompleted, &workerDownTimeSec, &maxCPUUsageInPercentage)

					err = WaitForJobState(jobRunID, COMPLETED_JOBRUN)
					Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("migration job did not complete, pack=%d, iteration=%d", packNumb, run))

					// capture final CPU usage spikes
					if PROTOCOL_TYPE == ProtocolNFS {
						maxCPUUsageInPercentage, err = GetMaxCPUUsageReport(jobRunID)
						Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("failed to get max CPU usage report, pack=%d, iteration=%d, err = %v", packNumb, run, err))
					}

					isMigrationCompleted <- struct{}{}

					err = ClearVolume(destinationVolumePath1)
					Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("Error clearing destination volume, pack=%d, iteration=%d, err = %v", packNumb, run, err))

					jobRunInfo, err := GetJobRunInfo(jobRunID)
					Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("failed to get job run info, pack=%d, iteration=%d", packNumb, run))

					migrationDuration, lineRate, err := getMigrationDurationAndLineRate(jobRunInfo.StartTime, jobRunInfo.EndTime, workerDownTimeSec)
					Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("failed to get migration duration and line rate, pack=%d, iteration=%d, err = %v", packNumb, run, err))

					workerDownTimeMin := float64(workerDownTimeSec) / float64(60)

					err = appendRowsToPerfCSV(packNumb, jobRunID, migrationDuration, lineRate, maxCPUUsageInPercentage, workerDownTimeMin)
					Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("failed to write report to perf csv, pack=%d, iteration=%d, err = %v", packNumb, run, err))

					// Stop CPU monitoring after getting the report
					err = StopCPUMonitoring()
					Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("failed to stop CPU monitoring, pack=%d, iteration=%d", packNumb, run))
				}
				// empty rows
				appendRowsToPerfCSV(0, "", "", "", "", 0.0, 2)
			}
			By("########################## TC-001 end ################################")
		})

		AfterEach(func() {
			By("Cleanup started")
			err := StopAllWorkersAndWait()
			Expect(err).NotTo(HaveOccurred(), "error stopping workers")

			err = UpdateWorkerEnvAndRestart(PERF_PACK_CONFIG[1]["MAX_WRITE_CONCURRENCY"], PERF_PACK_CONFIG[1]["JOB_TASK_ACTIVITY_CONCURRENCY"],
				PERF_PACK_CONFIG[1]["MAX_BUFFER_SIZE"])
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("failed to reset worker env, err = %v", err))

			err = ClearVolume(destinationVolumePath1)
			Expect(err).To(BeNil(), "Error during clearing destination volume")

			err = CleanupTestEnv()
			Expect(err).To(BeNil(), "Error during test environment cleanup")

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

func parseSize(datasetSize string) (float64, string, error) {
	parts := strings.Fields(datasetSize)
	if len(parts) != 2 {
		return 0, "", fmt.Errorf("invalid format: %s", datasetSize)
	}

	valueStr := parts[0]
	unit := parts[1]

	value, err := strconv.ParseFloat(valueStr, 64)
	if err != nil {
		return 0, "", fmt.Errorf("invalid number: %s", valueStr)
	}

	if unit != "MiB" && unit != "GiB" {
		return 0, "", fmt.Errorf("unsupported unit: %s", unit)
	}

	return value, unit, nil
}

func getMigrationDurationAndLineRate(startTime, endTime string, workerDownTimeSec int) (string, string, error) {
	start, err := time.Parse(time.RFC3339Nano, startTime)
	if err != nil {
		return "", "", err
	}
	end, err := time.Parse(time.RFC3339Nano, endTime)
	if err != nil {
		return "", "", err
	}

	duration := end.Sub(start).Seconds()

	diff := end.Sub(start)

	hours := int(diff.Hours())
	minutes := int(math.Mod(diff.Minutes(), 60))

	size, unit, err := parseSize(DATASET_SIZE)
	if err != nil {
		return "", "", err
	}

	lineRate := size / duration

	return fmt.Sprintf("%dh%02dmin", hours, minutes), fmt.Sprintf("%.4f %s/sec", lineRate, unit), nil
}

func appendRowsToPerfCSV(packNumb int, jobRunID, migrationDuration, lineRate, maxCPUUsage string, workerDownTimeMin float64, emptyRowsNumb ...int) error {
	var perf_report_file = fmt.Sprintf("../../%s_perf_report_%d.csv", PROTOCOL_TYPE, time.Now().Unix())

	_, err := os.Stat(perf_report_file)
	fileExists := err == nil

	file, err := os.OpenFile(perf_report_file, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	if !fileExists {
		if err := writer.Write(CSV_REPORT_HEADERS); err != nil {
			return err
		}
	}

	if len(emptyRowsNumb) != 0 {
		emptyRow := make([]string, len(CSV_REPORT_HEADERS))
		for i := 0; i < emptyRowsNumb[0]; i++ {
			if err := writer.Write(emptyRow); err != nil {
				return err
			}
		}

		return nil
	}

	newRows := [][]string{
		{
			strconv.Itoa(packNumb), GetAttachedWorkerDetails().Host, string(PROTOCOL_TYPE), SOURCE_HOST_IPs[0], DESTINATION_HOST_IPs[0],
			SOURCE_VOLUMES[0], DESTINATION_VOLUMES[0], jobRunID, DATASET_SIZE,
			strconv.Itoa(PERF_PACK_CONFIG[packNumb]["MAX_WRITE_CONCURRENCY"]),
			strconv.Itoa(PERF_PACK_CONFIG[packNumb]["JOB_TASK_ACTIVITY_CONCURRENCY"]),
			strconv.Itoa(PERF_PACK_CONFIG[packNumb]["MAX_BUFFER_SIZE"]),
			migrationDuration, lineRate, fmt.Sprintf("%.4f mins", workerDownTimeMin),
			maxCPUUsage,
		},
	}

	for _, row := range newRows {
		if err := writer.Write(row); err != nil {
			return err
		}
	}

	return nil
}

func getWorkerDowntime(stop chan struct{}, workerDownTimeSec *int, maxCPUUsageInPercentage *string) {
	ticker := time.NewTicker(5 * time.Second)

	for {
		select {
		case <-ticker.C:
			isRunning, err := IsWorkerRunning()
			if !isRunning || err != nil {
				*workerDownTimeSec = *workerDownTimeSec + 5
			}

			// CPU monitoring for SMB
			currentPercentage, err := GetMaxCPUUsageReport("")
			if err == nil && currentPercentage > *maxCPUUsageInPercentage {
				*maxCPUUsageInPercentage = currentPercentage
			}

		case <-stop:
			return
		}
	}
}

func scpCPUMonitoringScript() error {

	var localScriptPath, remoteScriptPath string

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		// TODO - implement for SMB
		// SCP script is done, but running it remotely has quoting issues ref - StartCPUMonitoring()
		return nil
		// localScriptPath = "./smb_cpu_usage.ps1"
		// remoteScriptPath = `c:\Users\datamigrator\smb_cpu_usage.ps1`
	case ProtocolNFS:
		localScriptPath = "./nfs_cpu_usage.sh"
		remoteScriptPath = "/home/ubuntu/nfs_cpu_usage.sh"
	}

	config, err := getWorkerSSHConfig()
	if err != nil {
		return fmt.Errorf("failed to get SSH config: %v", err)
	}

	client, err := getSSHClient(config)
	if err != nil {
		return err // or handle error
	}
	defer client.Close()

	// Start SFTP session
	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return fmt.Errorf("failed to start SFTP: %v", err)
	}
	defer sftpClient.Close()

	// Read local script
	scriptBytes, err := os.ReadFile(localScriptPath)
	if err != nil {
		return fmt.Errorf("failed to read local script: %v", err)
	}

	// Copy script to remote
	remoteFile, err := sftpClient.Create(remoteScriptPath)
	if err != nil {
		return fmt.Errorf("failed to create remote script: %v", err)
	}
	_, err = remoteFile.Write(scriptBytes)
	if err != nil {
		return fmt.Errorf("failed to write remote script: %v", err)
	}
	remoteFile.Close()

	if PROTOCOL_TYPE == ProtocolNFS {
		// Make script executable
		session, err := client.NewSession()
		if err != nil {
			return fmt.Errorf("failed to create SSH session: %v", err)
		}
		defer session.Close()
		chmodCmd := fmt.Sprintf("chmod +x %s", remoteScriptPath)
		if err := session.Run(chmodCmd); err != nil {
			return fmt.Errorf("failed to chmod script: %v", err)
		}
	}

	return nil
}

func startCPUMonitoring(jobID string) error {
	var remoteScriptPath, runScript string

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		// TODO - fix the quoting issue
		//runScript = `powershell.exe -Command 'Start-Process powershell -WindowStyle Hidden -ArgumentList '-File C:\Users\datamigrator\smb_cpu_usage.ps1 OmI23''`
		return nil
	case ProtocolNFS:
		remoteScriptPath = "/home/ubuntu/nfs_cpu_usage.sh"
		runScript = fmt.Sprintf("sudo nohup %s %s > /dev/null 2>&1 &", remoteScriptPath, jobID)
	}

	config, err := getWorkerSSHConfig()
	if err != nil {
		return fmt.Errorf("jobID %s: failed to get SSH config: %v", jobID, err)
	}

	client, err := getSSHClient(config)
	if err != nil {
		return fmt.Errorf("jobID %s: failed to get SSH client: %v", jobID, err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("jobID %s: failed to create SSH session: %v", jobID, err)
	}
	defer session.Close()

	if err := session.Run(runScript); err != nil {
		return fmt.Errorf("jobID %s: failed to run script: %v", jobID, err)
	}

	return nil
}

func getWorkerSSHConfig() (SSHConfig, error) {
	port, err := strconv.Atoi(NDM_WORKERS_PORT)
	if err != nil {
		return SSHConfig{}, fmt.Errorf("invalid port number in NDM_WORKERS_PORT: %v", err)
	}
	return SSHConfig{
		Username: NDM_WORKERS_USER_NAME,
		Host:     NDM_WORKERS_HOST,
		Port:     port,
		Password: NDM_WORKERS_PASSWORD,
	}, nil
}

// getSSHClient returns an SSH client connected to the VM.
func getSSHClient(sshConfig SSHConfig) (*ssh.Client, error) {
	config := &ssh.ClientConfig{
		User: sshConfig.Username,
		Auth: []ssh.AuthMethod{
			ssh.Password(sshConfig.Password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	address := fmt.Sprintf("%s:%d", sshConfig.Host, sshConfig.Port)
	client, err := ssh.Dial("tcp", address, config)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to SSH server: %w", err)
	}
	return client, nil
}

package tests

import (
	"fmt"
	. "ndm-api-tests/utils"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("RTC-001-002: Check worker status when worker goes down/becomes unhealthy", func() {
	// Removed unused variable headers
	var (
		ProjectId             string
		workerId1             string
		workerIds             []string
		err                   error
		attachedWorkersConfig map[string]SSHConfig
	)
	Context("RTC-001-002", func() {
		BeforeEach(func() {
			var ProjectName string
			NumberOfWorker := 1
			ProjectId, ProjectName, attachedWorkersConfig, err = SetupTestEnv(NumberOfWorker)
			_ = ProjectName
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).To(Equal(1), "Expected two worker to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
		})

		It("RTC-001-002: Check worker status when worker goes down/becomes unhealthy", func() {
			By("########################## RTC-001-002 start ################################")

			for {
				workerIdWithStatus, err := GetWorkerStatus(ProjectId, []string{workerId1})
				Expect(err).NotTo(HaveOccurred(), "Error getting worker status")
				if workerIdWithStatus[workerId1] == "Online" {
					break
				}
				By(fmt.Sprintf("Worker %s status: %s. Retrying...", workerId1, workerIdWithStatus[workerId1]))
				Wait(5)
			}

			// Detach the worker to simulate going down
			By(fmt.Sprintf("Detaching worker: %s", workerId1))

			_, err = StopWorker(attachedWorkersConfig[workerId1])
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error detaching worker : %s ", workerId1))

			//waiting for worker to go offline
			Wait(WORKER_TIMEOUT)

			workerIdWithStatus, err := GetWorkerStatus(ProjectId, []string{workerId1})
			Expect(err).NotTo(HaveOccurred(), "Error getting worker status")
			Expect(workerIdWithStatus[workerId1]).To(Equal("Offline"),
				fmt.Sprintf("Worker %s should be offline but is %s", workerId1, workerIdWithStatus[workerId1]))

			_, err = StartWorker(attachedWorkersConfig[workerId1])
			Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error detaching worker : %s ", workerId1))
			workerOnline := false
			workerIds := GetWorkerIds()
			for i := 0; i < MaxPollRetries; i++ {
				workerIdWithStatus, err := GetWorkerStatus(ProjectId, workerIds)
				Expect(err).NotTo(HaveOccurred(), fmt.Sprintf("error getting worker status : %s ", workerId1))

				onlineWorkers := 0
				for _, workerId := range workerIds {
					if workerIdWithStatus[workerId] == "Online" {
						onlineWorkers++
					}
				}
				if onlineWorkers == len(workerIds) {

					workerOnline = true
					break
				}
				Wait(DefaultPollInterval)
			}
			Expect(workerOnline).To(BeTrue(), "Worker should be online after starting it again")

			By("########################## RTC-001-002 end ################################")
		})

		AfterEach(func() {
			By("Cleanup started")

		    err := StopAllWorkersAndWait()
			Expect(err).NotTo(HaveOccurred(), "Error stopping workers")
			
			err = CleanupTestEnv()
			Expect(err).To(BeNil(), "Error during test environment cleanup")
			LogDebug("Cleanup complete.")
		})

	})

})

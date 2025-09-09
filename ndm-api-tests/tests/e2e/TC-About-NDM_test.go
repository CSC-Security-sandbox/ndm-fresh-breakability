package tests

import (
	. "ndm-api-tests/utils"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("About NDM - CP, WORKER Versions", func() {
	var (
		headers               map[string]string
		attachedWorkersConfig map[string]SSHConfig
		err                   error
	)

	BeforeEach(func() {
		numberOfWorker := 1
		_, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker, "TC-About-NDM")
		Expect(err).To(BeNil(), "Error during test environment setup")
		Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 1), "Expected 1 workers to be attached")
	})

	Context("About NDM - CP, WORKER Versions ", func() {
		It("should get versions ", func() {
			By("########################## About NDM START ################################")
			By("waiting 15 sec to set worker version on prometheus..")
			Wait(15)
			headers = GetHeaders(AuthToken, ContentTypeJSON)
			abouNDMResp, err := GetVersions(headers)
			Expect(err).To(BeNil())
			// get versions using ssh
			cpVersion, err := GetCPVersion()
			Expect(err).To(BeNil())
			Expect(cpVersion).Should(Not(BeEmpty()), "Expect CP version but got empty")
			workerVersion, err := GetWorkerVersion()
			Expect(err).To(BeNil())
			Expect(workerVersion).Should(Not(BeEmpty()), "Expect Worker version but got empty")

			// Validate versions
			gotWorkerVersion := abouNDMResp.Data.Items.Build.WorkerVersion.Version
			Expect(workerVersion).To(Equal(gotWorkerVersion), "Expected Worker version")
			gotCPVersion := abouNDMResp.Data.Items.Build.ControlPlaneVersion.Version
			Expect(cpVersion).To(Equal(gotCPVersion), "Expected CP version")
			By("########################## About NDM END ################################")
		})
	})

	AfterEach(func() {
		By("Cleanup started")
		err = CleanupTestEnv()
		Expect(err).To(BeNil(), "Error during test environment cleanup")
		By("Cleanup complete.")

	})
})

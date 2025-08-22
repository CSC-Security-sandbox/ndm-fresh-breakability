package tests

import (
	"encoding/json"
	"fmt"
	"io"
	. "ndm-api-tests/utils"
	"net/http"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("About NDM ", func() {
	var (
		projectId             string
		headers               map[string]string
		attachedWorkersConfig map[string]SSHConfig
		workerIds             []string
		err                   error
	)

	BeforeEach(func() {
		numberOfWorker := 1
		projectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
		Expect(err).To(BeNil(), "Error during test environment setup")
		Expect(len(attachedWorkersConfig)).Should(BeNumerically("==", 1), "Expected 1 workers to be attached")
		workerIds = GetWorkerIds()
	})

	Context("About NDM ", func() {
		It("should complete auth operations", func() {
			By("########################## About NDM START ################################")
			// CODE HERE
			By("waiting 30 sec...")
			Wait(30)
			aboutNDMURL := CONFIG_SERVICE_URL + ABOUT_NDM_URL
			resp, err := SendAPIRequest(http.MethodGet, aboutNDMURL, nil, headers)
			Expect(err).To(BeNil())
			fmt.Println("#### GET RESP", resp.StatusCode, err)
			Expect(http.StatusOK).To(Equal(resp.StatusCode))

			bodyBytes, err := io.ReadAll(resp.Body)
			Expect(err).To(BeNil())

			defer resp.Body.Close()

			type AboutNDMResponse struct {
				Data struct {
					Items struct {
						Product struct {
							Name    string `json:"name"`
							Version string `json:"version"`
						} `json:"product"`
						Build struct {
							WorkerVersion struct {
								Version string      `json:"version"`
								Time    interface{} `json:"time"` // Use interface{} to allow null
							} `json:"worker_version"`
							ControlPlaneVersion struct {
								Version string      `json:"version"`
								Time    interface{} `json:"time"` // Use interface{} to allow null
							} `json:"controlPlane_version"`
						} `json:"build"`
						Contact struct {
							Email   string      `json:"email"`
							Phone   interface{} `json:"phone"`   // Use interface{} to allow null
							Website interface{} `json:"website"` // Use interface{} to allow null
						} `json:"contact"`
					} `json:"items"`
				} `json:"data"`
			}

			var abouNDMResp AboutNDMResponse
			err = json.Unmarshal(bodyBytes, &abouNDMResp)
			Expect(err).To(BeNil())

			fmt.Println(" ###### TEST OUTPUT ", GetCPVersion(), GetWorkerVersion())

			fmt.Printf("##### abouNDMResp: %+v, %v, %v", abouNDMResp, projectId, workerIds)

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

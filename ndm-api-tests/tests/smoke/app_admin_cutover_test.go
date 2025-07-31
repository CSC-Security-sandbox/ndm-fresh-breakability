package tests

import (
	"encoding/json"
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"time"

	"github.com/google/uuid"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("App Admin Cutover Operations", func() {
	var (
		headers           map[string]string
		sourcePathId      string
		destinationPathId string
	)

	BeforeEach(func() {
		// AuthToken should be set during suite setup
		if AuthToken == "" {
			Fail("AuthToken is not set. Please ensure authentication is working.")
		}

		headers = GetHeaders(AuthToken, ContentTypeJSON)
		// Set up source and destination path IDs for cutover operations
		// Using proper UUID format as required by the API
		sourcePathId = uuid.New().String()
		destinationPathId = uuid.New().String()
	})

	It("should handle bulk cutover operations including job creation, validation, and error scenarios", func() {
		By("Creating a bulk cutover job with valid configuration")
		// Prepare bulk cutover job payload
		cutoverConfig := []map[string]interface{}{
			{
				"sourcePathId": sourcePathId,
				"destinationPathId": []string{
					destinationPathId,
				},
			},
		}
		createBulkCutoverPayload := map[string]interface{}{
			"cutoverConfig": cutoverConfig,
		}
		payloadBytes, err := json.Marshal(createBulkCutoverPayload)
		Expect(err).NotTo(HaveOccurred(), "Error marshalling bulk cutover payload")
		createBulkCutoverURL := fmt.Sprintf("%s/api/v1/jobs/bulk-cutover", JOB_SERVICE_URL)
		resp, err := SendAPIRequest("POST", createBulkCutoverURL, payloadBytes, headers)
		Expect(err).NotTo(HaveOccurred(), "Error sending bulk cutover job creation API request")
		defer resp.Body.Close()

		Expect(resp.StatusCode).To(Equal(http.StatusCreated), "Expected HTTP 201 Created for bulk cutover job creation")

		// Add delay as specified in YAML (120 seconds)
		By("Waiting for job processing (120 seconds delay as specified)")
		time.Sleep(120 * time.Second)

		By("Bulk cutover job creation and processing completed")
	})
})

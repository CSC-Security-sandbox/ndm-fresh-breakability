package tests

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	. "ndm-api-tests/utils"
)

var _ = Describe("App Admin Migration", func() {
	var sourcePathId string
	var destinationPathId string
	var jobID interface{}
	var body map[string]interface{}
	var url string
	var bodyBytes []byte
	var resp *http.Response
	var err error

	BeforeEach(func() {
		sourcePathId = uuid.New().String()
		destinationPathId = uuid.New().String()
	})

	AfterEach(func() {
		if jobID != nil {
			deleteUrl := fmt.Sprintf("%s/api/v1/jobs/%v", JOB_SERVICE_URL, jobID)
			headers := GetHeaders(AuthToken, ContentTypeJSON)
			SendAPIRequest("DELETE", deleteUrl, nil, headers)
		}
	})
	Context("app-admin-migration", func() {
		var headers map[string]string

		BeforeEach(func() {
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("create-migration-job", func() {
			By("create-migration-job")
			url = fmt.Sprintf("%s/api/v1/jobs/bulk-migrate", JOB_SERVICE_URL)
			futureTime := time.Now().Add(24 * time.Hour).Format("2006-01-02T15:04:05.000Z")

			body = map[string]interface{}{
				"firstRunAt":        futureTime,
				"futureRunSchedule": "",
				"migrateConfigs": []map[string]interface{}{
					{
						"sourcePathId": sourcePathId,
						"destinationPathId": []string{
							destinationPathId,
						},
					},
				},
				"sid_mapping": false,
				"options": map[string]interface{}{
					"excludeFilePatterns": "*/snapshots/*,*/logs/*,*/tmp/*",
					"preserveAccessTime":  true,
					"skipFile":            "15-M",
				},
			}
			bodyBytes, _ = json.Marshal(body)
			resp, err = SendAPIRequest("POST", url, bodyBytes, headers)
			Expect(err).To(BeNil())
			Expect(resp.StatusCode).To(Equal(http.StatusCreated))

		})
	})
})

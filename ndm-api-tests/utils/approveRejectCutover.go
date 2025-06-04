package utils

import (
	"encoding/json"
	"net/http"

	. "github.com/onsi/gomega"
)

// approveBulkCutoverJob sends an approval (or rejection) action for a bulk cutover job run.
// action should be "APPROVED" or "REJECTED".

func ApproveRejectBulkCutoverJob(jobRunID, action string, headers map[string]string) {
	approveJobURL := JOB_SERVICE_URL + "/api/v1/job-run/cutover/approve"
	approvePayload := map[string]interface{}{
		"action":   action,
		"jobRunId": jobRunID,
	}
	approveBytes, err := json.Marshal(approvePayload)
	Expect(err).NotTo(HaveOccurred(), "Error marshaling approve bulk cutover job payload")
	resp, err := SendAPIRequest("PUT", approveJobURL, approveBytes, headers)
	Expect(err).NotTo(HaveOccurred(), "Error sending approve bulk cutover job request")
	defer resp.Body.Close()
	checkResponse(resp, http.StatusOK)
}

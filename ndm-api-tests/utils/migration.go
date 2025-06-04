package utils

import (
	"encoding/json"
	"io/ioutil"
	"net/http"

	. "github.com/onsi/gomega"
)

type MigrationJobParams struct {
	FirstRunAt         string
	FutureRunSchedule  string
	SourcePathIDs      []string
	DestinationPathIDs []string
	SidMapping         bool
	Options            map[string]interface{}
}

// CreateMigrationJob creates migration jobs for all combinations of source and destination path IDs.
// Returns a slice of jobConfigIDs (even if only one).
func CreateMigrationJob(params MigrationJobParams, headers map[string]string) []string {
	createMigrationURL := JOB_SERVICE_URL + "/api/v1/jobs/bulk-migrate"

	// Build migrateConfigs as a slice of maps for all combinations
	var migrateConfigs []map[string]interface{}
	for _, src := range params.SourcePathIDs {
		for _, dst := range params.DestinationPathIDs {
			migrateConfigs = append(migrateConfigs, map[string]interface{}{
				"sourcePathId":      src,
				"destinationPathId": []string{dst},
			})
		}
	}

	migrationPayload := map[string]interface{}{
		"firstRunAt":        params.FirstRunAt,
		"futureRunSchedule": params.FutureRunSchedule,
		"migrateConfigs":    migrateConfigs,
		"sid_mapping":       params.SidMapping,
		"options":           params.Options,
	}

	payloadBytes, err := json.Marshal(migrationPayload)
	LogError("Error marshaling migration job payload", err)
	Expect(err).NotTo(HaveOccurred(), "Error marshaling migration job payload")

	resp, err := SendAPIRequest("POST", createMigrationURL, payloadBytes, headers)
	LogError("Error sending migration job API request", err)
	Expect(err).NotTo(HaveOccurred(), "Error sending migration job API request")
	defer resp.Body.Close()
	checkResponse(resp, http.StatusCreated)

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	Expect(err).NotTo(HaveOccurred(), "Error reading migration job creation response")

	var migrationResp []map[string]interface{}
	err = json.Unmarshal(bodyBytes, &migrationResp)
	Expect(err).NotTo(HaveOccurred(), "Error unmarshaling migration job creation response")
	Expect(len(migrationResp)).To(BeNumerically(">", 0), "No job config found in response")

	var jobConfigIDs []string
	for _, job := range migrationResp {
		if id, ok := job["id"].(string); ok && id != "" {
			jobConfigIDs = append(jobConfigIDs, id)
		}
	}
	Expect(len(jobConfigIDs)).To(BeNumerically(">", 0), "No valid jobConfigIDs found in response")

	return jobConfigIDs
}

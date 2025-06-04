package utils

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"

	. "github.com/onsi/gomega"
)

type GetServerResponse struct {
	FileServers []struct {
		Volumes []struct {
			ID string `json:"id"`
		} `json:"volumes"`
	} `json:"fileServers"`
}

func GetSourcePathID(volumeType string, volumeName string, configID string, headers map[string]string) string {

	getSourceURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, configID)

	resp, err := SendAPIRequest("GET", getSourceURL, nil, headers)
	LogError("Error sending get-source-file-server API request", err)
	Expect(err).NotTo(HaveOccurred(), "Error sending get source file server API request")
	defer resp.Body.Close()
	checkResponse(resp, http.StatusOK)
	volumeID, err := GetVolumByID(volumeType, volumeName, AuthToken, configID)
	if err != nil {
		fmt.Printf("Error handling volume for '%s': %v\n", "Getting the source file server by config ID", err)
	}
	bodyBytes, err := ioutil.ReadAll(resp.Body)
	Expect(err).NotTo(HaveOccurred(), "Error reading get-source response body")

	var getSourceResp GetServerResponse
	err = json.Unmarshal(bodyBytes, &getSourceResp)
	LogError("Error unmarshaling get-source response", err)
	Expect(err).NotTo(HaveOccurred(), "Error unmarshaling get source response")

	Expect(len(getSourceResp.FileServers)).To(BeNumerically(">", 0), "No fileServers found in source response")
	Expect(len(getSourceResp.FileServers[0].Volumes)).To(BeNumerically(">", 0), "No volumes found for source file server")

	sourcePathID := volumeID

	Expect(sourcePathID).NotTo(BeEmpty(), "sourcePathID is empty")

	return sourcePathID
}

package utils

import (
	"encoding/json"
	"io/ioutil"
	"net/http"

	. "github.com/onsi/gomega"
)

type CreateServerResponse struct {
	ID string `json:"id"`
}

type CreateServereParams struct {
	ConfigName       string
	ConfigType       string
	ProjectID        string
	ServerType       string
	UserName         string
	Password         string
	Protocol         string
	ProtocolVersion  string
	Host             string
	Workers          []string
	WorkingDirectory string
}

func CreateFileServer(params CreateServereParams, headers map[string]string) string {
	createSourceURL := CONFIG_SERVICE_URL + "/api/v1/servers"

	payload := map[string]interface{}{
		"configName": params.ConfigName,
		"configType": params.ConfigType,
		"projectId":  params.ProjectID,
		"fileServers": []map[string]interface{}{
			{
				"serverType":      params.ServerType,
				"userName":        params.UserName,
				"password":        params.Password,
				"protocol":        params.Protocol,
				"protocolVersion": params.ProtocolVersion,
				"host":            params.Host,
				"volumes":         []interface{}{},
				"workers":         params.Workers,
			},
		},
		"workingDirectory": map[string]interface{}{
			"workingDirectory": "",
			"pathId":           nil,
			"pathName":         "",
		},
	}

	payloadBytes, err := json.Marshal(payload)
	LogError("Error marshaling create-source-file-server payload", err)
	Expect(err).NotTo(HaveOccurred(), "Error marshaling create source file server payload")

	resp, err := SendAPIRequest("POST", createSourceURL, payloadBytes, headers)
	LogError("Error sending create-source-file-server API request", err)
	Expect(err).NotTo(HaveOccurred(), "Error sending create source file server API request")
	defer resp.Body.Close()
	checkResponse(resp, http.StatusCreated)

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	Expect(err).NotTo(HaveOccurred(), "Error reading create-source response body")
	var createSourceResp CreateServerResponse
	err = json.Unmarshal(bodyBytes, &createSourceResp)
	LogError("Error unmarshaling create-source response", err)
	Expect(err).NotTo(HaveOccurred(), "Error unmarshaling create source response")

	sourceConfigID := createSourceResp.ID
	Expect(sourceConfigID).NotTo(BeEmpty(), "sourceConfigID is empty")

	return sourceConfigID
}

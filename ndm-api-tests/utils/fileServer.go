package utils

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
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

// CreateFileServer creates a File server with different config details
func CreateFileServer(params CreateServereParams, headers map[string]string) (string, *http.Response, error) {
	createSourceURL := CONFIG_SERVICE_URL + CREATE_FILESERVER_ENDPOINT

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
	if err != nil {
		return "", nil, err
	}

	resp, err := SendAPIRequest(http.MethodPost, createSourceURL, payloadBytes, headers)
	if err != nil {
		return "", nil, err
	}

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return "", resp, err
	}

	var createSourceResp CreateServerResponse
	err = json.Unmarshal(bodyBytes, &createSourceResp)
	if err != nil {
		return "", resp, err
	}

	sourceConfigID := createSourceResp.ID
	return sourceConfigID, resp, nil
}

type GetServerResponse struct {
	FileServers []struct {
		Volumes []struct {
			ID string `json:"id"`
		} `json:"volumes"`
	} `json:"fileServers"`
}

// GetSourcePathID fetches the source file server by config ID, validates the response,
// and returns the first volume ID (sourcePathID)
func GetSourcePathID(
	volumeType string,
	volumeName string,
	configID string,
	headers map[string]string,
) (string, GetServerResponse, error) {
	getSourceURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, configID)

	resp, err := SendAPIRequest(http.MethodGet, getSourceURL, nil, headers)
	if err != nil {
		return "", GetServerResponse{}, err
	}
	defer resp.Body.Close()

	CheckResponse(resp, http.StatusOK)

	volumeID, err := GetVolumeIDByName(volumeType, volumeName, AuthToken, configID)
	if err != nil {
		return "", GetServerResponse{}, fmt.Errorf("error handling volume for '%s': %w", "Getting the source file server by config ID", err)
	}

	bodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return "", GetServerResponse{}, err
	}

	var getSourceResp GetServerResponse
	err = json.Unmarshal(bodyBytes, &getSourceResp)
	if err != nil {
		return "", GetServerResponse{}, err
	}

	sourcePathID := volumeID

	return sourcePathID, getSourceResp, nil
}

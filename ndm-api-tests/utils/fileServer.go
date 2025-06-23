package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"strconv"
)

type Volume struct {
	ID         string `json:"id"`
	VolumePath string `json:"volumePath"`
}

type FileServer struct {
	Volumes []Volume `json:"volumes"`
}

type FileServerInfo struct {
	FileServers []FileServer `json:"fileServers"`
}

type CreateServereParams struct {
	ConfigName       string
	ConfigType       ConfigType
	ProjectID        string
	ServerType       ServerType
	UserName         string
	Password         string
	Protocol         Protocol
	ProtocolVersion  ProtocolVersion
	Host             string
	Workers          []string
	WorkingDirectory string
}

var sshConfig SSHConfig

func init() {
	port, err := strconv.Atoi(NDM_VM_PORT)
	if err != nil {
		LogFatalf("Invalid port number in NDM_VM_PORT: %v", err)
	}

	sshConfig = SSHConfig{
		Username: NDM_VM_USER_NAME,
		Host:     NDM_VM_HOST,
		Port:     port,
		Password: NDM_VM_PASSWORD,
	}
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

	// Internal struct for unmarshalling response
	type fileServerID struct {
		ID string `json:"id"`
	}
	var createFileServerResp fileServerID
	err = json.Unmarshal(bodyBytes, &createFileServerResp)
	if err != nil {
		return "", resp, err
	}

	return createFileServerResp.ID, resp, nil
}

// GetSourcePathID fetches the source file server by Volume Name, validates the response,
// and returns the first volume ID (sourcePathID)
func GetExportPathID(
	volumeType string,
	volumeName string,
	configID string,
	headers map[string]string,
) (string, error) {
	getSourceURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, configID)
	// Calling this API because the export path is sometimes not retrieved without first hitting the refresh URL.
	refreshURL := fmt.Sprintf("%s%s/%s", CONFIG_SERVICE_URL, FILE_SERVER_REFRESH_URL, configID)

	var getSourceResp FileServerInfo
	var resp *http.Response
	var err error

	for attempt := 1; attempt <= MaxPollRetries; attempt++ {
		resp, err = SendAPIRequest(http.MethodGet, refreshURL, nil, headers)
		resp, err = SendAPIRequest(http.MethodGet, getSourceURL, nil, headers)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()

		bodyBytes, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return "", err
		}

		err = json.Unmarshal(bodyBytes, &getSourceResp)
		if err != nil {
			return "", err
		}

		// Check if volumes exist
		if len(getSourceResp.FileServers) > 0 && len(getSourceResp.FileServers[0].Volumes) > 0 {
			break // Volumes found, proceed
		}

		if attempt < MaxPollRetries {
			IntroduceDelay(DefaultPollInterval) // Wait before retrying
		}
	}

	// After retries, check again
	if len(getSourceResp.FileServers) == 0 {
		return "", fmt.Errorf("no fileServers found in source response after %d attempts", MaxPollRetries)
	}
	if len(getSourceResp.FileServers[0].Volumes) == 0 {
		return "", fmt.Errorf("no volumes found for source file server after %d attempts", MaxPollRetries)
	}

	// Now fetch the volume ID
	volumeID, err := GetVolumeIDByName(volumeName, AuthToken, configID)
	if err != nil {
		return "", fmt.Errorf("error handling volume for '%s': %w", "Getting the source file server by config ID", err)
	}
	if volumeID == "" {
		return "", fmt.Errorf("expected a valid sourcePathID, got empty string")
	}

	sourcePathID := volumeID

	return sourcePathID, nil
}

// ClearVolume removes all data from the NFS export mounted on the VM.
func ClearVolume(export string) error {
	destMount := "/mnt/remove_data"

	script := fmt.Sprintf(`
	set -e
	sudo mkdir -p "%s"
	sudo mount -t nfs "%s" "%s"
	sudo rm -rf "%s"/*
	sudo umount "%s"
	sudo rm -rf "%s"
	`, destMount, export, destMount, destMount, destMount, destMount)

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("RemoveDataFromFileserver failed: %w\noutput: %s", err, output)
	}
	return nil
}

// AddDataToVolume creates a delta directory with 100 text files of 100KB each,
func AddDataToVolume(export string) error {
	destMount := "/mnt/data_tmp"
	deltaDir := "/" + DeltaFolder

	script := fmt.Sprintf(`
	set -e

	# Clean up any previous run
	sudo rm -rf "%s"
	sudo rm -rf "%s"

	# Create delta directory and generate 100 txt files of 100KB each
	sudo mkdir -p "%s"
	for i in $(seq -w 1 100); do
		sudo dd if=/dev/urandom of="%s/file${i}.txt" bs=100K count=1 status=none
	done

	# Mount export NFS export
	sudo mkdir -p "%s"
	sudo mount -t nfs "%s" "%s"

	# Copy delta to the mounted export
	sudo cp -a "%s" "%s/"

	# Unmount and cleanup
	sudo umount "%s"
	sudo rm -rf "%s"
	sudo rm -rf "%s"
	`, deltaDir, destMount, deltaDir, deltaDir, destMount, export, destMount, deltaDir, destMount, destMount, deltaDir, destMount)

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("AddDataToFileserver failed: %w\noutput: %s", err, output)
	}
	return nil
}

// RemoveDeltaFromVolume removes the delta directory from the NFS export mounted on the VM.
func RemoveDeltaFromVolume(export string) error {
	destMount := "/mnt/data_tmp"

	script := fmt.Sprintf(`
	set -e

	# Clean up any previous run
	sudo rm -rf "%s"

	# Mount export NFS export
	sudo mkdir -p "%s"
	sudo mount -t nfs "%s" "%s"

	# Remove delta directory if it exists in the export
	if [ -d "%s/%s" ]; then
		sudo rm -rf "%s/%s"
	fi

	# Unmount and cleanup
	sudo umount "%s"
	sudo rm -rf "%s"
	`, destMount, destMount, export, destMount, destMount, DeltaFolder, destMount, DeltaFolder, destMount, destMount)

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("RemoveDeltaFromFileserver failed: %w\noutput: %s", err, output)
	}
	return nil
}

func GetVolumeID(response FileServerInfo, volumePath string) (string, error) {
	for _, fileServer := range response.FileServers {
		for _, volume := range fileServer.Volumes {
			if volume.VolumePath == volumePath {
				fmt.Printf("ID of the volume with path '%s': %s\n", volumePath, volume.ID)
				return volume.ID, nil // Return the found ID and no error
			}
		}
	}
	// If no volume is found, return an error
	return "", fmt.Errorf("no volume found with path '%s'", volumePath)
}

func GetVolumeIDByName(volumeName, authToken, configId string) (string, error) {
	// Build the full URL
	fullURL := fmt.Sprintf("%s/api/v1/servers/%s", JOB_SERVICE_URL, configId)
	var reqBody []byte

	// Get extra headers
	headers := GetHeaders(authToken, ContentTypeForm)
	// Send the API request
	resp, err := SendAPIRequest(http.MethodGet, fullURL, reqBody, headers)
	if err != nil {
		return "", fmt.Errorf("error sending API request: %w", err)
	}
	defer resp.Body.Close() // Ensure the response body is closed
	// Read the response body
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("error reading response body: %w", err)
	}

	// Unmarshal the response
	var response FileServerInfo
	err = json.Unmarshal(bodyBytes, &response)
	if err != nil {
		return "", fmt.Errorf("error unmarshalling response: %w", err)
	}

	// Find the volume ID
	foundID, err := GetVolumeID(response, volumeName)
	if err != nil {
		return "", fmt.Errorf("error finding volume ID: %w", err)
	}

	return foundID, nil // Return the found ID and no error
}

package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

type Volume struct {
	ID             string `json:"id"`
	VolumePath     string `json:"volumePath"`
	IsValid        bool   `json:"isValid"`
	IsDisabled     bool   `json:"isDisabled"`
	ReachableCount int    `json:"reachableCount"`
}

type FileServer struct {
	Id               string           `json:"id"`
	Volumes          []Volume         `json:"volumes"`
	ExportPathSource ExportPathSource `json:"exportPathSource"`
	Protocol         Protocol         `json:"protocol"`
	ProtocolVersion  ProtocolVersion  `json:"protocolVersion"`
	ServerType       ServerType       `json:"serverType"`
	Host             string           `json:"host"`
}

type FileServerInfo struct {
	FileServers []FileServer `json:"fileServers"`
}

type ExportPathSource string

const (
	AutoDiscover ExportPathSource = "AUTO_DISCOVER"
	ManualUpload ExportPathSource = "MANUAL_UPLOAD"
)

type FileServerDetails struct {
	ConfigName  string       `json:"configName"`
	ID          string       `json:"id"`
	ConfigType  ConfigType   `json:"configType"`
	ProjectID   string       `json:"projectId"`
	FileServers []FileServer `json:"fileServers"`
	Status      string       `json:"status"`
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
	ExportPathSource *ExportPathSource
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

func PtrExportPathSource(e ExportPathSource) *ExportPathSource {
	return &e
}

// CreateFileServer creates a File server with different config details
func CreateFileServer(params CreateServereParams, headers map[string]string) (string, *http.Response, error) {
	createSourceURL := CONFIG_SERVICE_URL + CREATE_FILESERVER_ENDPOINT

	if params.ExportPathSource == nil {
		defaultSource := AutoDiscover
		params.ExportPathSource = &defaultSource
	}

	payload := map[string]interface{}{
		"configName": params.ConfigName,
		"configType": params.ConfigType,
		"projectId":  params.ProjectID,
		"fileServers": []map[string]interface{}{
			{
				"serverType":       params.ServerType,
				"userName":         params.UserName,
				"password":         params.Password,
				"protocol":         params.Protocol,
				"protocolVersion":  params.ProtocolVersion,
				"host":             params.Host,
				"volumes":          []interface{}{},
				"workers":          params.Workers,
				"exportPathSource": params.ExportPathSource,
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

	bodyBytes, err := io.ReadAll(resp.Body)
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

	for attempt := 1; attempt <= MaxPollRetries; attempt++ {
		resp, err := SendAPIRequest(http.MethodGet, refreshURL, nil, headers)
		if err != nil {
			return "", fmt.Errorf("error refreshing file server: %w", err)
		}
		defer resp.Body.Close()

		resp, err = SendAPIRequest(http.MethodGet, getSourceURL, nil, headers)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()

		bodyBytes, err := io.ReadAll(resp.Body)
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
			Wait(DefaultPollInterval) // Wait before retrying
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

	config := GetAttachedWorkerDetails()

	sshConfig = SSHConfig{
		Username: NDM_VM_USER_NAME,
		Host:     config.Host,
		Port:     config.Port,
		Password: NDM_VM_PASSWORD,
	}

	script := fmt.Sprintf(`
	set -e

	# Clean up any previous mount
	sudo umount -f "%s" 2>/dev/null || true
	sudo rm -rf "%s"

	sudo mkdir -p "%s"
	sudo mount -t nfs "%s" "%s"

	# Remove all files, directories, and hidden files
	sudo rm -rf "%s"/* "%s"/.[!.]* "%s"/..?*

	# Remove all symlinks (soft links)
	sudo find "%s" -type l -exec rm -f {} +

	# Remove all files with more than one hardlink (hard links)
	sudo find "%s" -type f -links +1 -exec rm -f {} +

	sudo umount "%s"
	sudo rm -rf "%s"
`, destMount, destMount,
		destMount, export, destMount,
		destMount, destMount, destMount,
		destMount,
		destMount,
		destMount, destMount)

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("RemoveDataFromFileserver failed: %w\noutput: %s", err, output)
	}
	return nil
}

// AddDataToVolume creates a delta directory with 100 text files of 100KB each,
func AddDataToVolume(export string) error {

	config := GetAttachedWorkerDetails()

	sshConfig = SSHConfig{
		Username: NDM_VM_USER_NAME,
		Host:     config.Host,
		Port:     config.Port,
		Password: NDM_VM_PASSWORD,
	}
	destMount := "/mnt/data_add"
	deltaDir := "/" + DeltaFolder

	script := fmt.Sprintf(`
set -e

# Clean up any previous run
sudo rm -rf "%s"
sudo rm -rf "%s"

# Create delta directory and generate 100 txt files of 100KB each
sudo mkdir -p "%s"
for i in $(seq -w 1 100); do
	sudo dd if=/dev/zero of="%s/file${i}.txt" bs=100K count=1 status=none
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
	config := GetAttachedWorkerDetails()

	sshConfig = SSHConfig{
		Username: NDM_VM_USER_NAME,
		Host:     config.Host,
		Port:     config.Port,
		Password: NDM_VM_PASSWORD,
	}
	destMount := "/mnt/data_remove"

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

// ModifyDataOnVolume appends lines to the text files in the NFS export mounted on the VM.
func ModifyDataOnVolume(export string) error {
	config := GetAttachedWorkerDetails()
	sshConfig = SSHConfig{
		Username: NDM_VM_USER_NAME,
		Host:     config.Host,
		Port:     config.Port,
		Password: NDM_VM_PASSWORD,
	}
	destMount := "/mnt/data_modify"

	// Lines to append
	appendLines := "\n# MODIFIED LINE 1\n# MODIFIED LINE 2\n"

	script := fmt.Sprintf(`
    set -e

    # Mount export NFS export
    sudo mkdir -p "%s"
    sudo mount -t nfs "%s" "%s"

    # Append lines to each file
    echo "%s" | sudo tee -a "%s/modify1.text" > /dev/null
    echo "%s" | sudo tee -a "%s/modify2.text" > /dev/null
    echo "%s" | sudo tee -a "%s/modify3.text" > /dev/null

    # Unmount and cleanup
    sudo umount "%s"
    sudo rm -rf "%s"
    `, destMount, export, destMount,
		appendLines, destMount,
		appendLines, destMount,
		appendLines, destMount,
		destMount, destMount)

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("ModifyDataOnVolume failed: %w\noutput: %s", err, output)
	}
	return nil
}

// RestoreOriginalDataOnVolume removes the appended lines from the text files in the NFS export mounted on the VM.
func RestoreOriginalDataOnVolume(export string) error {
	config := GetAttachedWorkerDetails()
	sshConfig = SSHConfig{
		Username: NDM_VM_USER_NAME,
		Host:     config.Host,
		Port:     config.Port,
		Password: NDM_VM_PASSWORD,
	}
	destMount := "/mnt/data_restore"

	script := fmt.Sprintf(`
    set -e

    # Mount export NFS export
    sudo mkdir -p "%s"
    sudo mount -t nfs "%s" "%s"

    # Empty each file
    sudo truncate -s 0 "%s/modify1.text"
    sudo truncate -s 0 "%s/modify2.text"
    sudo truncate -s 0 "%s/modify3.text"

    # Unmount and cleanup
    sudo umount "%s"
    sudo rm -rf "%s"
    `, destMount, export, destMount,
		destMount,
		destMount,
		destMount,
		destMount, destMount)
	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("RestoreOriginalDataOnVolume failed: %w\noutput: %s", err, output)
	}
	return nil
}

// GetVolumeID retrieves the ID of a volume by its path from the FileServerInfo response.
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

// GetFileUserGroupId mounts the NFS export, stats the given file‐path
// (relative to that export) and returns its numeric UID and GID.
func GetFileUserGroupId(export, fileName string) (uid, gid int, err error) {
	cfg := GetAttachedWorkerDetails()
	sshCfg := SSHConfig{
		Username: NDM_VM_USER_NAME,
		Host:     cfg.Host,
		Port:     cfg.Port,
		Password: NDM_VM_PASSWORD,
	}

	// Build a shell script that mounts + stats with "%u %g"
	script := fmt.Sprintf(`
	set -e
	MP=$(mktemp -d -t mount.XXXXXX)
	trap 'sudo umount "$MP" || true; rm -rf "$MP"' EXIT

	sudo mount -t nfs "%[1]s" "$MP"
	stat -c "%%u %%g" "$MP/%[2]s"
	`, export, fileName)

	out, err := sshRunScript(sshCfg, script)
	if err != nil {
		return 0, 0, fmt.Errorf("OwnerIDShellStat failed: %w\n%s", err, out)
	}

	parts := strings.Fields(strings.TrimSpace(out))
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("unexpected stat output: %q", out)
	}

	// parse the two numeric strings into ints
	u, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, fmt.Errorf("invalid uid %q: %w", parts[0], err)
	}
	g, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, fmt.Errorf("invalid gid %q: %w", parts[1], err)
	}
	return u, g, nil
}

func GetFileServerDetails(configId string, headers map[string]string) (FileServerDetails, error) {
	fullURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, configId)

	fmt.Printf("GetConfigById Full URL: %s\n", fullURL)
	resp, err := SendAPIRequest(http.MethodGet, fullURL, nil, headers)
	if err != nil {
		return FileServerDetails{}, fmt.Errorf("error sending API request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return FileServerDetails{}, fmt.Errorf("error reading response body: %w", err)
	}

	var response FileServerDetails
	err = json.Unmarshal(bodyBytes, &response)
	if err != nil {
		return FileServerDetails{}, fmt.Errorf("error unmarshalling response: %w", err)
	}

	return response, nil
}

func GetVolumeDetailsFromFileServer(Volumes []Volume, volumePath string) (Volume, error) {
	for _, volume := range Volumes {
		if volume.VolumePath == volumePath {
			return volume, nil
		}
	}
	return Volume{}, fmt.Errorf("no volume found with path '%s'", volumePath)
}

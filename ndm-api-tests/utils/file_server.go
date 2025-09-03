package utils

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

const (
	AutoDiscover ExportPathSource = "AUTO_DISCOVER"
	ManualUpload ExportPathSource = "MANUAL_UPLOAD"
)

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

func InitFileServer(src_volumes, dest_volumes, source_ips, dest_ips string) {
	SOURCE_VOLUMES = GetVolumesFromArgs(src_volumes)
	DESTINATION_VOLUMES = GetVolumesFromArgs(dest_volumes)

	srcIpList := []string{}
	for _, ip := range strings.Split(source_ips, ",") {
		tip := strings.TrimSpace(ip)
		if tip != "" {
			srcIpList = append(srcIpList, tip)
		}
	}

	destIpList := []string{}
	for _, ip := range strings.Split(dest_ips, ",") {
		tip := strings.TrimSpace(ip)
		if tip != "" {
			destIpList = append(destIpList, tip)
		}
	}

	SOURCE_HOST_IPs = srcIpList
	DESTINATION_HOST_IPs = destIpList

	// Ensure we have enough volumes and IPs.
	if len(SOURCE_HOST_IPs) != len(SOURCE_VOLUMES) {
		LogFatalf("Insufficient number of source IPs provided. Got %d IPs for %d volumes", len(SOURCE_HOST_IPs), len(SOURCE_VOLUMES))
	}

	if len(DESTINATION_HOST_IPs) != len(DESTINATION_VOLUMES) {
		LogFatalf("Insufficient number of destination IPs provided. Got %d IPs for %d volumes", len(DESTINATION_HOST_IPs), len(DESTINATION_VOLUMES))
	}

	if len(SOURCE_VOLUMES) < 2 || len(DESTINATION_VOLUMES) < 2 {
		LogFatalf("Expected atleast 2 source volumes and destination volumes")
	}
}

var sshConfig SSHConfig

func PtrExportPathSource(e ExportPathSource) *ExportPathSource {
	return &e
}

// CreateFileServer creates a File server with different config details
func CreateFileServer(params CreateServereParams, headers map[string]string) (string, *http.Response, error) {
	createSourceURL := CONFIG_SERVICE_URL + CREATE_FILESERVER_ENDPOINT

	fileServerParams := map[string]interface{}{
		"serverType":      params.ServerType,
		"userName":        params.UserName,
		"password":        params.Password,
		"protocol":        params.Protocol,
		"protocolVersion": params.ProtocolVersion,
		"host":            params.Host,
		"volumes":         []interface{}{},
		"workers":         params.Workers,
	}

	if params.ExportPathSource != nil {
		exportPathSource := ManualUpload
		fileServerParams["exportPathSource"] = &exportPathSource
	}

	payload := map[string]interface{}{
		"configName": params.ConfigName,
		"configType": params.ConfigType,
		"projectId":  params.ProjectID,
		"fileServers": []map[string]interface{}{
			fileServerParams,
		},
		"workingDirectory": map[string]interface{}{
			"workingDirectory": "",
			"pathId":           nil,
			"pathName":         "",
		},
	}

	/*jsonBytes, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		fmt.Println("Error marshaling payload to JSON:", err)

	}*/

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

	var createFileServerResp CreateFileServerResponse
	err = json.Unmarshal(bodyBytes, &createFileServerResp)
	if err != nil {
		return "", resp, err
	}

	return createFileServerResp.Data.ID, resp, nil
}

// GetSourcePathID fetches the source file server by Volume Name, validates the response,
// and returns the first volume ID (sourcePathID)
func GetExportPathID(
	volumeType string,
	volumeName string,
	configID string,
	headers map[string]string,
) (string, error) {

	refreshURL := fmt.Sprintf("%s%s/%s", CONFIG_SERVICE_URL, FILE_SERVER_REFRESH_URL, configID)
	getSourceURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, configID)

	var response FileServerDetails

	for attempt := 1; attempt <= MaxPollRetries; attempt++ {

		resp, err := SendAPIRequest(http.MethodGet, refreshURL, nil, headers)
		if err != nil {
			return "", fmt.Errorf("error refreshing file server: %w", err)
		}
		defer resp.Body.Close()

		LogDebug(fmt.Sprintf("Getting Export Path ID of FileServer Volume = %s, attempt: %d", volumeName, attempt))
		getFileServerResp, err := SendAPIRequest(http.MethodGet, getSourceURL, nil, headers)
		if err != nil {
			return "", fmt.Errorf("error sending API request: %w", err)
		}
		defer getFileServerResp.Body.Close()

		bodyBytes, err := io.ReadAll(getFileServerResp.Body)
		if err != nil {
			return "", fmt.Errorf("error reading response body: %w", err)
		}

		err = json.Unmarshal(bodyBytes, &response)
		if err != nil {
			return "", fmt.Errorf("error unmarshalling response: %w", err)
		}

		// Check if fileserver and volumes exist
		if len(response.Data.Items.FileServers) > 0 && len(response.Data.Items.FileServers[0].Volumes) > 0 {
			break
		}

		if attempt < MaxPollRetries {
			Wait(DefaultPollInterval) // Wait before retrying
		}
	}

	// After retries, check again
	if len(response.Data.Items.FileServers) == 0 {
		return "", fmt.Errorf("no fileServers found in source response after %d attempts", MaxPollRetries)
	}

	if len(response.Data.Items.FileServers[0].Volumes) == 0 {
		return "", fmt.Errorf("no volumes found for source file server after %d attempts", MaxPollRetries)
	}

	// Now fetch the volume ID
	volumeID, err := GetVolumeID(response.Data.Items, volumeName)
	if err != nil {
		return "", fmt.Errorf("error handling volume for '%s': %w", "Getting the source file server by config ID", err)
	}
	if volumeID == "" {
		return "", fmt.Errorf("expected a valid sourcePathID, got empty string")
	}

	sourcePathID := volumeID
	return sourcePathID, nil
}

func ClearVolumeForSMB(export string) string {
	split := strings.Split(export, ":")
	smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

	mappedDrive := "Z:"

	clearVolumeScript := fmt.Sprintf(`cmd /C
	net use %s /delete /yes &
	net use %s %s /user:%s "%s" &&
	rmdir /s /q %s &&
	net use %s /delete /yes
	`, mappedDrive, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD, mappedDrive, mappedDrive)

	commands := []string{}
	for _, v := range strings.Split(clearVolumeScript, "\n") {
		commands = append(commands, strings.TrimSpace(v))
	}

	return strings.Join(commands, " ")
}

func ClearVolumeForNFS(export string) string {
	destMount := "/mnt/remove_data"

	script := fmt.Sprintf(`
	set -e

	# Clean up any previous mount
	sudo umount -f "%s" 2>/dev/null || true
	sudo rm -rf "%s"

	sudo mkdir -p "%s"
	sudo mount -t nfs "%s" "%s"

	# Remove all files, directories, and hidden files
	sudo find "%s" -mindepth 1 -maxdepth 1 ! -name ".snapshot" -exec rm -rf {} +

	# Remove all symlinks (soft links)
	sudo find "%s" -type l -exec rm -f {} +

	# Remove all files with more than one hardlink (hard links)
	sudo find "%s" -type f -links +1 -exec rm -f {} +

	sudo umount "%s"
	sudo rm -rf "%s"
`, destMount, destMount,
		destMount, export, destMount,
		destMount,
		destMount,
		destMount,
		destMount, destMount)

	return script
}

// ClearVolume removes all data from the NFS export mounted on the VM.
func ClearVolume(export string) error {
	script := ""

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		script = ClearVolumeForSMB(export)
	case ProtocolNFS:
		script = ClearVolumeForNFS(export)
	}

	config := GetAttachedWorkerDetails()

	sshConfig = SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("RemoveDataFromFileserver failed: %w\noutput: %s", err, output)
	}

	return nil
}

// RemovePartialDeltaFromVolume removes number of files equals fileCount
func RemovePartialDeltaFromVolume(export string, fileCount int) error {
	if PROTOCOL_TYPE == ProtocolSMB {
		// To be replaced with SMB code.
		return fmt.Errorf("SMB-specific logic is not implemented")
	}
	config := GetAttachedWorkerDetails()

	sshConfig = SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	destMount := "/mnt/data_remove"

	script := fmt.Sprintf(`
	set -e

	# Clean up any previous mount
	sudo rm -rf "%s"

	# Mount export NFS export

	sudo mkdir -p "%s"
	sudo mount -t nfs "%s" "%s"

	# Navigate to delta folder inside mounted directory
	cd "%s/%s"

	# List matching files and remove
	files=($(ls file*.txt 2>/dev/null))
	count=${#files[@]}
	if [ "$count" -le "%d" ]; then
	    sudo rm -f "${files[@]}"
	else
	    for ((i=0; i< "%d"; i++)); do
		    sudo rm -f "${files[$i]}"
		done
	fi

	# Unmount and cleanup
	cd /
	sudo umount "%s"
	sudo rm -rf "%s"
	`, destMount, destMount, export, destMount, destMount, DeltaFolder, fileCount, fileCount, destMount, destMount)

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("RemoveDeltaFromFileserver failed: %w\noutput: %s", err, output)
	}
	return nil
}

// AddDataToVolumeForSMB creates a delta directory with 100 text files of 100KB each
func AddDataToVolumeForSMB(export string) string {
	//fullCmd := `cmd /C "mkdir C:\delta_test_smb && for /L %i in (1,1,100) do fsutil file createnew C:\delta_test_smb\file%i.txt 102400"`

	split := strings.Split(export, ":")
	smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

	deltaDir := `C:\` + DeltaFolder
	mappedDrive := `Z:`

	cmd := fmt.Sprintf(`cmd /C
	if exist %s rmdir /s /q %s &&
	mkdir %s &&
	net use %s /delete /y &
	(for /L %%i in (1,1,100) do fsutil file createnew %s\file%%i.txt 102400) &&
	net use %s %s /user:%s "%s" &&
	(if exist %s\%s\ ( rmdir /s /q %s\%s ) else ( echo "delta not found" )) &
	xcopy /E /I /Y %s %s\%s &&
	net use %s /delete /y &&
	rmdir /s /q %s
	`, deltaDir, deltaDir, deltaDir, mappedDrive, deltaDir, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD, smbShare, DeltaFolder, smbShare, DeltaFolder, deltaDir, smbShare, DeltaFolder, mappedDrive, deltaDir)

	commands := []string{}
	for _, v := range strings.Split(cmd, "\n") {
		commands = append(commands, strings.TrimSpace(v))
	}

	return strings.Join(commands, " ")
}

func AddDataToVolumeForNFS(export string) string {
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

sync

# Unmount and cleanup
sudo umount "%s" || sudo umount -l "%s"
sudo rm -rf "%s"
sudo rm -rf "%s"
`, deltaDir, destMount, deltaDir, deltaDir, destMount, export, destMount, deltaDir, destMount, destMount, destMount, deltaDir, destMount)

	return script
}

// AddDataToVolume creates a delta directory with 100 text files of 100KB each,
func AddDataToVolume(export string) error {
	script := ""

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		script = AddDataToVolumeForSMB(export)
	case ProtocolNFS:
		script = AddDataToVolumeForNFS(export)
	}

	config := GetAttachedWorkerDetails()

	sshConfig = SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("AddDataToFileserver failed: %w\noutput: %s", err, output)
	}

	return nil
}

// RemoveDeltaFromVolumeForSMB removes the delta directory from the SMB export mounted on the VM.
func RemoveDeltaFromVolumeForSMB(export string) string {
	split := strings.Split(export, ":")
	smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

	mappedDrive := "Z:"

	removeDeltaScript := fmt.Sprintf(`cmd /C
	net use %s /delete /yes &
	net use %s %s /user:%s "%s" &&
	(if exist %s\%s\ ( rmdir /s /q %s\%s ) else ( echo "delta not found" )) &
	net use %s /delete /yes
	`, mappedDrive, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD, smbShare, DeltaFolder, smbShare, DeltaFolder, mappedDrive)

	commands := []string{}
	for _, v := range strings.Split(removeDeltaScript, "\n") {
		commands = append(commands, strings.TrimSpace(v))
	}

	return strings.Join(commands, " ")
}

func RemoveDeltaFromVolumeForNFS(export string) string {
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

	return script
}

// RemoveDeltaFromVolume removes the delta directory from the NFS export mounted on the VM.
func RemoveDeltaFromVolume(export string) error {
	script := ""

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		script = RemoveDeltaFromVolumeForSMB(export)
	case ProtocolNFS:
		script = RemoveDeltaFromVolumeForNFS(export)
	}

	config := GetAttachedWorkerDetails()

	sshConfig = SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("RemoveDeltaFromFileserver failed: %w\noutput: %s", err, output)
	}

	return nil
}

func ModifyDataOnVolumeForSMB(export string) string {
	appendLines := "# MODIFIED 1 # MODIFIED 2"

	split := strings.Split(export, ":")
	smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

	mappedDrive := "Z:"

	modifyDataScript := fmt.Sprintf(`cmd /C
	net use %s /delete /yes &
	net use %s %s /user:%s "%s" &&
	echo %s >> %s\modify1.text &&
    echo %s >> %s\modify2.text &&
	echo %s >> %s\modify3.text &&
	net use %s /delete /yes
	`, mappedDrive, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD, appendLines, smbShare, appendLines, smbShare, appendLines, smbShare, mappedDrive)

	commands := []string{}
	for _, v := range strings.Split(modifyDataScript, "\n") {
		commands = append(commands, strings.TrimSpace(v))
	}

	return strings.Join(commands, " ")
}

func ModifyDataOnVolumeForNFS(export string) string {
	destMount := "/mnt/data_modify"

	// Lines to append
	appendLines := "\n# MODIFIED LINE 1\n# MODIFIED LINE 2\n"

	return fmt.Sprintf(`
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
}

// ModifyDataOnVolume appends lines to the text files in the NFS export mounted on the VM.
func ModifyDataOnVolume(export string) error {
	script := ""

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		script = ModifyDataOnVolumeForSMB(export)
	case ProtocolNFS:
		script = ModifyDataOnVolumeForNFS(export)
	}

	config := GetAttachedWorkerDetails()
	sshConfig = SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("ModifyDataOnVolume failed: %w\noutput: %s", err, output)
	}
	return nil
}

func RestoreOriginalDataOnVolumeForSMB(export string) string {
	split := strings.Split(export, ":")
	smbShare := fmt.Sprintf(`\\%s\%s`, strings.TrimSpace(split[0]), strings.TrimSpace(split[1]))

	mappedDrive := "Z:"

	restoreScript := fmt.Sprintf(`cmd /C
	net use %s /delete /yes &
	net use %s %s /user:%s "%s" &&
	type nul > %s\modify1.text &&
    type nul > %s\modify2.text &&
	type nul > %s\modify3.text &&
	net use %s /delete /yes
	`, mappedDrive, mappedDrive, smbShare, PROTOCOL_USERNAME, PROTOCOL_PASSWORD, smbShare, smbShare, smbShare, mappedDrive)

	commands := []string{}
	for _, v := range strings.Split(restoreScript, "\n") {
		commands = append(commands, strings.TrimSpace(v))
	}

	return strings.Join(commands, " ")
}

func RestoreOriginalDataOnVolumeForNFS(export string) string {
	destMount := "/mnt/data_restore"

	return fmt.Sprintf(`
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
}

// RestoreOriginalDataOnVolume removes the appended lines from the text files in the NFS export mounted on the VM.
func RestoreOriginalDataOnVolume(export string) error {
	script := ""

	switch PROTOCOL_TYPE {
	case ProtocolSMB:
		script = RestoreOriginalDataOnVolumeForSMB(export)
	case ProtocolNFS:
		script = RestoreOriginalDataOnVolumeForNFS(export)
	}

	config := GetAttachedWorkerDetails()
	sshConfig = SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
	}

	output, err := sshRunScript(sshConfig, script)
	if err != nil {
		return fmt.Errorf("RestoreOriginalDataOnVolume failed: %w\noutput: %s", err, output)
	}
	return nil
}

// GetVolumeID retrieves the ID of a volume by its path from the FileServerInfo response.
func GetVolumeID(response FileServerDetailsItems, volumePath string) (string, error) {
	for _, fileServer := range response.FileServers {
		for _, volume := range fileServer.Volumes {
			if volume.VolumePath == volumePath {
				return volume.ID, nil // Return the found ID and no error
			}
		}
	}
	// If no volume is found, return an error
	return "", fmt.Errorf("no volume found with path '%s'", volumePath)
}

// GetFileUserGroupId mounts the NFS export, stats the given file‐path
// (relative to that export) and returns its numeric UID and GID.
func GetFileUserGroupId(export, fileName string) (uid, gid int, err error) {
	config := GetAttachedWorkerDetails()
	sshCfg := SSHConfig{
		Username: config.Username,
		Host:     config.Host,
		Port:     config.Port,
		Password: config.Password,
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

func GetFileServerDetails(configId string, headers map[string]string) (FileServerDetailsItems, error) {
	getSourceURL := fmt.Sprintf("%s/api/v1/servers/%s", CONFIG_SERVICE_URL, configId)

	var response FileServerDetails

	for attempt := 1; attempt <= MaxPollRetries; attempt++ {
		getFileServerResp, err := SendAPIRequest(http.MethodGet, getSourceURL, nil, headers)
		if err != nil {
			return FileServerDetailsItems{}, fmt.Errorf("error sending API request: %w", err)
		}
		defer getFileServerResp.Body.Close()

		bodyBytes, err := io.ReadAll(getFileServerResp.Body)
		if err != nil {
			return FileServerDetailsItems{}, fmt.Errorf("error reading response body: %w", err)
		}

		err = json.Unmarshal(bodyBytes, &response)
		if err != nil {
			return FileServerDetailsItems{}, fmt.Errorf("error unmarshalling response: %w", err)
		}

		// Check if fileserver and volumes exist
		if len(response.Data.Items.FileServers) > 0 {
			break
		}

		if attempt < MaxPollRetries {
			Wait(DefaultPollInterval) // Wait before retrying
		}
	}

	// After retries, check again
	if len(response.Data.Items.FileServers) == 0 {
		return FileServerDetailsItems{}, fmt.Errorf("no fileServers found in source response after %d attempts", MaxPollRetries)
	}

	return response.Data.Items, nil
}

func GetVolumeDetailsFromFileServer(Volumes []Volume, volumePath string) (Volume, error) {
	for _, volume := range Volumes {
		if volume.VolumePath == volumePath {
			return volume, nil
		}
	}
	return Volume{}, fmt.Errorf("no volume found with path '%s'", volumePath)
}

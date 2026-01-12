package utils

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OntapClient handles ONTAP REST API interactions
type OntapClient struct {
	BaseURL    string
	Username   string
	Password   string
	HTTPClient *http.Client
}

// String implements fmt.Stringer interface to redact sensitive Password field
func (c *OntapClient) String() string {
	return fmt.Sprintf("OntapClient{BaseURL:%s Username:%s Password:***REDACTED***}", c.BaseURL, c.Username)
}

// GoString implements fmt.GoStringer interface to redact sensitive Password field
func (c *OntapClient) GoString() string {
	return c.String()
}

// VolumeInfo represents ONTAP volume information
type VolumeInfo struct {
	UUID string `json:"uuid"`
	Name string `json:"name"`
	SVM  struct {
		Name string `json:"name"`
		UUID string `json:"uuid"`
	} `json:"svm"`
	State string `json:"state"`
}

// SVMInfo represents ONTAP SVM information
type SVMInfo struct {
	UUID string `json:"uuid"`
	Name string `json:"name"`
}

// VolumeCloneRequest represents the request body for cloning a volume
type VolumeCloneRequest struct {
	Name  string `json:"name"`
	Clone struct {
		IsFlexclone    bool            `json:"is_flexclone"`
		ParentSnapshot *ParentSnapshot `json:"parent_snapshot,omitempty"`
		ParentSVM      *Reference      `json:"parent_svm,omitempty"`
		ParentVolume   *Reference      `json:"parent_volume"`
	} `json:"clone"`
	SVM Reference `json:"svm"`
	NAS *struct {
		Path string `json:"path"`
	} `json:"nas,omitempty"`
}

// ParentSnapshot represents parent snapshot for clone
type ParentSnapshot struct {
	Name string `json:"name,omitempty"`
	UUID string `json:"uuid,omitempty"`
}

// Reference represents a reference to an ONTAP object
type Reference struct {
	Name string `json:"name,omitempty"`
	UUID string `json:"uuid,omitempty"`
}

// OntapResponse represents generic ONTAP REST API response
type OntapResponse struct {
	Records    []interface{} `json:"records,omitempty"`
	NumRecords int           `json:"num_records,omitempty"`
	Job        *struct {
		UUID  string `json:"uuid"`
		Links struct {
			Self struct {
				Href string `json:"href"`
			} `json:"self"`
		} `json:"_links"`
	} `json:"job,omitempty"`
}

// JobStatus represents ONTAP job status
type JobStatus struct {
	State   string `json:"state"`
	Message string `json:"message,omitempty"`
	UUID    string `json:"uuid"`
}

// ExportPolicyRule represents an NFS export policy rule
type ExportPolicyRule struct {
	Clients       []string `json:"clients"`
	RoRule        []string `json:"ro_rule"`
	RwRule        []string `json:"rw_rule"`
	Superuser     []string `json:"superuser"`
	AnonymousUser string   `json:"anonymous_user,omitempty"`
}

// ExportPolicyCreateRequest represents export policy creation request
type ExportPolicyCreateRequest struct {
	Name  string             `json:"name"`
	SVM   Reference          `json:"svm"`
	Rules []ExportPolicyRule `json:"rules,omitempty"`
}

// ExportPolicyInfo represents export policy information
type ExportPolicyInfo struct {
	Name string `json:"name"`
	ID   int    `json:"id"`
	SVM  struct {
		Name string `json:"name"`
		UUID string `json:"uuid"`
	} `json:"svm"`
}

// SnapshotInfo represents snapshot information
type SnapshotInfo struct {
	UUID string `json:"uuid"`
	Name string `json:"name"`
}

// SnapshotCreateRequest represents snapshot creation request
type SnapshotCreateRequest struct {
	Name string `json:"name"`
}

// NewOntapClient creates a new ONTAP REST API client
func NewOntapClient(baseURL, username, password string) *OntapClient {
	return &OntapClient{
		BaseURL:  strings.TrimSuffix(baseURL, "/"),
		Username: username,
		Password: password,
		HTTPClient: &http.Client{
			Timeout: 60 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					InsecureSkipVerify: true, // For testing only
				},
			},
		},
	}
}

// doRequest performs HTTP request with basic auth
func (c *OntapClient) doRequest(method, endpoint string, body interface{}) (*http.Response, error) {
	var reqBody io.Reader
	if body != nil {
		jsonData, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonData)
	}

	url := fmt.Sprintf("%s%s", c.BaseURL, endpoint)
	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.Username, c.Password)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}

	return resp, nil
}

// ListSVMs retrieves all SVMs from ONTAP
func (c *OntapClient) ListSVMs() ([]SVMInfo, error) {
	resp, err := c.doRequest("GET", "/api/svm/svms", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to list SVMs, status: %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	var result struct {
		Records []SVMInfo `json:"records"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Records, nil
}

// ListVolumes retrieves volumes for a specific SVM
func (c *OntapClient) ListVolumes(svmName string) ([]VolumeInfo, error) {
	endpoint := fmt.Sprintf("/api/storage/volumes?svm.name=%s", svmName)
	resp, err := c.doRequest("GET", endpoint, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to list volumes, status: %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	var result struct {
		Records []VolumeInfo `json:"records"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Records, nil
}

// GetVolumeByName retrieves volume details by name and SVM
func (c *OntapClient) GetVolumeByName(svmName, volumeName string) (*VolumeInfo, error) {
	volumes, err := c.ListVolumes(svmName)
	if err != nil {
		return nil, err
	}

	for _, vol := range volumes {
		if vol.Name == volumeName {
			return &vol, nil
		}
	}

	return nil, fmt.Errorf("volume %s not found in SVM %s", volumeName, svmName)
}

// CreateSnapshot creates a snapshot on the specified volume
func (c *OntapClient) CreateSnapshot(volumeUUID, snapshotName string) (*SnapshotInfo, error) {
	snapshotReq := SnapshotCreateRequest{
		Name: snapshotName,
	}

	url := fmt.Sprintf("/api/storage/volumes/%s/snapshots", volumeUUID)
	resp, err := c.doRequest("POST", url, snapshotReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusAccepted {
		return nil, fmt.Errorf("failed to create snapshot, status: %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	var snapshotResp OntapResponse
	if err := json.Unmarshal(bodyBytes, &snapshotResp); err != nil {
		return nil, fmt.Errorf("failed to decode snapshot response: %w", err)
	}

	// Wait for job completion if async
	if snapshotResp.Job != nil {
		LogDebug(fmt.Sprintf("Waiting for snapshot creation job %s to complete...", snapshotResp.Job.UUID))
		if err := c.waitForJob(snapshotResp.Job.UUID, 2*time.Minute); err != nil {
			return nil, fmt.Errorf("snapshot creation job failed: %w", err)
		}
	}

	return &SnapshotInfo{
		Name: snapshotName,
	}, nil
}

// CloneVolume creates a FlexClone of the specified volume
func (c *OntapClient) CloneVolume(svmName, parentVolumeName, cloneName string) (*VolumeInfo, error) {
	// Get parent volume info
	parentVol, err := c.GetVolumeByName(svmName, parentVolumeName)
	if err != nil {
		return nil, fmt.Errorf("failed to get parent volume: %w", err)
	}

	// Create unique snapshot name to avoid conflicts in parallel execution
	snapshotName := fmt.Sprintf("snap_%s_%d", cloneName, time.Now().UnixNano())
	LogDebug(fmt.Sprintf("Creating snapshot %s on volume %s before cloning", snapshotName, parentVolumeName))
	
	// Create snapshot first
	_, err = c.CreateSnapshot(parentVol.UUID, snapshotName)
	if err != nil {
		return nil, fmt.Errorf("failed to create snapshot: %w", err)
	}
	LogDebug(fmt.Sprintf("Snapshot %s created successfully", snapshotName))
	
	cloneReq := VolumeCloneRequest{
		Name: cloneName,
		SVM: Reference{
			Name: svmName,
		},
	}
	cloneReq.Clone.IsFlexclone = true
	cloneReq.Clone.ParentVolume = &Reference{
		Name: parentVolumeName,
		UUID: parentVol.UUID,
	}
	cloneReq.Clone.ParentSnapshot = &ParentSnapshot{
		Name: snapshotName,
	}
	LogDebug(fmt.Sprintf("Creating clone %s from snapshot %s", cloneName, snapshotName))

	// Set junction path so the volume is mounted and accessible via NFS
	cloneReq.NAS = &struct {
		Path string `json:"path"`
	}{
		Path: fmt.Sprintf("/%s", cloneName),
	}
	LogDebug(fmt.Sprintf("Setting junction path for clone: /%s", cloneName))

	// Send clone request
	resp, err := c.doRequest("POST", "/api/storage/volumes", cloneReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusAccepted {
		return nil, fmt.Errorf("failed to create clone, status: %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	var cloneResp OntapResponse
	if err := json.Unmarshal(bodyBytes, &cloneResp); err != nil {
		return nil, fmt.Errorf("failed to decode clone response: %w", err)
	}

	// Wait for job completion if async
	if cloneResp.Job != nil {
		LogDebug(fmt.Sprintf("Waiting for clone job %s to complete...", cloneResp.Job.UUID))
		if err := c.waitForJob(cloneResp.Job.UUID, 5*time.Minute); err != nil {
			return nil, fmt.Errorf("clone job failed: %w", err)
		}
	}

	// Get the created volume info
	LogDebug(fmt.Sprintf("Fetching cloned volume info for: %s", cloneName))
	clonedVol, err := c.GetVolumeByName(svmName, cloneName)
	if err != nil {
		return nil, fmt.Errorf("failed to get cloned volume info: %w", err)
	}

	// Hide .snapshot directory from NFS clients
	err = c.HideSnapshotDirectory(svmName, cloneName)
	if err != nil {
		LogDebug(fmt.Sprintf("Warning: Failed to hide .snapshot directory for volume '%s': %v", cloneName, err))
		// Don't fail the clone operation, just log the warning
	}

	return clonedVol, nil
}

// HideSnapshotDirectory hides the .snapshot directory from NFS clients
func (c *OntapClient) HideSnapshotDirectory(svmName, volumeName string) error {
	// Get volume UUID first
	vol, err := c.GetVolumeByName(svmName, volumeName)
	if err != nil {
		return fmt.Errorf("failed to get volume: %w", err)
	}

	// Update volume to hide snapdir using the correct API parameter
	// The parameter is "snapshot_directory_access_enabled" not "snapdir_access"
	updateReq := map[string]interface{}{
		"snapshot_directory_access_enabled": false,
	}

	endpoint := fmt.Sprintf("/api/storage/volumes/%s", vol.UUID)
	resp, err := c.doRequest("PATCH", endpoint, updateReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("failed to hide snapdir (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	LogDebug(fmt.Sprintf("Hidden .snapshot directory for volume '%s'", volumeName))
	return nil
}

// DeleteVolume deletes a volume by UUID
func (c *OntapClient) DeleteVolume(volumeUUID string) error {
	endpoint := fmt.Sprintf("/api/storage/volumes/%s", volumeUUID)
	resp, err := c.doRequest("DELETE", endpoint, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to delete volume, status: %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	var deleteResp OntapResponse
	bodyBytes, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(bodyBytes, &deleteResp); err != nil {
		LogDebug("Could not parse delete response, assuming success")
		return nil
	}

	// Wait for job completion if async
	if deleteResp.Job != nil {
		LogDebug(fmt.Sprintf("Waiting for delete job %s to complete...", deleteResp.Job.UUID))
		return c.waitForJob(deleteResp.Job.UUID, 3*time.Minute)
	}

	return nil
}

// waitForJob polls job status until completion
func (c *OntapClient) waitForJob(jobUUID string, timeout time.Duration) error {
	endpoint := fmt.Sprintf("/api/cluster/jobs/%s", jobUUID)
	startTime := time.Now()

	for {
		if time.Since(startTime) > timeout {
			return fmt.Errorf("job %s timed out after %v", jobUUID, timeout)
		}

		resp, err := c.doRequest("GET", endpoint, nil)
		if err != nil {
			return err
		}

		var job JobStatus
		if err := json.NewDecoder(resp.Body).Decode(&job); err != nil {
			resp.Body.Close()
			return fmt.Errorf("failed to decode job status: %w", err)
		}
		resp.Body.Close()

		LogDebug(fmt.Sprintf("Job %s state: %s", jobUUID, job.State))

		switch job.State {
		case "success":
			return nil
		case "failure":
			return fmt.Errorf("job failed: %s", job.Message)
		case "running", "queued", "paused":
			time.Sleep(2 * time.Second)
			continue
		default:
			return fmt.Errorf("unknown job state: %s", job.State)
		}
	}
}

// SVMExists checks if an SVM exists
func (c *OntapClient) SVMExists(svmName string) (bool, error) {
	svms, err := c.ListSVMs()
	if err != nil {
		return false, fmt.Errorf("failed to list SVMs: %w", err)
	}

	for _, svm := range svms {
		if svm.Name == svmName {
			return true, nil
		}
	}
	return false, nil
}

// VolumeExists checks if a volume exists in the given SVM
func (c *OntapClient) VolumeExists(svmName, volumeName string) (bool, error) {
	_, err := c.GetVolumeByName(svmName, volumeName)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// CreateExportPolicy creates an NFS export policy for a volume (without rules)
func (c *OntapClient) CreateExportPolicy(svmName, policyName string) (*ExportPolicyInfo, error) {
	url := fmt.Sprintf("%s/api/protocols/nfs/export-policies", c.BaseURL)

	// Create policy without rules first
	exportPolicy := map[string]interface{}{
		"name": policyName,
		"svm": map[string]string{
			"name": svmName,
		},
	}

	bodyBytes, err := json.Marshal(exportPolicy)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal export policy: %w", err)
	}

	LogDebug(fmt.Sprintf("Creating export policy '%s' in SVM '%s'", policyName, svmName))
	LogDebug(fmt.Sprintf("Making POST request to: %s", url))

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.Username, c.Password)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ = io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusAccepted {
		LogDebug(fmt.Sprintf("Export policy creation response status: %d, body: %s", resp.StatusCode, string(bodyBytes)))

		// Check if policy already exists - if so, try to get it
		if strings.Contains(string(bodyBytes), "already exists") || strings.Contains(string(bodyBytes), "duplicate") {
			LogDebug(fmt.Sprintf("Export policy '%s' already exists, fetching policy info", policyName))
			return c.GetExportPolicy(svmName, policyName)
		}

		return nil, fmt.Errorf("failed to create export policy (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	// For successful creation, fetch the policy info
	policyInfo, err := c.GetExportPolicy(svmName, policyName)
	if err != nil {
		LogDebug(fmt.Sprintf("Export policy '%s' created but could not fetch info: %v", policyName, err))
		// Return a minimal policy info - the policy was created successfully
		return &ExportPolicyInfo{Name: policyName}, nil
	}

	LogDebug(fmt.Sprintf("Export policy '%s' created successfully with ID %d", policyName, policyInfo.ID))
	return policyInfo, nil
}

// GetExportPolicy retrieves export policy information by name
func (c *OntapClient) GetExportPolicy(svmName, policyName string) (*ExportPolicyInfo, error) {
	url := fmt.Sprintf("%s/api/protocols/nfs/export-policies?svm.name=%s&name=%s", c.BaseURL, svmName, policyName)

	LogDebug(fmt.Sprintf("Making GET request to: %s", url))

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.Username, c.Password)
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to get export policy (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	var response struct {
		Records []ExportPolicyInfo `json:"records"`
	}

	if err := json.Unmarshal(bodyBytes, &response); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if len(response.Records) == 0 {
		return nil, fmt.Errorf("export policy '%s' not found", policyName)
	}

	return &response.Records[0], nil
}

// AddExportPolicyRule adds a rule to an existing export policy
func (c *OntapClient) AddExportPolicyRule(policyID int, clients []string) error {
	url := fmt.Sprintf("%s/api/protocols/nfs/export-policies/%d/rules", c.BaseURL, policyID)

	// Convert clients to the format ONTAP expects: array of objects with "match" field
	clientMatches := make([]map[string]string, len(clients))
	for i, client := range clients {
		clientMatches[i] = map[string]string{"match": client}
	}

	rule := map[string]interface{}{
		"clients":   clientMatches,
		"ro_rule":   []string{"any"},
		"rw_rule":   []string{"any"},
		"superuser": []string{"any"},
	}

	bodyBytes, err := json.Marshal(rule)
	if err != nil {
		return fmt.Errorf("failed to marshal rule: %w", err)
	}

	LogDebug(fmt.Sprintf("Adding rule to export policy %d", policyID))
	LogDebug(fmt.Sprintf("Making POST request to: %s", url))

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.Username, c.Password)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to execute request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ = io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusAccepted {
		LogDebug(fmt.Sprintf("Export policy rule creation response status: %d, body: %s", resp.StatusCode, string(bodyBytes)))
		return fmt.Errorf("failed to add export policy rule (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	LogDebug(fmt.Sprintf("Export policy rule added successfully"))
	return nil
}

// UpdateVolumeExportPolicy assigns an export policy to a volume
func (c *OntapClient) UpdateVolumeExportPolicy(svmName, volumeName, policyName string) error {
	// Get volume UUID first
	volume, err := c.GetVolumeByName(svmName, volumeName)
	if err != nil {
		return fmt.Errorf("failed to get volume: %w", err)
	}

	url := fmt.Sprintf("%s/api/storage/volumes/%s", c.BaseURL, volume.UUID)

	updateRequest := map[string]interface{}{
		"nas": map[string]interface{}{
			"export_policy": map[string]string{
				"name": policyName,
			},
		},
	}

	bodyBytes, err := json.Marshal(updateRequest)
	if err != nil {
		return fmt.Errorf("failed to marshal update request: %w", err)
	}

	LogDebug(fmt.Sprintf("Updating volume '%s' with export policy '%s'", volumeName, policyName))
	LogDebug(fmt.Sprintf("Making PATCH request to: %s", url))

	req, err := http.NewRequest("PATCH", url, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(c.Username, c.Password)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to execute request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ = io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		LogDebug(fmt.Sprintf("Volume export policy update response status: %d, body: %s", resp.StatusCode, string(bodyBytes)))
		return fmt.Errorf("failed to update volume export policy (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	LogDebug(fmt.Sprintf("Volume '%s' export policy updated to '%s'", volumeName, policyName))
	return nil
}

// CreateNFSExportForVolume creates an NFS export policy and assigns it to a cloned volume
func (c *OntapClient) CreateNFSExportForVolume(svmName, volumeName string) error {
	// Create export policy name based on volume name
	policyName := fmt.Sprintf("export_%s", volumeName)

	// Truncate if too long (export policy names have limits)
	if len(policyName) > 256 {
		policyName = policyName[:256]
	}

	// Step 1: Create the export policy (without rules)
	policyInfo, err := c.CreateExportPolicy(svmName, policyName)
	if err != nil {
		return fmt.Errorf("failed to create export policy: %w", err)
	}

	// Step 2: Add rule to the export policy if we have a valid policy ID
	if policyInfo.ID > 0 {
		err = c.AddExportPolicyRule(policyInfo.ID, []string{"0.0.0.0/0"})
		if err != nil {
			return fmt.Errorf("failed to add rule to export policy: %w", err)
		}
	} else {
		LogDebug(fmt.Sprintf("Warning: Could not add rule - policy ID not available for '%s'", policyName))
	}

	// Step 3: Assign the export policy to the volume
	err = c.UpdateVolumeExportPolicy(svmName, volumeName, policyName)
	if err != nil {
		return fmt.Errorf("failed to assign export policy to volume: %w", err)
	}

	LogDebug(fmt.Sprintf("NFS export created and assigned for volume '%s'", volumeName))
	return nil
}

// CreateSMBShareForVolume creates an SMB/CIFS share for a cloned volume
func (c *OntapClient) CreateSMBShareForVolume(svmName, volumeName string) error {
	// SMB share name is typically the volume name
	shareName := volumeName

	// Truncate if too long (SMB share names have limits - typically 80 chars)
	if len(shareName) > 80 {
		shareName = shareName[:80]
	}

	// Create SMB share pointing to the volume's junction path
	sharePath := fmt.Sprintf("/%s", volumeName)

	shareReq := map[string]interface{}{
		"name": shareName,
		"path": sharePath,
		"svm": map[string]string{
			"name": svmName,
		},
		"comment": fmt.Sprintf("Auto-created share for test volume %s", volumeName),
	}

	LogDebug(fmt.Sprintf("Creating SMB share '%s' for volume '%s' at path '%s'", shareName, volumeName, sharePath))

	resp, err := c.doRequest("POST", "/api/protocols/cifs/shares", shareReq)
	if err != nil {
		return fmt.Errorf("failed to create SMB share: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)

	// 201 Created or 200 OK are both acceptable
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		// Check if share already exists (409 Conflict)
		if resp.StatusCode == http.StatusConflict {
			LogDebug(fmt.Sprintf("SMB share '%s' already exists, skipping creation", shareName))
			return nil
		}
		return fmt.Errorf("failed to create SMB share, status: %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	LogDebug(fmt.Sprintf("SMB share '%s' created successfully for volume '%s'", shareName, volumeName))
	return nil
}

// DeleteSMBShare deletes an SMB/CIFS share by name
func (c *OntapClient) DeleteSMBShare(svmName, shareName string) error {
	// Truncate share name if it was truncated during creation
	originalShareName := shareName
	if len(shareName) > 80 {
		shareName = shareName[:80]
		LogDebug(fmt.Sprintf("[SMB-DELETE] Truncating share name from '%s' to '%s' (80 char limit)", originalShareName, shareName))
	}

	endpoint := fmt.Sprintf("/api/protocols/cifs/shares?svm.name=%s&name=%s", svmName, shareName)
	LogDebug(fmt.Sprintf("[SMB-DELETE] Attempting to delete SMB share: SVM='%s', Share='%s', Endpoint='%s'", svmName, shareName, endpoint))

	resp, err := c.doRequest("DELETE", endpoint, nil)
	if err != nil {
		LogError(fmt.Sprintf("[SMB-DELETE] Request failed for share '%s': %v", shareName, err))
		return fmt.Errorf("failed to delete SMB share: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)

	// 200 OK or 204 No Content are success
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		// Share might already be deleted (404 Not Found) - treat as success
		if resp.StatusCode == http.StatusNotFound {
			LogDebug(fmt.Sprintf("[SMB-DELETE] SMB share '%s' not found (already deleted), continuing", shareName))
			return nil
		}
		LogError(fmt.Sprintf("[SMB-DELETE] Failed to delete SMB share '%s': status %d, response: %s", shareName, resp.StatusCode, string(bodyBytes)))
		return fmt.Errorf("failed to delete SMB share, status: %d, body: %s", resp.StatusCode, string(bodyBytes))
	}

	LogDebug(fmt.Sprintf("[SMB-DELETE] ✓ SMB share '%s' deleted successfully from SVM '%s'", shareName, svmName))
	return nil
}

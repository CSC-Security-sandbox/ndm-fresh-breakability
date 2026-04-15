package utils

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	gcnvClonePollInterval         = 10 * time.Second
	gcnvCloneTimeout              = 20 * time.Minute
	maxGCNVCloneVolumeNameLength  = 63
)

type GCNVEndpointConfig struct {
	ProjectID   string
	Location    string
	StoragePool string
}

type gcnvVolumeProperties struct {
	Name            string   `json:"name"`
	State           string   `json:"state"`
	CapacityGib     string   `json:"capacityGib"`
	Protocols       []string `json:"protocols"`
	StoragePool     string   `json:"storagePool"`
	ShareName       string   `json:"shareName"`
	ServiceLevel    string   `json:"serviceLevel"`
	SecurityStyle   string   `json:"securityStyle"`
	UnixPermissions string   `json:"unixPermissions"`
}

type gcnvSnapshotResponse struct {
	Name  string `json:"name"`
	State string `json:"state"`
}

var (
	gcloudCLISetupOnce sync.Once
	gcloudCLISetupErr  error
)

func ensureGcloudCLIReady() error {
	gcloudCLISetupOnce.Do(func() {
		if _, err := exec.LookPath("gcloud"); err != nil {
			gcloudCLISetupErr = fmt.Errorf("gcloud cli is not installed or not on PATH: %w", err)
			return
		}

		output, err := runGcloudCLI("auth", "list", "--filter=status:ACTIVE", "--format=value(account)")
		if err != nil {
			gcloudCLISetupErr = fmt.Errorf("gcloud authentication check failed: %w", err)
			return
		}

		if strings.TrimSpace(string(output)) == "" {
			gcloudCLISetupErr = fmt.Errorf("no active gcloud account found; ensure google-github-actions/auth ran before tests")
			return
		}
	})

	return gcloudCLISetupErr
}

func runGcloudCLI(args ...string) ([]byte, error) {
	cmd := exec.Command("gcloud", args...)
	cmd.Env = os.Environ()

	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("gcloud %s failed: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}

	return output, nil
}

func getGCNVVolumeProperties(config GCNVEndpointConfig, volumeName string) (*gcnvVolumeProperties, error) {
	if err := ensureGcloudCLIReady(); err != nil {
		return nil, err
	}

	output, err := runGcloudCLI(
		"netapp", "volumes", "describe", volumeName,
		"--project", config.ProjectID,
		"--location", config.Location,
		"--format=json",
		"--quiet",
	)
	if err != nil {
		return nil, fmt.Errorf("failed to describe GCNV volume %q: %w", volumeName, err)
	}

	var properties gcnvVolumeProperties
	if err := json.Unmarshal(output, &properties); err != nil {
		return nil, fmt.Errorf("failed to decode GCNV volume details for %q: %w", volumeName, err)
	}

	return &properties, nil
}

func getGCNVSnapshotDetails(config GCNVEndpointConfig, volumeName, snapshotName string) (*gcnvSnapshotResponse, error) {
	if err := ensureGcloudCLIReady(); err != nil {
		return nil, err
	}

	output, err := runGcloudCLI(
		"netapp", "volumes", "snapshots", "describe", snapshotName,
		"--volume", volumeName,
		"--project", config.ProjectID,
		"--location", config.Location,
		"--format=json",
		"--quiet",
	)
	if err != nil {
		return nil, fmt.Errorf("snapshot %q not found for GCNV volume %q: %w", snapshotName, volumeName, err)
	}

	var snapshot gcnvSnapshotResponse
	if err := json.Unmarshal(output, &snapshot); err != nil {
		return nil, fmt.Errorf("failed to decode GCNV snapshot details for %q: %w", snapshotName, err)
	}

	return &snapshot, nil
}

func (tm *TestVolumeManager) createGCNVCloneVolume(masterVolumeName string) (VolumeCleanupInfo, error) {
	if tm.GCNVConfig == nil {
		return VolumeCleanupInfo{}, fmt.Errorf("GCNV configuration is not set on the test volume manager")
	}

	properties, err := getGCNVVolumeProperties(*tm.GCNVConfig, masterVolumeName)
	if err != nil {
		return VolumeCleanupInfo{}, fmt.Errorf("failed to fetch GCNV properties for %q: %w", masterVolumeName, err)
	}

	cloneName := tm.GenerateVolumeName(masterVolumeName)
	snapshotName := fixedGCNVSnapshotNameForVolume(masterVolumeName)

	LogDebug(fmt.Sprintf("Using fixed GCNV snapshot %q for master volume %q", snapshotName, masterVolumeName))
	snapshot, err := getGCNVSnapshotDetails(*tm.GCNVConfig, masterVolumeName, snapshotName)
	if err != nil {
		return VolumeCleanupInfo{}, err
	}

	createArgs := buildGCNVCloneCreateArgs(*tm.GCNVConfig, cloneName, snapshot.Name, properties)

	LogDebug(fmt.Sprintf("Creating GCNV clone volume %q from snapshot %q", cloneName, snapshotName))
	if _, err := runGcloudCLI(createArgs...); err != nil {
		_ = tm.cleanupFailedGCNVCloneCreate(cloneName)
		return VolumeCleanupInfo{}, fmt.Errorf("failed to create GCNV clone volume %q: %w", cloneName, err)
	}

	if err := waitForGCNVVolumeReady(*tm.GCNVConfig, cloneName); err != nil {
		_ = tm.cleanupFailedGCNVCloneCreate(cloneName)
		return VolumeCleanupInfo{}, fmt.Errorf("GCNV clone volume %q did not become ready: %w", cloneName, err)
	}

	return VolumeCleanupInfo{
		Name:    cloneName,
		IsClone: true,
	}, nil
}

func buildGCNVCloneCreateArgs(config GCNVEndpointConfig, cloneName, snapshotResourceName string, properties *gcnvVolumeProperties) []string {
	protocols := properties.Protocols
	if len(protocols) == 0 {
		switch PROTOCOL_TYPE {
		case ProtocolSMB:
			protocols = []string{"SMB"}
		default:
			protocols = []string{"NFSV3"}
		}
	}

	capacityGib := properties.CapacityGib
	if capacityGib == "" {
		capacityGib = "100"
	}

	args := []string{
		"netapp", "volumes", "create", cloneName,
		"--project", config.ProjectID,
		"--location", config.Location,
		"--storage-pool", config.StoragePool,
		"--capacity", capacityGib,
		"--protocols", strings.Join(protocols, ","),
		"--share-name", cloneName,
		"--source-snapshot", snapshotResourceName,
		"--snapshot-directory=false",
		"--format=json",
		"--quiet",
	}

	if properties.SecurityStyle != "" && properties.SecurityStyle != "SECURITY_STYLE_UNSPECIFIED" {
		args = append(args, "--security-style", strings.ToLower(properties.SecurityStyle))
	}

	if PROTOCOL_TYPE == ProtocolNFS && properties.UnixPermissions != "" {
		args = append(args, "--unix-permissions", properties.UnixPermissions)
	}

	return args
}

func waitForGCNVVolumeReady(config GCNVEndpointConfig, volumeName string) error {
	deadline := time.Now().Add(gcnvCloneTimeout)

	for time.Now().Before(deadline) {
		output, err := runGcloudCLI(
			"netapp", "volumes", "describe", volumeName,
			"--project", config.ProjectID,
			"--location", config.Location,
			"--format=value(state)",
			"--quiet",
		)
		if err != nil {
			time.Sleep(gcnvClonePollInterval)
			continue
		}

		state := strings.TrimSpace(string(output))
		switch strings.ToUpper(state) {
		case "READY":
			return nil
		case "ERROR":
			return fmt.Errorf("GCNV reported state=ERROR for volume %q", volumeName)
		}

		time.Sleep(gcnvClonePollInterval)
	}

	return fmt.Errorf("timed out waiting for GCNV volume %q to reach READY state", volumeName)
}

func (tm *TestVolumeManager) deleteGCNVCloneResources(volInfo VolumeCleanupInfo) error {
	if tm.GCNVConfig == nil {
		return fmt.Errorf("GCNV configuration is not set on the test volume manager")
	}
	if err := ensureGcloudCLIReady(); err != nil {
		return err
	}

	if volInfo.Name == "" {
		return nil
	}

	if _, err := runGcloudCLI(
		"netapp", "volumes", "delete", volInfo.Name,
		"--project", tm.GCNVConfig.ProjectID,
		"--location", tm.GCNVConfig.Location,
		"--force",
		"--quiet",
		"--async",
	); err != nil {
		if !isGCNVNotFoundError(err) {
			return fmt.Errorf("failed to delete GCNV volume %q: %w", volInfo.Name, err)
		}
		return nil
	}

	return waitForGCNVVolumeDeletion(*tm.GCNVConfig, volInfo.Name)
}

func (tm *TestVolumeManager) cleanupFailedGCNVCloneCreate(cloneName string) error {
	return tm.deleteGCNVCloneResources(VolumeCleanupInfo{
		Name:    cloneName,
		IsClone: true,
	})
}

func waitForGCNVVolumeDeletion(config GCNVEndpointConfig, volumeName string) error {
	deadline := time.Now().Add(gcnvCloneTimeout)

	for time.Now().Before(deadline) {
		_, err := runGcloudCLI(
			"netapp", "volumes", "describe", volumeName,
			"--project", config.ProjectID,
			"--location", config.Location,
			"--format=value(name)",
			"--quiet",
		)
		if err != nil {
			if isGCNVNotFoundError(err) {
				return nil
			}
			return err
		}

		time.Sleep(gcnvClonePollInterval)
	}

	return fmt.Errorf("timed out waiting for GCNV volume %q to be deleted", volumeName)
}

func fixedGCNVSnapshotNameForVolume(masterVolumeName string) string {
	return fmt.Sprintf("%s-snapshot", strings.Trim(masterVolumeName, "/ "))
}

func isGCNVNotFoundError(err error) bool {
	if err == nil {
		return false
	}

	lowered := strings.ToLower(err.Error())
	return strings.Contains(lowered, "not found") ||
		strings.Contains(lowered, "not_found") ||
		strings.Contains(lowered, "resource not found")
}

// CleanupStaleGCNVClones deletes any GCNV volumes that are clones from previous
// test runs (identified by having a master volume name as a prefix with additional suffix).
// This is called at suite startup to handle cases where the previous run was killed
// before cleanup could finish.
func CleanupStaleGCNVClones(config GCNVEndpointConfig, masterVolumes []string) {
	if config.ProjectID == "" || config.Location == "" {
		return
	}
	if err := ensureGcloudCLIReady(); err != nil {
		LogDebug(fmt.Sprintf("Skipping stale GCNV clone cleanup: %v", err))
		return
	}

	output, err := runGcloudCLI(
		"netapp", "volumes", "list",
		"--project", config.ProjectID,
		"--location", config.Location,
		"--format=value(name.basename())",
		"--quiet",
	)
	if err != nil {
		LogDebug(fmt.Sprintf("Skipping stale GCNV clone cleanup: failed to list volumes: %v", err))
		return
	}

	protectedSet := make(map[string]bool)
	for _, mv := range masterVolumes {
		protectedSet[strings.TrimSpace(mv)] = true
	}

	var staleVolumes []string
	for _, name := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		name = strings.TrimSpace(name)
		if name == "" || protectedSet[name] {
			continue
		}
		for _, master := range masterVolumes {
			master = strings.TrimSpace(master)
			if strings.HasPrefix(name, master+"-") {
				staleVolumes = append(staleVolumes, name)
				break
			}
		}
	}

	if len(staleVolumes) == 0 {
		LogDebug("No stale GCNV clone volumes found")
		return
	}

	LogDebug(fmt.Sprintf("Found %d stale GCNV clone volume(s) from previous runs, cleaning up...", len(staleVolumes)))
	for _, vol := range staleVolumes {
		LogDebug(fmt.Sprintf("[PRE-CLEANUP] Deleting stale GCNV clone: %s", vol))
		if _, err := runGcloudCLI(
			"netapp", "volumes", "delete", vol,
			"--project", config.ProjectID,
			"--location", config.Location,
			"--force",
			"--quiet",
			"--async",
		); err != nil {
			if !isGCNVNotFoundError(err) {
				LogError(fmt.Sprintf("[PRE-CLEANUP] Failed to delete stale GCNV clone %s: %v", vol, err))
			}
		}
	}

	for _, vol := range staleVolumes {
		_ = waitForGCNVVolumeDeletion(config, vol)
	}
	LogDebug("[PRE-CLEANUP] Stale GCNV clone cleanup complete")
}

func sanitizeGCNVIdentifier(value string, maxLen int) string {
	return sanitizeANFIdentifier(value, maxLen)
}

func buildGCNVCloneVolumeName(baseVolumeName, testCase, uniqueID string) string {
	testCaseSlug := anfTestCaseSlug(testCase)

	remainingBaseLen := maxGCNVCloneVolumeNameLength - len(uniqueID) - 1
	if testCaseSlug != "" {
		remainingBaseLen -= len(testCaseSlug) + 1
	}
	if remainingBaseLen < 1 {
		remainingBaseLen = 1
	}

	cleanBaseName := sanitizeGCNVIdentifier(baseVolumeName, remainingBaseLen)
	return strings.Join([]string{cleanBaseName, testCaseSlug, uniqueID}, "-")
}

package utils

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	anfClonePollInterval = 10 * time.Second
	anfCloneTimeout      = 20 * time.Minute
)

type ANFEndpointConfig struct {
	ResourceGroup string
	AccountName   string
	PoolName      string
}

type anfVolumeProperties struct {
	ID              string                `json:"id"`
	Location        string                `json:"location"`
	ServiceLevel    string                `json:"serviceLevel"`
	UsageThreshold  int64                 `json:"usageThreshold"`
	SubnetID        string                `json:"subnetId"`
	NetworkFeatures string                `json:"networkFeatures"`
	ProtocolTypes   []string              `json:"protocolTypes"`
	SecurityStyle   string                `json:"securityStyle"`
	UnixPermissions string                `json:"unixPermissions"`
	Zones           []string              `json:"zones"`
	ExportPolicy    anfVolumeExportPolicy `json:"exportPolicy"`
}

type anfVolumeExportPolicy struct {
	Rules []map[string]interface{} `json:"rules"`
}

type anfSnapshotResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

var (
	azureCLISetupOnce sync.Once
	azureCLISetupErr  error
)

func ensureAzureCLIReady() error {
	azureCLISetupOnce.Do(func() {
		if _, err := exec.LookPath("az"); err != nil {
			azureCLISetupErr = fmt.Errorf("azure cli is not installed or not on PATH: %w", err)
			return
		}

		managedConfigDir := false
		if os.Getenv("AZURE_CONFIG_DIR") == "" {
			configDir := filepath.Join(os.TempDir(), "ndm-azure-cli")
			if err := os.MkdirAll(configDir, 0o700); err != nil {
				azureCLISetupErr = fmt.Errorf("failed to create AZURE_CONFIG_DIR %q: %w", configDir, err)
				return
			}
			if err := os.Setenv("AZURE_CONFIG_DIR", configDir); err != nil {
				azureCLISetupErr = fmt.Errorf("failed to set AZURE_CONFIG_DIR: %w", err)
				return
			}
			managedConfigDir = true
		}

		if err := ensureAzureNetAppFilesCLIReady(managedConfigDir); err != nil {
			azureCLISetupErr = err
			return
		}

		if _, err := runAzureCLI("account", "show", "--output", "none", "--only-show-errors"); err != nil {
			clientID := strings.TrimSpace(os.Getenv("ARM_CLIENT_ID"))
			clientSecret := strings.TrimSpace(os.Getenv("ARM_CLIENT_SECRET"))
			tenantID := strings.TrimSpace(os.Getenv("ARM_TENANT_ID"))

			if clientID == "" || clientSecret == "" || tenantID == "" {
				azureCLISetupErr = fmt.Errorf("azure authentication is required for ANF clones. Set ARM_CLIENT_ID, ARM_CLIENT_SECRET, and ARM_TENANT_ID")
				return
			}

			if _, err := runAzureCLI(
				"login",
				"--service-principal",
				"--username", clientID,
				"--password", clientSecret,
				"--tenant", tenantID,
				"--output", "none",
				"--only-show-errors",
			); err != nil {
				azureCLISetupErr = fmt.Errorf("azure cli login failed: %w", err)
				return
			}
		}

		if subscriptionID := strings.TrimSpace(os.Getenv("ARM_SUBSCRIPTION_ID")); subscriptionID != "" {
			if _, err := runAzureCLI("account", "set", "--subscription", subscriptionID, "--only-show-errors"); err != nil {
				azureCLISetupErr = fmt.Errorf("failed to select azure subscription %q: %w", subscriptionID, err)
				return
			}
		}
	})

	return azureCLISetupErr
}

func ensureAzureNetAppFilesCLIReady(managedConfigDir bool) error {
	// If this run created its own Azure CLI profile, remove any old NetApp Files
	// extension from that profile before checking `az netappfiles`.
	if managedConfigDir {
		if err := removeAzureNetAppFilesExtensions(); err != nil {
			return err
		}
	}

	if azureNetAppFilesCommandAvailable() {
		return nil
	}

	if err := installAzureNetAppFilesExtension(); err != nil {
		return err
	}

	if !azureNetAppFilesCommandAvailable() {
		return fmt.Errorf("azure netappfiles cli commands are unavailable after installing the extension fallback")
	}

	return nil
}

func azureNetAppFilesCommandAvailable() bool {
	_, err := runAzureCLI("netappfiles", "-h")
	return err == nil
}

func removeAzureNetAppFilesExtensions() error {
	for _, extensionName := range []string{"netappfiles-preview", "netappfiles"} {
		if _, err := runAzureCLI("extension", "show", "--name", extensionName, "--output", "none", "--only-show-errors"); err != nil {
			continue
		}

		if _, err := runAzureCLI("extension", "remove", "--name", extensionName, "--only-show-errors"); err != nil {
			return fmt.Errorf("failed to remove azure netappfiles cli extension %q from the managed profile: %w", extensionName, err)
		}
	}

	return nil
}

func installAzureNetAppFilesExtension() error {
	var errs []string

	for _, extensionName := range []string{"netappfiles-preview", "netappfiles"} {
		if _, err := runAzureCLI("extension", "add", "--name", extensionName, "--only-show-errors"); err == nil {
			return nil
		} else {
			errs = append(errs, fmt.Sprintf("%s: %v", extensionName, err))
		}
	}

	return fmt.Errorf("failed to install azure netappfiles cli extension: %s", strings.Join(errs, "; "))
}

func runAzureCLI(args ...string) ([]byte, error) {
	cmd := exec.Command("az", args...)
	cmd.Env = os.Environ()

	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("az %s failed: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}

	return output, nil
}

func getANFVolumeProperties(config ANFEndpointConfig, volumeName string) (*anfVolumeProperties, error) {
	if err := ensureAzureCLIReady(); err != nil {
		return nil, err
	}

	output, err := runAzureCLI(
		"netappfiles", "volume", "show",
		"--resource-group", config.ResourceGroup,
		"--account-name", config.AccountName,
		"--pool-name", config.PoolName,
		"--volume-name", volumeName,
		"--output", "json",
		"--only-show-errors",
	)
	if err != nil {
		return nil, err
	}

	var properties anfVolumeProperties
	if err := json.Unmarshal(output, &properties); err != nil {
		return nil, fmt.Errorf("failed to decode ANF volume details for %q: %w", volumeName, err)
	}

	return &properties, nil
}

func getANFSnapshotDetails(config ANFEndpointConfig, volumeName, snapshotName string) (*anfSnapshotResponse, error) {
	if err := ensureAzureCLIReady(); err != nil {
		return nil, err
	}

	output, err := runAzureCLI(
		"netappfiles", "snapshot", "show",
		"--resource-group", config.ResourceGroup,
		"--account-name", config.AccountName,
		"--pool-name", config.PoolName,
		"--volume-name", volumeName,
		"--name", snapshotName,
		"--output", "json",
		"--only-show-errors",
	)
	if err != nil {
		return nil, fmt.Errorf("fixed snapshot %q was not found for ANF volume %q: %w", snapshotName, volumeName, err)
	}

	var snapshot anfSnapshotResponse
	if err := json.Unmarshal(output, &snapshot); err != nil {
		return nil, fmt.Errorf("failed to decode ANF snapshot details for %q: %w", snapshotName, err)
	}

	return &snapshot, nil
}

func (tm *TestVolumeManager) createANFCloneVolume(masterVolumeName string) (VolumeCleanupInfo, error) {
	if tm.ANFConfig == nil {
		return VolumeCleanupInfo{}, fmt.Errorf("ANF configuration is not set on the test volume manager")
	}

	properties, err := getANFVolumeProperties(*tm.ANFConfig, masterVolumeName)
	if err != nil {
		return VolumeCleanupInfo{}, fmt.Errorf("failed to fetch ANF properties for %q: %w", masterVolumeName, err)
	}

	cloneName := tm.GenerateVolumeName(masterVolumeName)
	snapshotName := fixedANFSnapshotNameForVolume(masterVolumeName)

	LogDebug(fmt.Sprintf("Reusing fixed ANF snapshot %q for master volume %q", snapshotName, masterVolumeName))
	snapshot, err := getANFSnapshotDetails(*tm.ANFConfig, masterVolumeName, snapshotName)
	if err != nil {
		return VolumeCleanupInfo{}, err
	}

	createArgs, err := buildANFCloneCreateArgs(*tm.ANFConfig, cloneName, snapshot.ID, properties)
	if err != nil {
		_ = tm.cleanupFailedANFCloneCreate(cloneName)
		return VolumeCleanupInfo{}, fmt.Errorf("failed to build ANF clone create command for %q: %w", cloneName, err)
	}

	LogDebug(fmt.Sprintf("Creating ANF clone volume %q from snapshot %q", cloneName, snapshotName))
	if _, err := runAzureCLI(createArgs...); err != nil {
		_ = tm.cleanupFailedANFCloneCreate(cloneName)
		return VolumeCleanupInfo{}, fmt.Errorf("failed to create ANF clone volume %q: %w", cloneName, err)
	}

	if err := waitForANFVolumeProvisioning(*tm.ANFConfig, cloneName); err != nil {
		_ = tm.cleanupFailedANFCloneCreate(cloneName)
		return VolumeCleanupInfo{}, fmt.Errorf("ANF clone volume %q did not become ready: %w", cloneName, err)
	}

	return VolumeCleanupInfo{
		Name:    cloneName,
		IsClone: true,
	}, nil
}

func buildANFCloneCreateArgs(config ANFEndpointConfig, cloneName, snapshotID string, properties *anfVolumeProperties) ([]string, error) {
	if properties.SubnetID == "" {
		return nil, fmt.Errorf("source ANF volume is missing subnetId")
	}

	vnetName := deriveVNetNameFromSubnetID(properties.SubnetID)
	if vnetName == "" {
		return nil, fmt.Errorf("failed to derive vnet name from subnetId %q", properties.SubnetID)
	}

	protocolTypes := properties.ProtocolTypes
	if len(protocolTypes) == 0 {
		switch uiProtocolType {
		case ProtocolSMB:
			protocolTypes = []string{"CIFS"}
		default:
			protocolTypes = []string{"NFSv3"}
		}
	}

	usageThresholdGiB := int64(math.Ceil(float64(properties.UsageThreshold) / (1024 * 1024 * 1024)))
	if usageThresholdGiB <= 0 {
		usageThresholdGiB = 100
	}

	args := []string{
		"netappfiles", "volume", "create",
		"--resource-group", config.ResourceGroup,
		"--account-name", config.AccountName,
		"--pool-name", config.PoolName,
		"--name", cloneName,
		"--location", properties.Location,
		"--service-level", properties.ServiceLevel,
		"--usage-threshold", fmt.Sprintf("%d", usageThresholdGiB),
		"--file-path", cloneName,
		"--vnet", vnetName,
		"--subnet-id", properties.SubnetID,
		"--snapshot-id", snapshotID,
		"--delete-base-snapshot", "true",
		"--snapshot-dir-visible", "false",
		"--output", "json",
		"--only-show-errors",
	}

	if properties.NetworkFeatures != "" {
		args = append(args, "--network-features", properties.NetworkFeatures)
	}

	if properties.SecurityStyle != "" {
		args = append(args, "--security-style", properties.SecurityStyle)
	}

	if len(properties.Zones) > 0 {
		args = append(args, "--zones")
		args = append(args, properties.Zones...)
	}

	args = append(args, "--protocol-types")
	args = append(args, protocolTypes...)

	if uiProtocolType == ProtocolNFS {
		if properties.UnixPermissions != "" {
			args = append(args, "--unix-permissions", properties.UnixPermissions)
		}

		if len(properties.ExportPolicy.Rules) > 0 {
			rulesJSON, err := json.Marshal(properties.ExportPolicy.Rules)
			if err != nil {
				return nil, fmt.Errorf("failed to encode ANF export policy rules: %w", err)
			}
			args = append(args, "--rules", string(rulesJSON))
		}
	}

	return args, nil
}

func waitForANFVolumeProvisioning(config ANFEndpointConfig, volumeName string) error {
	deadline := time.Now().Add(anfCloneTimeout)

	for time.Now().Before(deadline) {
		output, err := runAzureCLI(
			"netappfiles", "volume", "show",
			"--resource-group", config.ResourceGroup,
			"--account-name", config.AccountName,
			"--pool-name", config.PoolName,
			"--volume-name", volumeName,
			"--query", "provisioningState",
			"--output", "tsv",
			"--only-show-errors",
		)
		if err != nil {
			return err
		}

		state := strings.TrimSpace(string(output))
		switch strings.ToLower(state) {
		case "succeeded":
			return nil
		case "failed":
			return fmt.Errorf("azure reported provisioningState=Failed for %q", volumeName)
		}

		time.Sleep(anfClonePollInterval)
	}

	return fmt.Errorf("timed out waiting for ANF volume %q to reach Succeeded state", volumeName)
}

func (tm *TestVolumeManager) deleteANFCloneResources(volInfo VolumeCleanupInfo) error {
	if tm.ANFConfig == nil {
		return fmt.Errorf("ANF configuration is not set on the test volume manager")
	}
	if err := ensureAzureCLIReady(); err != nil {
		return err
	}

	var errs []string

	if volInfo.Name != "" {
		if _, err := runAzureCLI(
			"netappfiles", "volume", "delete",
			"--resource-group", tm.ANFConfig.ResourceGroup,
			"--account-name", tm.ANFConfig.AccountName,
			"--pool-name", tm.ANFConfig.PoolName,
			"--volume-name", volInfo.Name,
			"--yes",
			"--only-show-errors",
		); err != nil {
			if !isAzureNotFoundError(err) {
				errs = append(errs, fmt.Sprintf("volume %s: %v", volInfo.Name, err))
			}
		} else if err := waitForANFVolumeDeletion(*tm.ANFConfig, volInfo.Name); err != nil {
			errs = append(errs, fmt.Sprintf("volume %s deletion wait: %v", volInfo.Name, err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}

	return nil
}

func (tm *TestVolumeManager) cleanupFailedANFCloneCreate(cloneName string) error {
	return tm.deleteANFCloneResources(VolumeCleanupInfo{
		Name:    cloneName,
		IsClone: true,
	})
}

func waitForANFVolumeDeletion(config ANFEndpointConfig, volumeName string) error {
	deadline := time.Now().Add(anfCloneTimeout)

	for time.Now().Before(deadline) {
		output, err := runAzureCLI(
			"netappfiles", "volume", "show",
			"--resource-group", config.ResourceGroup,
			"--account-name", config.AccountName,
			"--pool-name", config.PoolName,
			"--volume-name", volumeName,
			"--query", "name",
			"--output", "tsv",
			"--only-show-errors",
		)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "could not be found") || strings.Contains(strings.ToLower(err.Error()), "not found") {
				return nil
			}
			return err
		}

		if strings.TrimSpace(string(output)) == "" {
			return nil
		}

		time.Sleep(anfClonePollInterval)
	}

	return fmt.Errorf("timed out waiting for ANF volume %q to be deleted", volumeName)
}

func deriveVNetNameFromSubnetID(subnetID string) string {
	parts := strings.Split(strings.Trim(subnetID, "/"), "/")
	for i := 0; i < len(parts)-1; i++ {
		if strings.EqualFold(parts[i], "virtualNetworks") {
			return parts[i+1]
		}
	}

	return ""
}

func sanitizeANFIdentifier(value string, maxLen int) string {
	cleaned := strings.TrimSpace(strings.ToLower(value))
	cleaned = strings.Trim(cleaned, "/-_. ")

	var builder strings.Builder
	lastHyphen := false

	for _, r := range cleaned {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			lastHyphen = false
			continue
		}

		if !lastHyphen {
			builder.WriteRune('-')
			lastHyphen = true
		}
	}

	result := strings.Trim(builder.String(), "-")
	if result == "" {
		result = "clone"
	}

	if len(result) > maxLen {
		result = strings.Trim(result[:maxLen], "-")
	}

	if result == "" {
		return "clone"
	}

	return result
}

func fixedANFSnapshotNameForVolume(masterVolumeName string) string {
	return fmt.Sprintf("%s_snapshot", strings.Trim(masterVolumeName, "/ "))
}

func isAzureNotFoundError(err error) bool {
	if err == nil {
		return false
	}

	lowered := strings.ToLower(err.Error())
	return strings.Contains(lowered, "could not be found") ||
		strings.Contains(lowered, "not found") ||
		strings.Contains(lowered, "resourcenotfound")
}

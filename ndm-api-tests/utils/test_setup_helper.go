package utils

import (
	"fmt"
	"os"
	"strings"

	. "github.com/onsi/ginkgo/v2"
)

// TestVolumeSetup holds configuration for test volume setup
type TestVolumeSetup struct {
	EnableCloning       bool
	CloneProvider       VolumeCloneProvider
	SourceOntapURL      string
	SourceOntapUsername string
	SourceOntapPassword string
	SourceSVMName       string
	DestOntapURL        string
	DestOntapUsername   string
	DestOntapPassword   string
	DestSVMName         string
	SourceANFConfig     *ANFEndpointConfig
	DestANFConfig       *ANFEndpointConfig
	SourceGCNVConfig    *GCNVEndpointConfig
	DestGCNVConfig      *GCNVEndpointConfig
	MasterSourceVolumes []string
	MasterDestVolumes   []string
	SourceVolumeManager *TestVolumeManager
	DestVolumeManager   *TestVolumeManager
	ClonedSourceVolumes []string
	ClonedDestVolumes   []string
	CurrentTestCase     string // Current test case identifier
}

// Global test volume setup instance
var GlobalVolumeSetup *TestVolumeSetup

// validateOntapConfiguration validates that SVM and volumes exist on ONTAP
func validateOntapConfiguration(client *OntapClient, svmName string, volumes []string, ontapType string) error {
	// Validate SVM exists
	LogDebug(fmt.Sprintf("Validating %s ONTAP SVM: %s", ontapType, svmName))
	svmExists, err := client.SVMExists(svmName)
	if err != nil {
		return fmt.Errorf("failed to check if %s SVM '%s' exists: %w", ontapType, svmName, err)
	}
	if !svmExists {
		return fmt.Errorf("%s SVM '%s' does not exist on ONTAP. Please verify the SVM name is correct", ontapType, svmName)
	}
	LogDebug(fmt.Sprintf("%s SVM '%s' validated successfully", ontapType, svmName))

	// Validate all volumes exist
	LogDebug(fmt.Sprintf("Validating %d %s volumes in SVM '%s'", len(volumes), ontapType, svmName))
	var missingVolumes []string
	for _, volumeName := range volumes {
		exists, err := client.VolumeExists(svmName, volumeName)
		if err != nil {
			return fmt.Errorf("failed to check if %s volume '%s' exists in SVM '%s': %w", ontapType, volumeName, svmName, err)
		}
		if !exists {
			missingVolumes = append(missingVolumes, volumeName)
		}
	}

	if len(missingVolumes) > 0 {
		return fmt.Errorf("%s volumes not found in SVM '%s': %v. Please verify volume names are correct", ontapType, svmName, missingVolumes)
	}

	LogDebug(fmt.Sprintf("All %d %s volumes validated successfully", len(volumes), ontapType))
	return nil
}

func initializeANFTestVolumeSetup(sourceVolumesEnv, destVolumesEnv, protocolLabel string) (*TestVolumeSetup, error) {
	sourceConfig := resolveANFEndpointConfig(protocolLabel, "SOURCE")
	destConfig := resolveANFEndpointConfig(protocolLabel, "DEST")
	protocolKey := strings.ToUpper(strings.TrimSpace(protocolLabel))

	setup := &TestVolumeSetup{
		EnableCloning:   true,
		CloneProvider:   VolumeCloneProviderANF,
		SourceANFConfig: sourceConfig,
		DestANFConfig:   destConfig,
	}

	if setup.SourceANFConfig.ResourceGroup == "" || setup.SourceANFConfig.AccountName == "" || setup.SourceANFConfig.PoolName == "" {
		return nil, fmt.Errorf(
			"ANF source configuration incomplete. Required: AZURE_ANF_%s_SOURCE_RESOURCE_GROUP, AZURE_ANF_%s_SOURCE_ACCOUNT_NAME, AZURE_ANF_%s_SOURCE_POOL_NAME",
			protocolKey, protocolKey, protocolKey,
		)
	}

	if setup.DestANFConfig.ResourceGroup == "" || setup.DestANFConfig.AccountName == "" || setup.DestANFConfig.PoolName == "" {
		return nil, fmt.Errorf(
			"ANF destination configuration incomplete. Required: AZURE_ANF_%s_DEST_RESOURCE_GROUP, AZURE_ANF_%s_DEST_ACCOUNT_NAME, AZURE_ANF_%s_DEST_POOL_NAME",
			protocolKey, protocolKey, protocolKey,
		)
	}

	if sourceVolumesEnv == "" || destVolumesEnv == "" {
		return nil, fmt.Errorf("%s ANF master volumes must be set before running ANF clone tests", protocolLabel)
	}

	setup.MasterSourceVolumes = ParseVolumeNames(sourceVolumesEnv)
	setup.MasterDestVolumes = ParseVolumeNames(destVolumesEnv)

	if len(setup.MasterSourceVolumes) == 0 {
		return nil, fmt.Errorf("%s ANF source volumes are empty or invalid", protocolLabel)
	}
	if len(setup.MasterDestVolumes) == 0 {
		return nil, fmt.Errorf("%s ANF destination volumes are empty or invalid", protocolLabel)
	}

	LogDebug(fmt.Sprintf("%s ANF cloning initialized", protocolLabel))
	LogDebug(fmt.Sprintf("Source ANF account: %s/%s/%s", setup.SourceANFConfig.ResourceGroup, setup.SourceANFConfig.AccountName, setup.SourceANFConfig.PoolName))
	LogDebug(fmt.Sprintf("Destination ANF account: %s/%s/%s", setup.DestANFConfig.ResourceGroup, setup.DestANFConfig.AccountName, setup.DestANFConfig.PoolName))
	LogDebug(fmt.Sprintf("%s ANF source volumes to clone: %v", protocolLabel, setup.MasterSourceVolumes))
	LogDebug(fmt.Sprintf("%s ANF destination volumes to clone: %v", protocolLabel, setup.MasterDestVolumes))

	return setup, nil
}

func resolveANFEndpointConfig(protocolLabel, endpoint string) *ANFEndpointConfig {
	protocolKey := strings.ToUpper(strings.TrimSpace(protocolLabel))
	endpointKey := strings.ToUpper(strings.TrimSpace(endpoint))

	return &ANFEndpointConfig{
		ResourceGroup: strings.TrimSpace(os.Getenv(fmt.Sprintf("AZURE_ANF_%s_%s_RESOURCE_GROUP", protocolKey, endpointKey))),
		AccountName:   strings.TrimSpace(os.Getenv(fmt.Sprintf("AZURE_ANF_%s_%s_ACCOUNT_NAME", protocolKey, endpointKey))),
		PoolName:      strings.TrimSpace(os.Getenv(fmt.Sprintf("AZURE_ANF_%s_%s_POOL_NAME", protocolKey, endpointKey))),
	}
}

func initializeGCNVTestVolumeSetup(sourceVolumesEnv, destVolumesEnv, protocolLabel string) (*TestVolumeSetup, error) {
	sourceConfig := resolveGCNVEndpointConfig(protocolLabel, "SOURCE")
	destConfig := resolveGCNVEndpointConfig(protocolLabel, "DEST")
	protocolKey := strings.ToUpper(strings.TrimSpace(protocolLabel))

	setup := &TestVolumeSetup{
		EnableCloning:    true,
		CloneProvider:    VolumeCloneProviderGCNV,
		SourceGCNVConfig: sourceConfig,
		DestGCNVConfig:   destConfig,
	}

	if setup.SourceGCNVConfig.ProjectID == "" || setup.SourceGCNVConfig.Location == "" || setup.SourceGCNVConfig.StoragePool == "" {
		return nil, fmt.Errorf(
			"GCNV source configuration incomplete. Required: GCP_GCNV_PROJECT_ID, GCP_GCNV_LOCATION, GCP_GCNV_%s_SOURCE_STORAGE_POOL",
			protocolKey,
		)
	}

	if setup.DestGCNVConfig.ProjectID == "" || setup.DestGCNVConfig.Location == "" || setup.DestGCNVConfig.StoragePool == "" {
		return nil, fmt.Errorf(
			"GCNV destination configuration incomplete. Required: GCP_GCNV_PROJECT_ID, GCP_GCNV_LOCATION, GCP_GCNV_%s_DEST_STORAGE_POOL",
			protocolKey,
		)
	}

	if sourceVolumesEnv == "" || destVolumesEnv == "" {
		return nil, fmt.Errorf("%s GCNV master volumes must be set before running GCNV clone tests", protocolLabel)
	}

	setup.MasterSourceVolumes = ParseVolumeNames(sourceVolumesEnv)
	setup.MasterDestVolumes = ParseVolumeNames(destVolumesEnv)

	if len(setup.MasterSourceVolumes) == 0 {
		return nil, fmt.Errorf("%s GCNV source volumes are empty or invalid", protocolLabel)
	}
	if len(setup.MasterDestVolumes) == 0 {
		return nil, fmt.Errorf("%s GCNV destination volumes are empty or invalid", protocolLabel)
	}

	LogDebug(fmt.Sprintf("%s GCNV cloning initialized", protocolLabel))
	LogDebug(fmt.Sprintf("Source GCNV: project=%s location=%s pool=%s", setup.SourceGCNVConfig.ProjectID, setup.SourceGCNVConfig.Location, setup.SourceGCNVConfig.StoragePool))
	LogDebug(fmt.Sprintf("Destination GCNV: project=%s location=%s pool=%s", setup.DestGCNVConfig.ProjectID, setup.DestGCNVConfig.Location, setup.DestGCNVConfig.StoragePool))
	LogDebug(fmt.Sprintf("%s GCNV source volumes to clone: %v", protocolLabel, setup.MasterSourceVolumes))
	LogDebug(fmt.Sprintf("%s GCNV destination volumes to clone: %v", protocolLabel, setup.MasterDestVolumes))

	return setup, nil
}

func resolveGCNVEndpointConfig(protocolLabel, endpoint string) *GCNVEndpointConfig {
	protocolKey := strings.ToUpper(strings.TrimSpace(protocolLabel))
	endpointKey := strings.ToUpper(strings.TrimSpace(endpoint))

	return &GCNVEndpointConfig{
		ProjectID:   strings.TrimSpace(os.Getenv("GCP_GCNV_PROJECT_ID")),
		Location:    strings.TrimSpace(os.Getenv("GCP_GCNV_LOCATION")),
		StoragePool: strings.TrimSpace(os.Getenv(fmt.Sprintf("GCP_GCNV_%s_%s_STORAGE_POOL", protocolKey, endpointKey))),
	}
}

func currentTestIdentifier() string {
	report := CurrentSpecReport()
	parts := make([]string, 0, len(report.ContainerHierarchyTexts)+1)

	for _, text := range report.ContainerHierarchyTexts {
		trimmed := strings.TrimSpace(text)
		if trimmed != "" {
			parts = append(parts, trimmed)
		}
	}

	if trimmedLeaf := strings.TrimSpace(report.LeafNodeText); trimmedLeaf != "" {
		parts = append(parts, trimmedLeaf)
	}

	if len(parts) == 0 {
		return "test"
	}

	return strings.Join(parts, " / ")
}

func countCreatedClones(cloneNames []string) int {
	count := 0
	for _, cloneName := range cloneNames {
		if strings.TrimSpace(cloneName) != "" {
			count++
		}
	}

	return count
}

func logCreatedClones(title string, cloneNames, masterVolumes []string) {
	fmt.Printf("\n========================================\n")
	fmt.Printf("%s\n", title)
	for i, cloneName := range cloneNames {
		if strings.TrimSpace(cloneName) == "" {
			continue
		}
		fmt.Printf("  [%d] %s (from %s)\n", i+1, cloneName, masterVolumes[i])
	}
	fmt.Printf("========================================\n\n")
}

// InitializeNFSTestVolumeSetup reads NFS-specific configuration from environment variables
func InitializeNFSTestVolumeSetup() (*TestVolumeSetup, error) {
	setup := &TestVolumeSetup{
		EnableCloning:       true, // Always enable cloning
		CloneProvider:       VOLUME_CLONE_PROVIDER,
		SourceOntapURL:      ONTAP_SRC_API_URL,
		SourceOntapUsername: ONTAP_SYSTEM_MANAGER_SRC_USERNAME,
		SourceOntapPassword: ONTAP_SYSTEM_MANAGER_SRC_PASSWORD,
		SourceSVMName:       ONTAP_SRC_SVM_NAME,
		DestOntapURL:        ONTAP_DST_API_URL,
		DestOntapUsername:   ONTAP_SYSTEM_MANAGER_DST_USERNAME,
		DestOntapPassword:   ONTAP_SYSTEM_MANAGER_DST_PASSWORD,
		DestSVMName:         ONTAP_DST_SVM_NAME,
	}

	if VOLUME_CLONE_PROVIDER == VolumeCloneProviderANF {
		return initializeANFTestVolumeSetup(
			os.Getenv("AZURE_NFS_SOURCE_VOLUMES"),
			os.Getenv("AZURE_NFS_DEST_VOLUMES"),
			"NFS",
		)
	}

	if VOLUME_CLONE_PROVIDER == VolumeCloneProviderGCNV {
		return initializeGCNVTestVolumeSetup(
			os.Getenv("GCP_NFS_SOURCE_VOLUMES"),
			os.Getenv("GCP_NFS_DEST_VOLUMES"),
			"NFS",
		)
	}

	// Validate required source configuration
	if setup.SourceOntapURL == "" || setup.SourceOntapUsername == "" || setup.SourceOntapPassword == "" || setup.SourceSVMName == "" {
		return nil, fmt.Errorf("ONTAP source configuration incomplete. Required: ONTAP_SRC_API_URL, ONTAP_SYSTEM_MANAGER_SRC_USERNAME, ONTAP_SYSTEM_MANAGER_SRC_PASSWORD, ONTAP_SRC_SVM_NAME")
	}

	// Validate required destination configuration
	if setup.DestOntapURL == "" || setup.DestOntapUsername == "" || setup.DestOntapPassword == "" || setup.DestSVMName == "" {
		return nil, fmt.Errorf("ONTAP destination configuration incomplete. Required: ONTAP_DST_API_URL, ONTAP_SYSTEM_MANAGER_DST_USERNAME, ONTAP_SYSTEM_MANAGER_DST_PASSWORD, ONTAP_DST_SVM_NAME")
	}

	LogDebug("NFS volume cloning initialized")
	LogDebug(fmt.Sprintf("Source ONTAP URL: %s, SVM: %s", setup.SourceOntapURL, setup.SourceSVMName))
	LogDebug(fmt.Sprintf("Destination ONTAP URL: %s, SVM: %s", setup.DestOntapURL, setup.DestSVMName))

	// Read NFS volumes from environment variables
	if ONTAP_NFS_SOURCE_VOLUMES == "" || ONTAP_NFS_DEST_VOLUMES == "" {
		return nil, fmt.Errorf("ONTAP_NFS_SOURCE_VOLUMES and ONTAP_NFS_DEST_VOLUMES must be set")
	}

	setup.MasterSourceVolumes = ParseVolumeNames(ONTAP_NFS_SOURCE_VOLUMES)
	setup.MasterDestVolumes = ParseVolumeNames(ONTAP_NFS_DEST_VOLUMES)

	if len(setup.MasterSourceVolumes) == 0 {
		return nil, fmt.Errorf("ONTAP_NFS_SOURCE_VOLUMES is empty or invalid")
	}
	if len(setup.MasterDestVolumes) == 0 {
		return nil, fmt.Errorf("ONTAP_NFS_DEST_VOLUMES is empty or invalid")
	}

	LogDebug(fmt.Sprintf("NFS source volumes to clone: %v", setup.MasterSourceVolumes))
	LogDebug(fmt.Sprintf("NFS destination volumes to clone: %v", setup.MasterDestVolumes))

	// Validate source ONTAP configuration
	sourceClient := NewOntapClient(setup.SourceOntapURL, setup.SourceOntapUsername, setup.SourceOntapPassword)
	if err := validateOntapConfiguration(sourceClient, setup.SourceSVMName, setup.MasterSourceVolumes, "source NFS"); err != nil {
		return nil, err
	}

	// Validate destination ONTAP configuration
	destClient := NewOntapClient(setup.DestOntapURL, setup.DestOntapUsername, setup.DestOntapPassword)
	if err := validateOntapConfiguration(destClient, setup.DestSVMName, setup.MasterDestVolumes, "destination NFS"); err != nil {
		return nil, err
	}

	return setup, nil
}

// InitializeSMBTestVolumeSetup reads SMB-specific configuration from environment variables
func InitializeSMBTestVolumeSetup() (*TestVolumeSetup, error) {
	setup := &TestVolumeSetup{
		EnableCloning:       true, // Always enable cloning
		CloneProvider:       VOLUME_CLONE_PROVIDER,
		SourceOntapURL:      ONTAP_SRC_API_URL,
		SourceOntapUsername: ONTAP_SYSTEM_MANAGER_SRC_USERNAME,
		SourceOntapPassword: ONTAP_SYSTEM_MANAGER_SRC_PASSWORD,
		SourceSVMName:       ONTAP_SRC_SVM_NAME,
		DestOntapURL:        ONTAP_DST_API_URL,
		DestOntapUsername:   ONTAP_SYSTEM_MANAGER_DST_USERNAME,
		DestOntapPassword:   ONTAP_SYSTEM_MANAGER_DST_PASSWORD,
		DestSVMName:         ONTAP_DST_SVM_NAME,
	}

	if VOLUME_CLONE_PROVIDER == VolumeCloneProviderANF {
		return initializeANFTestVolumeSetup(
			os.Getenv("AZURE_SMB_SOURCE_VOLUMES"),
			os.Getenv("AZURE_SMB_DEST_VOLUMES"),
			"SMB",
		)
	}

	if VOLUME_CLONE_PROVIDER == VolumeCloneProviderGCNV {
		return initializeGCNVTestVolumeSetup(
			os.Getenv("GCP_SMB_SOURCE_VOLUMES"),
			os.Getenv("GCP_SMB_DEST_VOLUMES"),
			"SMB",
		)
	}

	// Validate required source configuration
	if setup.SourceOntapURL == "" || setup.SourceOntapUsername == "" || setup.SourceOntapPassword == "" || setup.SourceSVMName == "" {
		return nil, fmt.Errorf("ONTAP source configuration incomplete. Required: ONTAP_SRC_API_URL, ONTAP_SYSTEM_MANAGER_SRC_USERNAME, ONTAP_SYSTEM_MANAGER_SRC_PASSWORD, ONTAP_SRC_SVM_NAME")
	}

	// Validate required destination configuration
	if setup.DestOntapURL == "" || setup.DestOntapUsername == "" || setup.DestOntapPassword == "" || setup.DestSVMName == "" {
		return nil, fmt.Errorf("ONTAP destination configuration incomplete. Required: ONTAP_DST_API_URL, ONTAP_SYSTEM_MANAGER_DST_USERNAME, ONTAP_SYSTEM_MANAGER_DST_PASSWORD, ONTAP_DST_SVM_NAME")
	}

	LogDebug("SMB volume cloning initialized")
	LogDebug(fmt.Sprintf("Source ONTAP URL: %s, SVM: %s", setup.SourceOntapURL, setup.SourceSVMName))
	LogDebug(fmt.Sprintf("Destination ONTAP URL: %s, SVM: %s", setup.DestOntapURL, setup.DestSVMName))

	// Read SMB volumes from environment variables
	if ONTAP_SMB_SOURCE_VOLUMES == "" || ONTAP_SMB_DEST_VOLUMES == "" {
		return nil, fmt.Errorf("ONTAP_SMB_SOURCE_VOLUMES and ONTAP_SMB_DEST_VOLUMES must be set")
	}

	setup.MasterSourceVolumes = ParseVolumeNames(ONTAP_SMB_SOURCE_VOLUMES)
	setup.MasterDestVolumes = ParseVolumeNames(ONTAP_SMB_DEST_VOLUMES)

	if len(setup.MasterSourceVolumes) == 0 {
		return nil, fmt.Errorf("ONTAP_SMB_SOURCE_VOLUMES is empty or invalid")
	}
	if len(setup.MasterDestVolumes) == 0 {
		return nil, fmt.Errorf("ONTAP_SMB_DEST_VOLUMES is empty or invalid")
	}

	LogDebug(fmt.Sprintf("SMB source volumes to clone: %v", setup.MasterSourceVolumes))
	LogDebug(fmt.Sprintf("SMB destination volumes to clone: %v", setup.MasterDestVolumes))

	// Validate source ONTAP configuration
	sourceClient := NewOntapClient(setup.SourceOntapURL, setup.SourceOntapUsername, setup.SourceOntapPassword)
	if err := validateOntapConfiguration(sourceClient, setup.SourceSVMName, setup.MasterSourceVolumes, "source SMB"); err != nil {
		return nil, err
	}

	// Validate destination ONTAP configuration
	destClient := NewOntapClient(setup.DestOntapURL, setup.DestOntapUsername, setup.DestOntapPassword)
	if err := validateOntapConfiguration(destClient, setup.DestSVMName, setup.MasterDestVolumes, "destination SMB"); err != nil {
		return nil, err
	}

	return setup, nil
}

// InitializeTestVolumeSetup reads configuration from environment variables based on protocol type
func InitializeTestVolumeSetup() (*TestVolumeSetup, error) {
	if PROTOCOL_TYPE == ProtocolNFS {
		return InitializeNFSTestVolumeSetup()
	} else if PROTOCOL_TYPE == ProtocolSMB {
		return InitializeSMBTestVolumeSetup()
	}
	return nil, fmt.Errorf("unsupported PROTOCOL_TYPE: %s. Must be 'NFS' or 'SMB'", PROTOCOL_TYPE)
}

// SetupTestVolumesBeforeEach creates volume clones before each test
// This should be called in BeforeEach() in your test files
// Automatically extracts test case ID from Ginkgo CurrentSpecReport
// Returns the cloned source and destination volume names, plus managers for cleanup
// For parallel test execution, each test gets its own volume managers
func SetupTestVolumesBeforeEach() ([]string, []string, *TestVolumeManager, *TestVolumeManager, error) {
	// Lazy initialization: create setup on first call if not already initialized
	if GlobalVolumeSetup == nil {
		setup, err := InitializeTestVolumeSetup()
		if err != nil {
			return nil, nil, nil, nil, fmt.Errorf("failed to initialize volume setup: %w", err)
		}
		GlobalVolumeSetup = setup
	}

	// Auto-detect test case ID from Ginkgo context.
	testCaseID := currentTestIdentifier()

	// Set current test case in environment for volume naming
	os.Setenv("CURRENT_TEST_CASE", testCaseID)
	GlobalVolumeSetup.CurrentTestCase = testCaseID

	LogDebug(fmt.Sprintf("Setting up %s test volumes for test case: %s", GlobalVolumeSetup.CloneProvider, testCaseID))

	// Create NEW volume managers for THIS test (not stored in global state to avoid race conditions)
	var sourceVolumeManager *TestVolumeManager
	var destVolumeManager *TestVolumeManager

	if GlobalVolumeSetup.CloneProvider == VolumeCloneProviderANF {
		sourceVolumeManager = NewANFTestVolumeManager(*GlobalVolumeSetup.SourceANFConfig)
		destVolumeManager = NewANFTestVolumeManager(*GlobalVolumeSetup.DestANFConfig)
	} else if GlobalVolumeSetup.CloneProvider == VolumeCloneProviderGCNV {
		sourceVolumeManager = NewGCNVTestVolumeManager(*GlobalVolumeSetup.SourceGCNVConfig)
		destVolumeManager = NewGCNVTestVolumeManager(*GlobalVolumeSetup.DestGCNVConfig)
	} else {
		sourceVolumeManager = NewTestVolumeManager(
			GlobalVolumeSetup.SourceOntapURL,
			GlobalVolumeSetup.SourceOntapUsername,
			GlobalVolumeSetup.SourceOntapPassword,
			GlobalVolumeSetup.SourceSVMName,
			"", // runnerID not needed anymore
		)

		destVolumeManager = NewTestVolumeManager(
			GlobalVolumeSetup.DestOntapURL,
			GlobalVolumeSetup.DestOntapUsername,
			GlobalVolumeSetup.DestOntapPassword,
			GlobalVolumeSetup.DestSVMName,
			"", // runnerID not needed anymore
		)
	}

	selection := CloneSelection{
		SourceIndices: allIndices(len(GlobalVolumeSetup.MasterSourceVolumes)),
		DestIndices:   allIndices(len(GlobalVolumeSetup.MasterDestVolumes)),
	}
	if GlobalVolumeSetup.CloneProvider == VolumeCloneProviderANF || GlobalVolumeSetup.CloneProvider == VolumeCloneProviderGCNV {
		selection = RequiredCloneSelectionForTest(testCaseID, PROTOCOL_TYPE)
		LogDebug(fmt.Sprintf("[%s] Using selective %s cloning. Source indices: %v Destination indices: %v", testCaseID, GlobalVolumeSetup.CloneProvider, selection.SourceIndices, selection.DestIndices))
	}

	LogDebug(fmt.Sprintf("[%s] Creating source volume clone(s) from base volumes: %v", testCaseID, GlobalVolumeSetup.MasterSourceVolumes))
	sourceClones, err := sourceVolumeManager.CreateSelectedClones(GlobalVolumeSetup.MasterSourceVolumes, selection.SourceIndices)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("failed to create source volume clones: %w", err)
	}
	LogDebug(fmt.Sprintf("[%s] Source clones created: %v", testCaseID, sourceClones))
	logCreatedClones("SOURCE VOLUME CLONES CREATED:", sourceClones, GlobalVolumeSetup.MasterSourceVolumes)

	LogDebug(fmt.Sprintf("[%s] Creating destination volume clone(s) from base volumes: %v", testCaseID, GlobalVolumeSetup.MasterDestVolumes))
	destClones, err := destVolumeManager.CreateSelectedClones(GlobalVolumeSetup.MasterDestVolumes, selection.DestIndices)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("failed to create destination volume clones: %w", err)
	}
	LogDebug(fmt.Sprintf("[%s] Destination clones created: %v", testCaseID, destClones))
	logCreatedClones("DESTINATION VOLUME CLONES CREATED:", destClones, GlobalVolumeSetup.MasterDestVolumes)

	LogDebug(fmt.Sprintf("[%s] Successfully configured %d source and %d destination volumes", testCaseID, countCreatedClones(sourceClones), countCreatedClones(destClones)))

	// Return the cloned volume names AND managers for this specific test
	// Each test maintains its own managers to avoid race conditions in parallel execution
	return sourceClones, destClones, sourceVolumeManager, destVolumeManager, nil
}

// CleanupTestVolumesAfterEach deletes cloned volumes after each test
// Pass in the specific volume managers returned from SetupTestVolumesBeforeEach
// This ensures each test only cleans up its own volumes (critical for parallel execution)
func CleanupTestVolumesAfterEach(sourceManager, destManager *TestVolumeManager) error {
	if sourceManager == nil && destManager == nil {
		return nil
	}

	LogDebug("Cleaning up test volumes")

	var cleanupErr error

	// Cleanup source volumes
	if sourceManager != nil {
		err := sourceManager.CleanupAllVolumes()
		if err != nil {
			LogDebug(fmt.Sprintf("Error cleaning up source volumes: %v", err))
			cleanupErr = err
		}
	}

	// Cleanup destination volumes
	if destManager != nil {
		err := destManager.CleanupAllVolumes()
		if err != nil {
			LogDebug(fmt.Sprintf("Error cleaning up destination volumes: %v", err))
			if cleanupErr == nil {
				cleanupErr = err
			}
		}
	}

	return cleanupErr
}

// GetADServerSMBVolumes returns the AD Server SMB volumes that cannot be cloned.
// Selects the correct env vars based on CLOUD_ENVIRONMENT (Azure vs GCP).
func GetADServerSMBVolumes() (volumes []string, hostIPs []string) {
	var volumesKey, hostIPsKey string

	switch CLOUD_ENVIRONMENT {
	case GcpEnv:
		volumesKey = "GCP_AD_SMB_SOURCE_VOLUMES"
		hostIPsKey = "GCP_AD_SMB_SOURCE_HOST_IP"
	default:
		volumesKey = "AZURE_AD_SMB_SOURCE_VOLUMES"
		hostIPsKey = "AZURE_AD_SMB_SOURCE_HOST_IP"
	}

	volumesStr := os.Getenv(volumesKey)
	hostIPsStr := os.Getenv(hostIPsKey)

	if volumesStr == "" {
		LogDebug(fmt.Sprintf("%s not configured, returning empty list", volumesKey))
		return []string{}, []string{}
	}

	volumes = ParseVolumeNames(volumesStr)
	hostIPs = ParseVolumeNames(hostIPsStr)

	LogDebug(fmt.Sprintf("AD Server SMB volumes (%s): %v (hosts: %v)", CLOUD_ENVIRONMENT, volumes, hostIPs))
	return volumes, hostIPs
}

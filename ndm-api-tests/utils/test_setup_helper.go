package utils

import (
	"fmt"
	"os"

	. "github.com/onsi/ginkgo/v2"
)

// TestVolumeSetup holds configuration for test volume setup
type TestVolumeSetup struct {
	EnableCloning       bool
	SourceOntapURL      string
	SourceOntapUsername string
	SourceOntapPassword string
	SourceSVMName       string
	DestOntapURL        string
	DestOntapUsername   string
	DestOntapPassword   string
	DestSVMName         string
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

// InitializeNFSTestVolumeSetup reads NFS-specific configuration from environment variables
func InitializeNFSTestVolumeSetup() (*TestVolumeSetup, error) {
	setup := &TestVolumeSetup{
		EnableCloning:       true, // Always enable cloning
		SourceOntapURL:      ONTAP_SRC_API_URL,
		SourceOntapUsername: ONTAP_SYSTEM_MANAGER_SRC_USERNAME,
		SourceOntapPassword: ONTAP_SYSTEM_MANAGER_SRC_PASSWORD,
		SourceSVMName:       ONTAP_SRC_SVM_NAME,
		DestOntapURL:        ONTAP_DST_API_URL,
		DestOntapUsername:   ONTAP_SYSTEM_MANAGER_DST_USERNAME,
		DestOntapPassword:   ONTAP_SYSTEM_MANAGER_DST_PASSWORD,
		DestSVMName:         ONTAP_DST_SVM_NAME,
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
		SourceOntapURL:      ONTAP_SRC_API_URL,
		SourceOntapUsername: ONTAP_SYSTEM_MANAGER_SRC_USERNAME,
		SourceOntapPassword: ONTAP_SYSTEM_MANAGER_SRC_PASSWORD,
		SourceSVMName:       ONTAP_SRC_SVM_NAME,
		DestOntapURL:        ONTAP_DST_API_URL,
		DestOntapUsername:   ONTAP_SYSTEM_MANAGER_DST_USERNAME,
		DestOntapPassword:   ONTAP_SYSTEM_MANAGER_DST_PASSWORD,
		DestSVMName:         ONTAP_DST_SVM_NAME,
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

	// Auto-detect test case ID from Ginkgo context
	testCaseID := "test"
	if CurrentSpecReport().LeafNodeText != "" {
		testCaseID = CurrentSpecReport().LeafNodeText
	}
	// Try to extract from parent context if available
	if CurrentSpecReport().ContainerHierarchyTexts != nil && len(CurrentSpecReport().ContainerHierarchyTexts) > 0 {
		// Use the first Describe block name which typically contains TC-XXX
		testCaseID = CurrentSpecReport().ContainerHierarchyTexts[0]
	}

	// Set current test case in environment for volume naming
	os.Setenv("CURRENT_TEST_CASE", testCaseID)
	GlobalVolumeSetup.CurrentTestCase = testCaseID

	LogDebug(fmt.Sprintf("Setting up test volumes for test case: %s", testCaseID))

	// Create NEW volume managers for THIS test (not stored in global state to avoid race conditions)
	sourceVolumeManager := NewTestVolumeManager(
		GlobalVolumeSetup.SourceOntapURL,
		GlobalVolumeSetup.SourceOntapUsername,
		GlobalVolumeSetup.SourceOntapPassword,
		GlobalVolumeSetup.SourceSVMName,
		"", // runnerID not needed anymore
	)

	// Create destination volume manager
	destVolumeManager := NewTestVolumeManager(
		GlobalVolumeSetup.DestOntapURL,
		GlobalVolumeSetup.DestOntapUsername,
		GlobalVolumeSetup.DestOntapPassword,
		GlobalVolumeSetup.DestSVMName,
		"", // runnerID not needed anymore
	)

	// Create source volume clones on source ONTAP
	LogDebug(fmt.Sprintf("[%s] Creating %d source volume clone(s) from base volumes: %v", testCaseID, len(GlobalVolumeSetup.MasterSourceVolumes), GlobalVolumeSetup.MasterSourceVolumes))
	sourceClones, err := sourceVolumeManager.CreateMultipleClones(GlobalVolumeSetup.MasterSourceVolumes)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("failed to create source volume clones: %w", err)
	}
	LogDebug(fmt.Sprintf("[%s] Source clones created: %v", testCaseID, sourceClones))
	fmt.Printf("\n========================================\n")
	fmt.Printf("SOURCE VOLUME CLONES CREATED:\n")
	for i, cloneName := range sourceClones {
		fmt.Printf("  [%d] %s (from %s)\n", i+1, cloneName, GlobalVolumeSetup.MasterSourceVolumes[i])
	}
	fmt.Printf("========================================\n\n")

	// Create destination volume clones on destination ONTAP
	LogDebug(fmt.Sprintf("[%s] Creating %d destination volume clone(s) from base volumes: %v", testCaseID, len(GlobalVolumeSetup.MasterDestVolumes), GlobalVolumeSetup.MasterDestVolumes))
	destClones, err := destVolumeManager.CreateMultipleClones(GlobalVolumeSetup.MasterDestVolumes)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("failed to create destination volume clones: %w", err)
	}
	LogDebug(fmt.Sprintf("[%s] Destination clones created: %v", testCaseID, destClones))
	fmt.Printf("\n========================================\n")
	fmt.Printf("DESTINATION VOLUME CLONES CREATED:\n")
	for i, cloneName := range destClones {
		fmt.Printf("  [%d] %s (from %s)\n", i+1, cloneName, GlobalVolumeSetup.MasterDestVolumes[i])
	}
	fmt.Printf("========================================\n\n")

	LogDebug(fmt.Sprintf("[%s] Successfully configured %d source and %d destination volumes", testCaseID, len(sourceClones), len(destClones)))

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

// GetADServerSMBVolumes returns the AD Server SMB volumes that cannot be cloned
// These volumes are used directly by tests that need pre-existing AD server structure
func GetADServerSMBVolumes() (volumes []string, hostIPs []string) {
	volumesStr := os.Getenv("AD_SMB_SOURCE_VOLUMES")
	hostIPsStr := os.Getenv("AD_SMB_SOURCE_HOST_IP")

	if volumesStr == "" {
		LogDebug("AD_SMB_SOURCE_VOLUMES not configured, returning empty list")
		return []string{}, []string{}
	}

	volumes = ParseVolumeNames(volumesStr)
	hostIPs = ParseVolumeNames(hostIPsStr)

	LogDebug(fmt.Sprintf("AD Server SMB volumes: %v (hosts: %v)", volumes, hostIPs))
	return volumes, hostIPs
}

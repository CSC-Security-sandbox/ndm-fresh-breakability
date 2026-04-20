package utils

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const maxANFCloneVolumeNameLength = 64

var testCaseIDPattern = regexp.MustCompile(`(?i)\b[a-z]+-\d+\b`)

// TestVolumeManager manages creation and cleanup of test volumes
type TestVolumeManager struct {
	CloneProvider  VolumeCloneProvider
	OntapClient    *OntapClient
	ANFConfig      *ANFEndpointConfig
	SVMName        string
	RunnerID       string
	CreatedVolumes []VolumeCleanupInfo
	mu             sync.Mutex
}

// VolumeCleanupInfo stores information for volume cleanup
type VolumeCleanupInfo struct {
	UUID    string
	Name    string
	SVMName string
	IsClone bool
}

// NewTestVolumeManager creates a new test volume manager
func NewTestVolumeManager(ontapBaseURL, username, password, svmName, runnerID string) *TestVolumeManager {
	return &TestVolumeManager{
		CloneProvider:  VolumeCloneProviderONTAP,
		OntapClient:    NewOntapClient(ontapBaseURL, username, password),
		SVMName:        svmName,
		RunnerID:       runnerID,
		CreatedVolumes: []VolumeCleanupInfo{},
	}
}

// NewANFTestVolumeManager creates a test volume manager backed by Azure NetApp Files.
func NewANFTestVolumeManager(config ANFEndpointConfig) *TestVolumeManager {
	return &TestVolumeManager{
		CloneProvider:  VolumeCloneProviderANF,
		ANFConfig:      &config,
		CreatedVolumes: []VolumeCleanupInfo{},
	}
}

// GenerateVolumeName creates a unique volume name for the test run.
// ONTAP format: {baseVolumeName}_{testCase_truncated_10chars}_{uniqueID}
// ANF format: {baseVolumeName}-{testCaseID}-{uniqueID}
func (tm *TestVolumeManager) GenerateVolumeName(baseVolumeName string) string {
	// Get test case from environment if set by BeforeEach
	testCase := os.Getenv("CURRENT_TEST_CASE")
	if testCase == "" {
		testCase = "test"
	}

	// Generate short unique ID (8 characters from UUID)
	// This is more reliable than timestamps and avoids timing issues
	uuid := uuid.New().String()
	uniqueID := strings.ReplaceAll(uuid[:8], "-", "")

	if tm.CloneProvider == VolumeCloneProviderANF {
		return buildANFCloneVolumeName(baseVolumeName, testCase, uniqueID)
	}

	// Remove leading/trailing slashes and spaces
	cleanBaseName := strings.Trim(baseVolumeName, "/ ")

	// Clean test case name (remove special characters, keep only alphanumeric and underscores)
	// ONTAP volume names can only contain alphanumeric characters and underscores
	cleanTestCase := strings.ReplaceAll(testCase, " ", "_")
	cleanTestCase = strings.ReplaceAll(cleanTestCase, "/", "_")
	cleanTestCase = strings.ReplaceAll(cleanTestCase, "-", "_")
	cleanTestCase = strings.ReplaceAll(cleanTestCase, ":", "_")
	cleanTestCase = strings.ReplaceAll(cleanTestCase, "(", "_")
	cleanTestCase = strings.ReplaceAll(cleanTestCase, ")", "_")
	cleanTestCase = strings.ReplaceAll(cleanTestCase, ",", "_")
	cleanTestCase = strings.ReplaceAll(cleanTestCase, ".", "_")
	cleanTestCase = strings.ReplaceAll(cleanTestCase, "'", "_")
	cleanTestCase = strings.ReplaceAll(cleanTestCase, "\"", "_")
	cleanTestCase = strings.ToLower(cleanTestCase)

	// Restrict test case name to 10 characters max
	if len(cleanTestCase) > 10 {
		cleanTestCase = cleanTestCase[:10]
	}

	// Create volume name: baseName_testCase(max10)_uniqueID(8)
	volumeName := fmt.Sprintf("%s_%s_%s", cleanBaseName, cleanTestCase, uniqueID)

	// Ensure name doesn't exceed ONTAP limits (typically 203 characters for volumes)
	if len(volumeName) > 200 {
		// If still too long, truncate the base name
		maxBaseLen := 200 - len(cleanTestCase) - len(uniqueID) - 2
		if maxBaseLen > 0 && maxBaseLen < len(cleanBaseName) {
			cleanBaseName = cleanBaseName[:maxBaseLen]
			volumeName = fmt.Sprintf("%s_%s_%s", cleanBaseName, cleanTestCase, uniqueID)
		}
	}

	return volumeName
}

func buildANFCloneVolumeName(baseVolumeName, testCase, uniqueID string) string {
	testCaseSlug := anfTestCaseSlug(testCase)

	remainingBaseLen := maxANFCloneVolumeNameLength - len(uniqueID) - 1 // hyphen before uniqueID
	if testCaseSlug != "" {
		remainingBaseLen -= len(testCaseSlug) + 1 // hyphen before test case id
	}
	if remainingBaseLen < 1 {
		remainingBaseLen = 1
	}

	cleanBaseName := sanitizeANFIdentifier(baseVolumeName, remainingBaseLen)
	return strings.Join([]string{cleanBaseName, testCaseSlug, uniqueID}, "-")
}

func anfTestCaseSlug(testCase string) string {
	if match := testCaseIDPattern.FindString(testCase); match != "" {
		return sanitizeANFIdentifier(match, 16)
	}

	return sanitizeANFIdentifier(testCase, 12)
}

// CreateCloneVolume creates a clone of the master volume for testing
func (tm *TestVolumeManager) CreateCloneVolume(masterVolumeName string) (string, error) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	if tm.CloneProvider == VolumeCloneProviderANF {
		volInfo, err := tm.createANFCloneVolume(masterVolumeName)
		if err != nil {
			return "", err
		}

		tm.CreatedVolumes = append(tm.CreatedVolumes, volInfo)
		LogDebug(fmt.Sprintf("Successfully created ANF clone volume '%s' from master '%s'", volInfo.Name, masterVolumeName))
		return volInfo.Name, nil
	}

	cloneName := tm.GenerateVolumeName(masterVolumeName)

	LogDebug(fmt.Sprintf("Creating clone volume '%s' from master '%s' in SVM '%s'",
		cloneName, masterVolumeName, tm.SVMName))

	// Check if clone already exists
	exists, err := tm.OntapClient.VolumeExists(tm.SVMName, cloneName)
	if err != nil {
		return "", fmt.Errorf("failed to check if volume exists: %w", err)
	}

	if exists {
		LogDebug(fmt.Sprintf("Clone volume '%s' already exists, will reuse it", cloneName))
		vol, err := tm.OntapClient.GetVolumeByName(tm.SVMName, cloneName)
		if err != nil {
			return "", fmt.Errorf("failed to get existing volume: %w", err)
		}

		// Add to cleanup list
		tm.CreatedVolumes = append(tm.CreatedVolumes, VolumeCleanupInfo{
			UUID:    vol.UUID,
			Name:    cloneName,
			SVMName: tm.SVMName,
			IsClone: true,
		})

		return cloneName, nil
	}

	// Create the clone
	vol, err := tm.OntapClient.CloneVolume(tm.SVMName, masterVolumeName, cloneName)
	if err != nil {
		return "", fmt.Errorf("failed to create clone volume: %w", err)
	}

	// Create protocol-specific exports/shares
	if PROTOCOL_TYPE == ProtocolNFS {
		// Create NFS export for the cloned volume
		LogDebug(fmt.Sprintf("Creating NFS export for cloned volume '%s'", cloneName))
		err = tm.OntapClient.CreateNFSExportForVolume(tm.SVMName, cloneName)
		if err != nil {
			// Log error but don't fail - export might already exist or be inherited
			LogDebug(fmt.Sprintf("Warning: Failed to create NFS export for volume '%s': %v", cloneName, err))
		} else {
			// Give NFS server a moment to register the new export
			// This ensures showmount -e will return the new export immediately
			time.Sleep(2 * time.Second)
			LogDebug(fmt.Sprintf("NFS export registered for volume '%s'", cloneName))
		}
	} else if PROTOCOL_TYPE == ProtocolSMB {
		// Create SMB share for the cloned volume
		LogDebug(fmt.Sprintf("Creating SMB share for cloned volume '%s'", cloneName))
		err = tm.OntapClient.CreateSMBShareForVolume(tm.SVMName, cloneName)
		if err != nil {
			// Log error but don't fail - share might already exist or be inherited
			LogDebug(fmt.Sprintf("Warning: Failed to create SMB share for volume '%s': %v", cloneName, err))
		} else {
			// Give SMB server a moment to register the new share
			time.Sleep(2 * time.Second)
			LogDebug(fmt.Sprintf("SMB share registered for volume '%s'", cloneName))
		}

	}

	// Track for cleanup
	tm.CreatedVolumes = append(tm.CreatedVolumes, VolumeCleanupInfo{
		UUID:    vol.UUID,
		Name:    cloneName,
		SVMName: tm.SVMName,
		IsClone: true,
	})

	LogDebug(fmt.Sprintf("Successfully created clone volume '%s' (UUID: %s)", cloneName, vol.UUID))
	return cloneName, nil
}

// CreateMultipleClones creates clones for multiple master volumes
func (tm *TestVolumeManager) CreateMultipleClones(masterVolumeNames []string) ([]string, error) {
	return tm.CreateSelectedClones(masterVolumeNames, allIndices(len(masterVolumeNames)))
}

// CreateSelectedClones creates clones only for the requested indices and returns
// a slice aligned to the master volume list so existing tests can keep their
// current index lookups.
func (tm *TestVolumeManager) CreateSelectedClones(masterVolumeNames []string, requiredIndices []int) ([]string, error) {
	cloneNames := make([]string, len(masterVolumeNames))
	seen := make(map[int]struct{}, len(requiredIndices))

	for _, index := range requiredIndices {
		if index < 0 || index >= len(masterVolumeNames) {
			tm.CleanupAllVolumes()
			return nil, fmt.Errorf("requested clone index %d is out of range for %d master volumes", index, len(masterVolumeNames))
		}
		if _, exists := seen[index]; exists {
			continue
		}
		seen[index] = struct{}{}

		cloneName, err := tm.CreateCloneVolume(masterVolumeNames[index])
		if err != nil {
			// Cleanup any volumes created so far
			tm.CleanupAllVolumes()
			return nil, fmt.Errorf("failed to create clone for '%s': %w", masterVolumeNames[index], err)
		}
		cloneNames[index] = cloneName
	}

	return cloneNames, nil
}

// CleanupAllVolumes deletes all volumes created during the test
func (tm *TestVolumeManager) CleanupAllVolumes() error {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	if len(tm.CreatedVolumes) == 0 {
		LogDebug("No volumes to cleanup")
		return nil
	}

	LogDebug(fmt.Sprintf("Cleaning up %d test volume(s)", len(tm.CreatedVolumes)))

	for _, volInfo := range tm.CreatedVolumes {
		if tm.CloneProvider == VolumeCloneProviderANF {
			LogDebug(fmt.Sprintf("[CLEANUP] Deleting ANF clone '%s'", volInfo.Name))
			if err := tm.deleteANFCloneResources(volInfo); err != nil {
				LogError(fmt.Sprintf("[CLEANUP] Failed to delete ANF clone '%s': %v (continuing)", volInfo.Name, err))
				continue
			}

			LogDebug(fmt.Sprintf("[CLEANUP] Successfully deleted ANF clone '%s'", volInfo.Name))
			continue
		}

		// Step 1: Delete protocol-specific resources before deleting volume
		if PROTOCOL_TYPE == ProtocolSMB {
			// SMB shares must be removed before the volume can be deleted
			LogDebug(fmt.Sprintf("[CLEANUP] Attempting to delete SMB share '%s' from SVM '%s'", volInfo.Name, tm.SVMName))
			if err := tm.OntapClient.DeleteSMBShare(tm.SVMName, volInfo.Name); err != nil {
				LogError(fmt.Sprintf("[CLEANUP] Failed to delete SMB share '%s': %v (continuing)", volInfo.Name, err))
			} else {
				LogDebug(fmt.Sprintf("[CLEANUP] Successfully deleted SMB share '%s'", volInfo.Name))
			}
		} else if PROTOCOL_TYPE == ProtocolNFS {
			// Delete the export policy created for this clone
			policyName := fmt.Sprintf("export_%s", volInfo.Name)
			LogDebug(fmt.Sprintf("[CLEANUP] Attempting to delete NFS export policy '%s'", policyName))
			if err := tm.OntapClient.DeleteExportPolicy(tm.SVMName, policyName); err != nil {
				LogError(fmt.Sprintf("[CLEANUP] Failed to delete export policy '%s': %v (continuing)", policyName, err))
			} else {
				LogDebug(fmt.Sprintf("[CLEANUP] Successfully deleted export policy '%s'", policyName))
			}
		}

		// Step 2: Delete the volume
		LogDebug(fmt.Sprintf("[CLEANUP] Deleting volume '%s' (UUID: %s)", volInfo.Name, volInfo.UUID))
		if err := tm.OntapClient.DeleteVolume(volInfo.UUID); err != nil {
			// Log error but continue - cleanup should be best-effort
			LogError(fmt.Sprintf("[CLEANUP] Failed to delete volume '%s': %v (continuing)", volInfo.Name, err))
			continue
		}

		LogDebug(fmt.Sprintf("[CLEANUP] ✓ Successfully deleted volume '%s'", volInfo.Name))
	}

	// Clear the list
	tm.CreatedVolumes = []VolumeCleanupInfo{}

	LogDebug("[CLEANUP] Cleanup completed")
	return nil
}

// GetRunnerIDFromEnv extracts runner ID from environment variables
// Uses GitHub Actions context or falls back to hostname
func GetRunnerIDFromEnv() string {
	// Try GitHub Actions run ID first
	if runID := os.Getenv("GITHUB_RUN_ID"); runID != "" {
		// Include job index if running in matrix
		if jobIndex := os.Getenv("MATRIX_INDEX"); jobIndex != "" {
			return fmt.Sprintf("gh_%s_job_%s", runID, jobIndex)
		}
		return fmt.Sprintf("gh_%s", runID)
	}

	// Try GitHub actor (username)
	if actor := os.Getenv("GITHUB_ACTOR"); actor != "" {
		return actor
	}

	// Fallback to hostname
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown"
	}

	return strings.ReplaceAll(hostname, ".", "_")
}

// ParseVolumeNames parses comma-separated volume names from environment variable
func ParseVolumeNames(volumeNamesStr string) []string {
	if volumeNamesStr == "" {
		return []string{}
	}

	volumes := strings.Split(volumeNamesStr, ",")
	cleanedVolumes := make([]string, 0, len(volumes))

	for _, vol := range volumes {
		trimmed := strings.TrimSpace(vol)
		if trimmed != "" {
			cleanedVolumes = append(cleanedVolumes, trimmed)
		}
	}

	return cleanedVolumes
}

// SetupTestVolumes is a convenience function to set up source and destination volumes
func SetupTestVolumes(ontapURL, username, password, svmName string,
	masterSourceVolumes, masterDestVolumes []string) (sourceVolumes, destVolumes []string, manager *TestVolumeManager, err error) {

	runnerID := GetRunnerIDFromEnv()
	LogDebug(fmt.Sprintf("Setting up test volumes for runner: %s", runnerID))

	manager = NewTestVolumeManager(ontapURL, username, password, svmName, runnerID)

	// Create source volume clones
	LogDebug(fmt.Sprintf("Creating %d source volume clone(s)", len(masterSourceVolumes)))
	sourceVolumes, err = manager.CreateMultipleClones(masterSourceVolumes)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to create source volumes: %w", err)
	}

	// Create destination volume clones
	LogDebug(fmt.Sprintf("Creating %d destination volume clone(s)", len(masterDestVolumes)))
	destVolumes, err = manager.CreateMultipleClones(masterDestVolumes)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to create destination volumes: %w", err)
	}

	LogDebug(fmt.Sprintf("Successfully set up %d source and %d destination volumes",
		len(sourceVolumes), len(destVolumes)))

	return sourceVolumes, destVolumes, manager, nil
}

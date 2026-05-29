package tests

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"ndm-ui-tests/utils"
)

// discoveryVolumeSetup is populated by TestMain when volume-cloning env vars
// are present. All discovery tests call resolveNFSClone / resolveSMBClone to
// obtain either a fresh cloned volume or fall back to the static config values.
var discoveryVolumeSetup *utils.UIVolumeSetup

// TestMain runs once before all tests in the package. It creates a
// project and registers workers via the NDM API — mirroring
// ndm-api-tests/utils/setup.go InitTestEnv().
//
// After all tests complete it detaches workers so the VMs can be
// reused by the next go-test invocation (e.g. discovery after
// account-management).
func TestMain(m *testing.M) {
	if err := utils.InitTestEnv(); err != nil {
		fmt.Fprintf(os.Stderr, "[TestMain] setup failed: %v\n", err)
		os.Exit(1)
	}

	if hasAnyEnv(
		"AZURE_UI_NFS_SOURCE_VOLUMES",
		"ONTAP_NFS_SOURCE_VOLUMES",
		"AWS_FSXN_NFS_SOURCE_VOLUMES",
		"AZURE_UI_SMB_SOURCE_VOLUMES",
		"ONTAP_SMB_SOURCE_VOLUMES",
		"AWS_FSXN_SMB_SOURCE_VOLUMES",
	) {
		setup, err := utils.InitUIVolumeSetup("NFS")
		if err != nil {
			fmt.Fprintf(os.Stderr, "[TestMain] volume clone setup warning: %v\n", err)
		} else {
			discoveryVolumeSetup = setup
			fmt.Println("[TestMain] volume cloning enabled for discovery tests")
		}
	}

	code := m.Run()

	utils.CleanupTestEnv()

	os.Exit(code)
}

// hasAnyEnv returns true when at least one of the given env keys is non-empty.
func hasAnyEnv(keys ...string) bool {
	for _, k := range keys {
		if strings.TrimSpace(os.Getenv(k)) != "" {
			return true
		}
	}
	return false
}


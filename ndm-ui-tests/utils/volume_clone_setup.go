// Package utils — volume cloning for UI tests.
//
// Mirrors ndm-api-tests/utils/test_setup_helper.go but adapted for the
// ndm-ui-tests package (no Ginkgo, uses Go's testing.T).
//
// Supported clone providers (set VOLUME_CLONE_PROVIDER):
//   - "anf"       — Azure NetApp Files  (default for Azure nightly runs)
//   - "ontap"     — ONTAP REST API      (default otherwise)
//   - "aws-fsxn"  — AWS FSx for ONTAP
//
// Env vars consumed per protocol (NFS example):
//
//	VOLUME_CLONE_PROVIDER=anf
//	AZURE_NFS_SOURCE_VOLUMES=vol1,vol2
//	AZURE_NFS_DEST_VOLUMES=dvol1,dvol2
//	AZURE_NFS_SOURCE_HOST_IP=10.x.x.x,10.x.x.x
//	AZURE_NFS_DESTINATION_HOST_IP=10.x.x.x,10.x.x.x
//	AZURE_ANF_NFS_SOURCE_RESOURCE_GROUP=...
//	AZURE_ANF_NFS_SOURCE_ACCOUNT_NAME=...
//	AZURE_ANF_NFS_SOURCE_POOL_NAME=...
//	AZURE_ANF_NFS_DEST_RESOURCE_GROUP=...
//	AZURE_ANF_NFS_DEST_ACCOUNT_NAME=...
//	AZURE_ANF_NFS_DEST_POOL_NAME=...
//
// Replace "NFS" with "SMB" for SMB tests. Replace "AZURE_ANF_" prefix with
// "ONTAP_" or "AWS_FSXN_" for the other providers.
package utils

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

// ─── Global singleton ─────────────────────────────────────────────────────────

// UIVolumeSetup holds the configuration and master-volume lists for one
// test run. It is populated once by InitUIVolumeSetup and reused for every
// SetupTestVolumesForTest call.
type UIVolumeSetup struct {
	provider cloneProvider

	// ONTAP / FSxN connection details
	sourceOntapURL  string
	sourceOntapUser string
	sourceOntapPass string
	sourceSVM       string
	destOntapURL    string
	destOntapUser   string
	destOntapPass   string
	destSVM         string

	// ANF resource coordinates
	sourceANFConfig *ANFEndpointConfig
	destANFConfig   *ANFEndpointConfig

	// Master volume names (will be cloned per test)
	masterSourceVolumes []string
	masterDestVolumes   []string

	// Host IPs for building NFS export strings "host:/volume"
	SourceHostIPs []string
	DestHostIPs   []string
}

// internal provider alias so volume_clone_setup does not expose the type
// before types are wired up — we reuse VolumeCloneProvider underneath.
type cloneProvider = VolumeCloneProvider

// Protocol-specific globals so NFS and SMB tests never share the same
// UIVolumeSetup. A single shared global caused the SMB test to clone NFS
// volumes when an NFS test initialised the global first.
var (
	globalNFSVolumeSetup *UIVolumeSetup
	globalSMBVolumeSetup *UIVolumeSetup
)

// ─── Public API ───────────────────────────────────────────────────────────────

// InitUIVolumeSetup reads env vars for the active clone provider and returns
// a ready-to-use UIVolumeSetup. Call this once (e.g. in TestMain) and store
// the result, or let SetupTestVolumesForTest call it lazily.
//
// protocol must be "NFS" or "SMB".
func InitUIVolumeSetup(protocol string) (*UIVolumeSetup, error) {
	s := &UIVolumeSetup{provider: resolveVolumeCloneProvider()}
	proto := strings.ToUpper(strings.TrimSpace(protocol))

	// Set the package-level protocol so the ANF/ONTAP helpers behave correctly.
	switch Protocol(proto) {
	case ProtocolSMB:
		uiProtocolType = ProtocolSMB
	default:
		uiProtocolType = ProtocolNFS
	}

	switch s.provider {
	case VolumeCloneProviderANF:
		if err := s.initANF(proto); err != nil {
			return nil, err
		}
	case VolumeCloneProviderFSxN:
		if err := s.initFSxN(proto); err != nil {
			return nil, err
		}
	default:
		if err := s.initONTAP(proto); err != nil {
			return nil, err
		}
	}

	if len(s.masterSourceVolumes) == 0 {
		return nil, fmt.Errorf("no source volumes configured (provider=%s protocol=%s)", s.provider, proto)
	}
	if len(s.masterDestVolumes) == 0 {
		return nil, fmt.Errorf("no destination volumes configured (provider=%s protocol=%s)", s.provider, proto)
	}

	logSetup("UI volume setup initialised (provider=%s, protocol=%s)", s.provider, proto)
	logSetup("  source master volumes : %v", s.masterSourceVolumes)
	logSetup("  dest   master volumes : %v", s.masterDestVolumes)
	logSetup("  source host IPs       : %v", s.SourceHostIPs)
	logSetup("  dest   host IPs       : %v", s.DestHostIPs)

	return s, nil
}

// SetupTestVolumesForTest creates fresh clones of the master volumes for a
// single test case. It returns:
//
//   - clonedSourceVolumes — one clone name per master source volume
//   - clonedDestVolumes   — one clone name per master dest volume
//   - srcMgr, dstMgr      — pass to CleanupTestVolumesForTest inside t.Cleanup
//
// Each protocol ("NFS" or "SMB") maintains its own lazily-initialised global
// so NFS and SMB tests never share the same UIVolumeSetup.
func SetupTestVolumesForTest(t *testing.T, protocol string) (
	clonedSourceVolumes []string,
	clonedDestVolumes []string,
	srcMgr *TestVolumeManager,
	dstMgr *TestVolumeManager,
	err error,
) {
	t.Helper()

	proto := strings.ToUpper(strings.TrimSpace(protocol))

	// Pick the protocol-specific global so NFS and SMB setups are isolated.
	var global **UIVolumeSetup
	if proto == string(ProtocolSMB) {
		global = &globalSMBVolumeSetup
	} else {
		global = &globalNFSVolumeSetup
	}

	if *global == nil {
		setup, initErr := InitUIVolumeSetup(protocol)
		if initErr != nil {
			return nil, nil, nil, nil, fmt.Errorf("init UI volume setup (%s): %w", proto, initErr)
		}
		*global = setup
	}

	s := *global
	testID := t.Name()
	os.Setenv("CURRENT_TEST_CASE", testID) //nolint:errcheck

	switch s.provider {
	case VolumeCloneProviderANF:
		srcMgr = NewANFTestVolumeManager(*s.sourceANFConfig)
		dstMgr = NewANFTestVolumeManager(*s.destANFConfig)
	default: // ONTAP and FSxN share the ONTAP-backed TestVolumeManager
		srcMgr = NewTestVolumeManager(s.sourceOntapURL, s.sourceOntapUser, s.sourceOntapPass, s.sourceSVM, "")
		dstMgr = NewTestVolumeManager(s.destOntapURL, s.destOntapUser, s.destOntapPass, s.destSVM, "")
	}

	idx := allIndices(len(s.masterSourceVolumes))
	logSetup("[%s] cloning %d source volumes…", testID, len(s.masterSourceVolumes))
	clonedSourceVolumes, err = srcMgr.CreateSelectedClones(s.masterSourceVolumes, idx)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("[%s] clone source volumes: %w", testID, err)
	}
	logSetup("[%s] source clones ready: %v", testID, clonedSourceVolumes)

	destIdx := allIndices(len(s.masterDestVolumes))
	logSetup("[%s] cloning %d destination volumes…", testID, len(s.masterDestVolumes))
	clonedDestVolumes, err = dstMgr.CreateSelectedClones(s.masterDestVolumes, destIdx)
	if err != nil {
		_ = srcMgr.CleanupAllVolumes() // best-effort rollback
		return nil, nil, nil, nil, fmt.Errorf("[%s] clone destination volumes: %w", testID, err)
	}
	logSetup("[%s] destination clones ready: %v", testID, clonedDestVolumes)

	return clonedSourceVolumes, clonedDestVolumes, srcMgr, dstMgr, nil
}

// CleanupTestVolumesForTest deletes the cloned volumes created by
// SetupTestVolumesForTest. Call it inside t.Cleanup.
func CleanupTestVolumesForTest(t *testing.T, srcMgr, dstMgr *TestVolumeManager) {
	t.Helper()
	if srcMgr != nil {
		if err := srcMgr.CleanupAllVolumes(); err != nil {
			t.Logf("[volume-cleanup] source volumes: %v", err)
		}
	}
	if dstMgr != nil {
		if err := dstMgr.CleanupAllVolumes(); err != nil {
			t.Logf("[volume-cleanup] destination volumes: %v", err)
		}
	}
}

// SourceNFSExports builds "host:/volume" strings for each cloned source volume.
func (s *UIVolumeSetup) SourceNFSExports(clonedVolumes []string) []string {
	return makeNFSExports(s.SourceHostIPs, clonedVolumes)
}

// DestNFSExports builds "host:/volume" strings for each cloned dest volume.
func (s *UIVolumeSetup) DestNFSExports(clonedVolumes []string) []string {
	return makeNFSExports(s.DestHostIPs, clonedVolumes)
}


// ─── Private initialisation ───────────────────────────────────────────────────

func (s *UIVolumeSetup) initANF(proto string) error {
	key := func(suffix string) string {
		return fmt.Sprintf("AZURE_ANF_%s_%s", proto, suffix)
	}

	srcRG := os.Getenv(key("SOURCE_RESOURCE_GROUP"))
	srcAccount := os.Getenv(key("SOURCE_ACCOUNT_NAME"))
	srcPool := os.Getenv(key("SOURCE_POOL_NAME"))
	dstRG := os.Getenv(key("DEST_RESOURCE_GROUP"))
	dstAccount := os.Getenv(key("DEST_ACCOUNT_NAME"))
	dstPool := os.Getenv(key("DEST_POOL_NAME"))

	if srcRG == "" || srcAccount == "" || srcPool == "" {
		return fmt.Errorf(
			"ANF source config incomplete; need %s, %s, %s",
			key("SOURCE_RESOURCE_GROUP"), key("SOURCE_ACCOUNT_NAME"), key("SOURCE_POOL_NAME"),
		)
	}
	if dstRG == "" || dstAccount == "" || dstPool == "" {
		return fmt.Errorf(
			"ANF dest config incomplete; need %s, %s, %s",
			key("DEST_RESOURCE_GROUP"), key("DEST_ACCOUNT_NAME"), key("DEST_POOL_NAME"),
		)
	}

	s.sourceANFConfig = &ANFEndpointConfig{ResourceGroup: srcRG, AccountName: srcAccount, PoolName: srcPool}
	s.destANFConfig = &ANFEndpointConfig{ResourceGroup: dstRG, AccountName: dstAccount, PoolName: dstPool}

	s.masterSourceVolumes = parseVolumeEnv(fmt.Sprintf("AZURE_%s_SOURCE_VOLUMES", proto))
	s.masterDestVolumes = parseVolumeEnv(fmt.Sprintf("AZURE_%s_DEST_VOLUMES", proto))
	s.SourceHostIPs = parseVolumeEnv(fmt.Sprintf("AZURE_%s_SOURCE_HOST_IP", proto))
	s.DestHostIPs = parseVolumeEnv(fmt.Sprintf("AZURE_%s_DESTINATION_HOST_IP", proto))
	return nil
}

func (s *UIVolumeSetup) initONTAP(proto string) error {
	s.sourceOntapURL = os.Getenv("ONTAP_SRC_API_URL")
	s.sourceOntapUser = os.Getenv("ONTAP_SYSTEM_MANAGER_SRC_USERNAME")
	s.sourceOntapPass = os.Getenv("ONTAP_SYSTEM_MANAGER_SRC_PASSWORD")
	s.sourceSVM = os.Getenv("ONTAP_SRC_SVM_NAME")
	s.destOntapURL = os.Getenv("ONTAP_DST_API_URL")
	s.destOntapUser = os.Getenv("ONTAP_SYSTEM_MANAGER_DST_USERNAME")
	s.destOntapPass = os.Getenv("ONTAP_SYSTEM_MANAGER_DST_PASSWORD")
	s.destSVM = os.Getenv("ONTAP_DST_SVM_NAME")

	if s.sourceOntapURL == "" || s.sourceSVM == "" {
		return fmt.Errorf("ONTAP source config incomplete: need ONTAP_SRC_API_URL and ONTAP_SRC_SVM_NAME")
	}

	s.masterSourceVolumes = parseVolumeEnv(fmt.Sprintf("ONTAP_%s_SOURCE_VOLUMES", proto))
	s.masterDestVolumes = parseVolumeEnv(fmt.Sprintf("ONTAP_%s_DEST_VOLUMES", proto))
	s.SourceHostIPs = parseVolumeEnv(fmt.Sprintf("ONTAP_%s_SRC_HOST_IP", proto))
	s.DestHostIPs = parseVolumeEnv(fmt.Sprintf("ONTAP_%s_DST_HOST_IP", proto))
	return nil
}

func (s *UIVolumeSetup) initFSxN(proto string) error {
	s.sourceOntapURL = os.Getenv("AWS_FSXN_SRC_API_URL")
	s.sourceOntapUser = os.Getenv("AWS_FSXN_SYSTEM_MANAGER_SRC_USERNAME")
	s.sourceOntapPass = os.Getenv("AWS_FSXN_SYSTEM_MANAGER_SRC_PASSWORD")
	s.sourceSVM = os.Getenv("AWS_FSXN_SRC_SVM_NAME")
	s.destOntapURL = os.Getenv("AWS_FSXN_DST_API_URL")
	s.destOntapUser = os.Getenv("AWS_FSXN_SYSTEM_MANAGER_DST_USERNAME")
	s.destOntapPass = os.Getenv("AWS_FSXN_SYSTEM_MANAGER_DST_PASSWORD")
	s.destSVM = os.Getenv("AWS_FSXN_DST_SVM_NAME")

	if s.sourceOntapURL == "" || s.sourceSVM == "" {
		return fmt.Errorf("FSxN source config incomplete: need AWS_FSXN_SRC_API_URL and AWS_FSXN_SRC_SVM_NAME")
	}

	s.masterSourceVolumes = parseVolumeEnv(fmt.Sprintf("AWS_FSXN_%s_SOURCE_VOLUMES", proto))
	s.masterDestVolumes = parseVolumeEnv(fmt.Sprintf("AWS_FSXN_%s_DEST_VOLUMES", proto))
	s.SourceHostIPs = parseVolumeEnv(fmt.Sprintf("AWS_FSXN_%s_SRC_HOST_IP", proto))
	s.DestHostIPs = parseVolumeEnv(fmt.Sprintf("AWS_FSXN_%s_DST_HOST_IP", proto))
	return nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// parseVolumeEnv reads a comma-separated list from an env var.
func parseVolumeEnv(envKey string) []string {
	return ParseVolumeNames(os.Getenv(envKey))
}

// makeNFSExports pairs hostIPs[i] with volumes[i] as "host:/volume".
// If there are fewer IPs than volumes the last IP is reused.
func makeNFSExports(hostIPs, volumes []string) []string {
	if len(hostIPs) == 0 {
		return volumes
	}
	out := make([]string, len(volumes))
	for i, vol := range volumes {
		ip := hostIPs[i]
		if i >= len(hostIPs) {
			ip = hostIPs[len(hostIPs)-1]
		}
		out[i] = fmt.Sprintf("%s:%s", ip, vol)
	}
	return out
}

package performance_testing

import (
	"flag"
	. "ndm-api-tests/utils"
	"testing"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var ProtocolType, Environment string

func init() {
	flag.StringVar(&ProtocolType, "protocol_type", "NFS", "Enter protocol_type (SMB / NFS)")
	flag.StringVar(&Environment, "environment", "AZURE", "Enter environment (vSphere / Azure / GCP)")
}

func TestPerformanceTesting(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "E2e Suite")
}

var _ = BeforeSuite(func() {
	By("Setting before the suite")
	flag.Parse()
	
	// Clear any workers left in memory from previous test suites (e2e/smoke)
	// (Global AttachedWorkersConfig persists across sequential suite runs)
	// Check before UpdatePerfConfVariables since it calls InitWorkers() which resets AttachedWorkersConfig
	if len(AttachedWorkersConfig) > 0 || len(GlobalAttachedWorkersConfig) > 0 {
		LogDebug("Clearing workers from previous test suites (e2e/smoke)")
		err := DetachAllWorkers()
		if err != nil {
			LogError("Failed to detach workers from previous suites", err)
		}
		// Also clear the global config
		GlobalAttachedWorkersConfig = make(map[string]SSHConfig)
	}
	
	UpdatePerfConfVariables(ProtocolType)
	
	// Use InitTestEnvWithoutWorkers for performance tests since each test creates its own project and workers
	InitTestEnvWithoutWorkers()
})

var _ = AfterSuite(func() {
	By("Cleaning up performance test suite")
	// Ensure any remaining workers are cleaned up even if tests fail
	if len(AttachedWorkersConfig) > 0 {
		LogDebug("Cleaning up remaining workers from performance tests")
		err := StopAllWorkersAndWait()
		if err != nil {
			LogError("Failed to stop workers", err)
		}
		err = DetachAllWorkers()
		if err != nil {
			LogError("Failed to detach workers", err)
		}
	}
	LogDebug("Performance test suite cleanup complete")
})
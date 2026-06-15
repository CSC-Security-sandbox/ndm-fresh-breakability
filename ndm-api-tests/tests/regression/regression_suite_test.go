package tests

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
	flag.StringVar(&Environment, "environment", "vSphere", "Enter environment (vSphere / Azure / GCP)")
}

func TestRegression(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "Regression Suite")
}

var _ = BeforeSuite(func() {
	By("Setting before the suite")
	flag.Parse()
	UpdateConfVariables(ProtocolType, Environment)

	// Clear any workers left in memory from smoke/e2e suites
	// (Global AttachedWorkersConfig persists across sequential suite runs)
	if len(AttachedWorkersConfig) > 0 {
		LogDebug("Clearing workers from previous test suites (smoke/e2e)")
		err := DetachAllWorkers()
		if err != nil {
			LogError("Failed to detach workers from previous suites", err)
		}
	}
	
	// Use InitTestEnvWithoutWorkers for regression tests since each test creates its own workers
	InitTestEnvWithoutWorkers()
})

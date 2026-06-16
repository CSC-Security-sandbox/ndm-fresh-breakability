package tests

import (
	"encoding/json"
	"flag"
	"fmt"
	. "ndm-api-tests/utils"
	"testing"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var ProtocolType, Environment string

func init() {
	flag.StringVar(&ProtocolType, "protocol_type", "NFS", "Enter protocol_type (SMB / NFS)")
	flag.StringVar(&Environment, "environment", "Azure", "Enter environment (vSphere / Azure / GCP)")
}

func TestE2e(t *testing.T) {
	RegisterFailHandler(Fail)
	suiteConfig, reporterConfig := GinkgoConfiguration()
	suiteConfig.FlakeAttempts = 3
	RunSpecs(t, "E2e Suite", suiteConfig, reporterConfig)
}

// SynchronizedBeforeSuite ensures global project setup happens once across all parallel nodes
var _ = SynchronizedBeforeSuite(func() []byte {
	// This runs ONLY on Process #1
	By("Setting up global test environment (Process #1)")
	flag.Parse()
	UpdateConfVariables(ProtocolType, Environment)

	InitTestEnv()

	LogDebug(fmt.Sprintf("[Process #1] Global project created: %s (ID: %s) with %d workers", 
		GlobalProjectName, GlobalProjectId, len(GlobalAttachedWorkersConfig)))

	// Serialize shared data for other processes
	sharedData := SharedSuiteData{
		AuthToken:                   AuthToken,
		RefreshToken:                RefreshToken,
		KeycloakUser:                KeycloakUser,
		KeycloakPassword:            KeycloakPassword,
		ClientSecret:                CLIENT_SECRET,
		AppAdminId:                  AppAdminId,
		ProjectAdminId:              ProjectAdminId,
		ProjectViewerId:             ProjectViewerId,
		GlobalProjectId:             GlobalProjectId,
		GlobalProjectName:           GlobalProjectName,
		GlobalAttachedWorkersConfig: GlobalAttachedWorkersConfig,
	}

	data, err := json.Marshal(sharedData)
	Expect(err).NotTo(HaveOccurred(), "Failed to serialize shared suite data")
	LogDebug(fmt.Sprintf("[Process #1] Serialized shared data (%d bytes) for distribution to parallel nodes", len(data)))
	return data
}, func(data []byte) {
	// This runs on ALL processes (including Process #1)
	By("Initializing test environment variables")
	flag.Parse()
	UpdateConfVariables(ProtocolType, Environment)

	// Deserialize and set global variables
	var sharedData SharedSuiteData
	err := json.Unmarshal(data, &sharedData)
	Expect(err).NotTo(HaveOccurred(), "Failed to deserialize shared suite data")

	SetGlobalTestVariables(sharedData)
	LogDebug(fmt.Sprintf("[All Processes] Received shared project: %s (ID: %s) with %d workers",
		GlobalProjectName, GlobalProjectId, len(GlobalAttachedWorkersConfig)))
})

// SynchronizedAfterSuite ensures cleanup happens after all parallel nodes finish.
// It has 2 functions:
// 1. First function: Runs on ALL parallel processes when they finish
// 2. Second function: Runs ONLY on Process #1 after all others complete
//   - This is where we stop and detach workers
//   - Mirrors the SynchronizedBeforeSuite pattern
var _ = SynchronizedAfterSuite(func() {
	// This runs on ALL processes after their tests complete
	By("Process cleanup complete")
}, func() {
	// This runs ONLY on Process #1 after all other processes finish
	By("Cleaning up global test environment (Process #1)")

	if len(GlobalAttachedWorkersConfig) > 0 {
		LogDebug("Stopping and detaching workers")
		err := StopAllWorkersAndWait()
		if err != nil {
			LogError("Failed to stop workers", err)
		}
		err = CleanupTestEnv()
		if err != nil {
			LogError("Failed to cleanup test environment", err)
		}
		LogDebug("E2E suite cleanup complete")
	}
})

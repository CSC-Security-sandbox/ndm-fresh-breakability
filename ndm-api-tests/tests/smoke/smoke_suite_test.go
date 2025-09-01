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

func TestSmoke(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "Smoke Suite")
}

func TestRegression(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "Regression Suite")
}

var _ = BeforeSuite(func() {
	By("Setting before the suite")
	flag.Parse()
	if ProtocolType == string(ProtocolSMB) {
		// Added wait to prevent simultaneous calls to the OpenID Connect token API
		// from NFS and SMB smoke tests. Concurrent requests were occasionally causing
		// HTTP 400 errors due to race conditions or token contention. This delay ensures
		// serialized access to the token endpoint.
		Wait(10)
	}
	InitTestEnvForSMoke()
	UpdateConfVariables(ProtocolType, Environment)
})

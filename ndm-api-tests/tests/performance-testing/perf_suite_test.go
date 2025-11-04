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
	InitTestEnv()
	UpdatePerfConfVariables(ProtocolType)
})
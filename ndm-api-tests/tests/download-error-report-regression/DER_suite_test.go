package downloaderrorreportregression

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

func TestDownloadErrorReport(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "Download Error Report Suite")
}

var _ = BeforeSuite(func() {
	LogDebug("Setting before the suite")
	flag.Parse()
	InitTestEnv()
	UpdateConfVariables(ProtocolType, Environment)
})

var _ = AfterSuite(func() {
	LogDebug("Cleaning up after the suite")
})

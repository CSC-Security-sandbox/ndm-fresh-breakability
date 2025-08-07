package tests

import (
	"flag"
	. "ndm-api-tests/utils"
	"testing"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var ProtocolType, SourceVolumesArgs, DestinationVolumesArgs string

func init() {
	flag.StringVar(&ProtocolType, "protocol_type", "NFS", "Enter protocol_type (SMB / NFS)")
	flag.StringVar(&SourceVolumesArgs, "src_volumes", "", "Enter comma separated source volumes")
	flag.StringVar(&DestinationVolumesArgs, "dest_volumes", "", "Enter comma separated destination volumes")
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
	InitTestEnvForSMoke()
	UpdateConfVariables(ProtocolType, SourceVolumesArgs, DestinationVolumesArgs)
})

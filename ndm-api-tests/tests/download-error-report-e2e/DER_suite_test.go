package downloaderrorreporte2e

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

func TestE2e(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "Download Error Report E2E Suite")
}

var _ = BeforeSuite(func() {
	LogDebug("Setting before the suite")
	InitTestEnv()
	UpdateConfVariables(ProtocolType, SourceVolumesArgs, DestinationVolumesArgs)
})

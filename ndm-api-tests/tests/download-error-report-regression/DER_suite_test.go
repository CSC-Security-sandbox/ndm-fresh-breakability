package downloaderrorreportregression

import (
	. "ndm-api-tests/utils"
	"testing"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func TestDownloadErrorReport(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "Download Error Report Suite")
}

var _ = BeforeSuite(func() {
	LogDebug("Setting before the suite")
	InitTestEnv()
})

var _ = AfterSuite(func() {
	LogDebug("Cleaning up after the suite")
})

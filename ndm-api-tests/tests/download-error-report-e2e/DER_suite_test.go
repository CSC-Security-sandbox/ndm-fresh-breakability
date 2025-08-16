package downloaderrorreporte2e

import (
	. "ndm-api-tests/utils"
	"testing"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func TestE2e(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "Download Error Report E2E Suite")
}

var _ = BeforeSuite(func() {
	LogDebug("Setting before the suite")
	InitTestEnv()
})

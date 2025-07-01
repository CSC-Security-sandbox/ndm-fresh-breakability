package tests

import (
	. "ndm-api-tests/utils"
	"testing"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func TestRegression(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "Regression Suite")
}

var _ = BeforeSuite(func() {
	By("Setting before the suite")
	InitTestEnv()
})

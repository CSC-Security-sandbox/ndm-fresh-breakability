package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"testing"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func TestE2e(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "E2e Suite")
}

var _ = BeforeSuite(func() {
	fmt.Println("Setting before the suite")
	InitTestEnv()
})

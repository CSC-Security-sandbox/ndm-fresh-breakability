package tests

import (
	. "ndm-api-tests/utils"
	"os"
	"testing"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
)

func TestMain(m *testing.M) {
	InitTestEnv()
	exitVal := m.Run()
	os.Exit(exitVal)
}

func TestAPIScenarios(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "API Scenarios Suite")
}

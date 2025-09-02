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
	InitTestEnvForSMoke()
	UpdateConfVariables(ProtocolType, Environment)
})

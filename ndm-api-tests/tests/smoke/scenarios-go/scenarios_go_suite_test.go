package tests_test

import (
    "testing"
    // . "ndm-api-tests/tests/smoke/scenerios-go"
    . "ndm-api-tests/utils"

    . "github.com/onsi/ginkgo/v2"
    . "github.com/onsi/gomega"
)

var _ = BeforeSuite(func() {
    By("Setting before the suite")
    InitTestEnv()
})


func TestSceneriosGo(t *testing.T) {
    RegisterFailHandler(Fail)
    RunSpecs(t, "SceneriosGo Suite")
}


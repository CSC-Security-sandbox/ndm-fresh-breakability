// Package observability contains post-boot smoke tests that validate the
// Prometheus / Grafana observability stack inside the control-plane VM's
// MicroK8s cluster.
//
// These tests are deliberately kept independent from the main smoke / e2e
// suites: they do not require any workers, projects, or auth tokens — only
// SSH access to the control plane. They exist to catch regressions in the
// in-cluster observability wiring (PV/PVC binding, Prometheus scrape health,
// Grafana datasource reachability) that are otherwise invisible to the
// feature-level API tests and only surface as ~9-minute `kubectl wait`
// timeouts during image builds. See commit c589fef7b for the original
// motivation.
package observability

import (
	"testing"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func TestObservability(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "Observability Suite")
}

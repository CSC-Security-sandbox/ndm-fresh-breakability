package observability

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	. "ndm-api-tests/utils"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// This suite validates that the in-cluster Prometheus on the control plane
// is not just Running, but is actually collecting and persisting data.
//
// It is intentionally narrow and does *not* rely on the NDM API, auth, or
// workers. It SSHs into the control-plane VM and talks to Prometheus via a
// short-lived `kubectl port-forward`, so it stays independent from the
// ingress-facing feature tests while still catching the class of
// regressions where:
//
//   - a pre-provisioned PV label mismatch leaves a PVC Pending (commit
//     c589fef7b),
//   - the scrape loop is degraded because a target is unreachable, or
//   - the TSDB is alive but writing zero samples (e.g. read-only PV, misrouted
//     remote_write).
//
// Each of the three expectations below corresponds to one of those failure
// modes and produces an actionable diagnostic when it fires.

const (
	promNamespace = "prometheus"
	// The service/port that the prometheus-community chart exposes by default.
	promServiceName = "prometheus-server"
	promServicePort = "80"
	// Local port on the VM to port-forward to. Chosen high to avoid collisions
	// with anything bound to the VM's primary interfaces.
	promLocalPort = "29090"
)

type promQueryResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string           `json:"resultType"`
		Result     []promQueryEntry `json:"result"`
	} `json:"data"`
}

type promQueryEntry struct {
	Metric map[string]string `json:"metric"`
	// Prometheus instant-query values are [<unix-ts float>, "<stringified value>"].
	Value []interface{} `json:"value"`
}

var _ = Describe("Prometheus observability on the control plane", func() {
	var ssh SSHConfig

	BeforeEach(func() {
		host := firstNonEmpty(os.Getenv("CP_HOST"), os.Getenv("NDM_VM_HOST"))
		Expect(host).NotTo(BeEmpty(),
			"one of CP_HOST or NDM_VM_HOST must be set to the control-plane IP")

		username := firstNonEmpty(os.Getenv("CP_USERNAME"), os.Getenv("VM_USERNAME"))
		Expect(username).NotTo(BeEmpty(),
			"one of CP_USERNAME or VM_USERNAME must be set")

		password := firstNonEmpty(os.Getenv("CP_PASSWORD"), os.Getenv("VM_PASSWORD"))
		Expect(password).NotTo(BeEmpty(),
			"one of CP_PASSWORD or VM_PASSWORD must be set")

		port := 22
		if p := firstNonEmpty(os.Getenv("CP_SSH_PORT"), os.Getenv("NDM_VM_PORT")); p != "" {
			parsed, err := strconv.Atoi(p)
			Expect(err).NotTo(HaveOccurred(),
				"CP_SSH_PORT / NDM_VM_PORT must be numeric if set, got %q", p)
			port = parsed
		}

		ssh = SSHConfig{Username: username, Host: host, Port: port, Password: password}
	})

	It("has every PVC in the prometheus namespace Bound", func() {
		// The original regression (commit c589fef7b) left prometheus-server's
		// PVC Pending forever because of a PV-label / chart-selector mismatch.
		// Retry for a short window because the PVs are applied and the chart
		// installed in quick succession during first boot — the chart's PVCs
		// can briefly report "Pending" before the static PVs are discovered.
		var lastOutput string
		Eventually(func() error {
			out, err := RunSSHScript(ssh,
				`sudo kubectl get pvc -n `+promNamespace+
					` -o jsonpath='{range .items[*]}{.metadata.name}={.status.phase}{"\n"}{end}'`)
			lastOutput = out
			if err != nil {
				return fmt.Errorf("kubectl get pvc failed: %w", err)
			}

			trimmed := strings.TrimSpace(out)
			if trimmed == "" {
				return fmt.Errorf("no PVCs found in namespace %q", promNamespace)
			}

			var notBound []string
			for _, line := range strings.Split(trimmed, "\n") {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				name, phase, ok := strings.Cut(line, "=")
				if !ok {
					return fmt.Errorf("unexpected kubectl output line: %q", line)
				}
				if phase != "Bound" {
					notBound = append(notBound, fmt.Sprintf("%s=%s", name, phase))
				}
			}
			if len(notBound) > 0 {
				return fmt.Errorf("PVC(s) not Bound: %s", strings.Join(notBound, ", "))
			}
			return nil
		}, 2*time.Minute, 10*time.Second).Should(Succeed(),
			"prometheus PVCs never reached Bound. Last kubectl output:\n%s", lastOutput)
	})

	It("serves the 'up' query with at least one healthy target", func() {
		// A non-empty `up` series set proves the scrape pipeline is running.
		// At least one target reporting value=1 proves discovery reached a
		// healthy endpoint (not just the prometheus-server self-scrape failing).
		//
		// Wrapped in Eventually because the first scrape cycle can take up to
		// one scrape interval (15s by default) to populate `up` — and this
		// test can fire within seconds of the control-plane completing first
		// boot.
		var lastResp promQueryResponse
		Eventually(func() error {
			lastResp = queryPrometheus(ssh, "up")
			if lastResp.Status != "success" {
				return fmt.Errorf("prometheus status=%q for 'up'", lastResp.Status)
			}
			if len(lastResp.Data.Result) == 0 {
				return fmt.Errorf("prometheus returned zero 'up' series; scrape pipeline not yet running")
			}
			for _, series := range lastResp.Data.Result {
				if v, ok := scalarFromValue(series.Value); ok && v == 1 {
					return nil
				}
			}
			return fmt.Errorf("no target reported up==1 among %d series", len(lastResp.Data.Result))
		}, 90*time.Second, 10*time.Second).Should(Succeed(),
			"prometheus never reported a healthy target. Last response: %+v", lastResp)
	})

	It("has ingested samples into its TSDB", func() {
		// Proves data is actually landing in Prometheus (not just that the
		// scrape pipeline is wired up). `prometheus_tsdb_head_samples_appended_total`
		// is the raw counter Prometheus increments as it appends to the head
		// block; any non-zero value means at least one scrape has been
		// persisted to the head, which in turn requires a working TSDB path
		// on the bound PV.
		//
		// We intentionally query the counter directly rather than rate(X[1m])
		// because this test can start within ~10 seconds of Prometheus
		// launching, which is well under the 1-minute window a rate() needs
		// to produce a non-empty result. The counter is non-zero the moment
		// the first self-scrape succeeds (~15s after Prometheus starts under
		// default config).
		var lastResp promQueryResponse
		Eventually(func() error {
			lastResp = queryPrometheus(ssh, "prometheus_tsdb_head_samples_appended_total")
			if lastResp.Status != "success" {
				return fmt.Errorf("prometheus status=%q", lastResp.Status)
			}
			if len(lastResp.Data.Result) == 0 {
				return fmt.Errorf(
					"prometheus_tsdb_head_samples_appended_total has no series yet; " +
						"prometheus has not completed its first self-scrape")
			}
			for _, series := range lastResp.Data.Result {
				if v, ok := scalarFromValue(series.Value); ok && v > 0 {
					return nil
				}
			}
			return fmt.Errorf("counter present but zero on all %d series", len(lastResp.Data.Result))
		}, 2*time.Minute, 10*time.Second).Should(Succeed(),
			"prometheus TSDB never reported ingested samples. Last response: %+v", lastResp)
	})
})

// queryPrometheus runs an instant Prometheus query by opening a short-lived
// `kubectl port-forward` from inside the VM and hitting the local port with
// `curl`. Using the VM's curl (vs `kubectl exec ... -- wget`) keeps us
// decoupled from what's inside the prometheus-server container image.
func queryPrometheus(ssh SSHConfig, promQL string) promQueryResponse {
	GinkgoHelper()

	script := fmt.Sprintf(`
set -euo pipefail
sudo kubectl -n %s port-forward svc/%s %s:%s >/tmp/ndm-obs-pf.log 2>&1 &
PF=$!
trap "kill $PF 2>/dev/null || true" EXIT
# Wait for the port-forward to start accepting traffic (up to ~10s).
for i in $(seq 1 40); do
  if curl -sf --max-time 1 http://127.0.0.1:%s/-/ready >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
curl -sfS --max-time 15 "http://127.0.0.1:%s/api/v1/query?query=%s"
`,
		promNamespace, promServiceName, promLocalPort, promServicePort,
		promLocalPort, promLocalPort, url.QueryEscape(promQL))

	out, err := RunSSHScript(ssh, script)
	Expect(err).NotTo(HaveOccurred(),
		"prometheus query %q failed over SSH", promQL)

	var resp promQueryResponse
	Expect(json.Unmarshal([]byte(out), &resp)).To(Succeed(),
		"prometheus response was not valid JSON for query %q:\n%s", promQL, out)
	return resp
}

// scalarFromValue pulls the numeric value out of a Prometheus instant-query
// result tuple (`[<ts>, "<value>"]`).
func scalarFromValue(v []interface{}) (float64, bool) {
	if len(v) != 2 {
		return 0, false
	}
	s, ok := v[1].(string)
	if !ok {
		return 0, false
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return f, true
}

func firstNonEmpty(xs ...string) string {
	for _, x := range xs {
		if x != "" {
			return x
		}
	}
	return ""
}

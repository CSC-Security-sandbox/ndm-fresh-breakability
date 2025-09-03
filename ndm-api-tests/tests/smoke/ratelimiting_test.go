package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"sync"
	"time"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Rate Limiting Smoke", func() {
	Context("Rate Limiting", func() {
		var headers map[string]string

		BeforeEach(func() {
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("Rate Limiting Test - Admin Service API", func() {
			By("########################## RATE LIMITING START ################################")

			endpoint := fmt.Sprintf("%s/api/v1/about-ndm", ADMIN_SERVICE_URL)

			var successfulRequests int
			var rateLimitedRequests int
			var otherErrors int
			var mu sync.Mutex // Mutex to protect shared counters

			By("Sending exactly 100 requests in under 1 second to test rate limiting")

			maxRequests := 100
			// Record start time
			startTime := time.Now()

			// Create a ticker to send requests at 111 requests per second (9ms intervals = 900ms total)
			ticker := time.NewTicker(9 * time.Millisecond)
			defer ticker.Stop()

			requestsSent := 0

			// Send requests at controlled rate
			for range ticker.C {
				if requestsSent >= maxRequests {
					break
				}

				requestsSent++
				reqNum := requestsSent

				go func(reqNum int) {
					resp, err := SendAPIRequest(http.MethodGet, endpoint, nil, headers)

					mu.Lock()
					defer mu.Unlock()

					if err != nil || resp == nil {
						LogError(fmt.Sprintf("Request %d failed with error: %v", reqNum, err))
						otherErrors++
						return
					}

					switch resp.StatusCode {
					case http.StatusOK:
						successfulRequests++
					case http.StatusTooManyRequests: // 429
						rateLimitedRequests++
					case http.StatusServiceUnavailable: // 503
						rateLimitedRequests++
					default:
						otherErrors++
					}

					if resp.Body != nil {
						resp.Body.Close()
					}
				}(reqNum)
			}

			// Log how long it took to send all requests
			sendDuration := time.Since(startTime)
			LogDebug(fmt.Sprintf("All %d requests sent in %v", maxRequests, sendDuration))

			// Wait for all requests to complete
			LogDebug("Waiting for all requests to complete...")
			Wait(5)

			By("Verifying rate limiting behavior")
			LogDebug(fmt.Sprintf("Test Results - Successful: %d, Rate Limited: %d, Other Errors: %d",
				successfulRequests, rateLimitedRequests, otherErrors))

			// Verify that successful requests were less than or equal to 30 (the actual cap)
			Expect(successfulRequests).To(BeNumerically("<=", 30),
				fmt.Sprintf("Expected less than or equal to 30 successful requests, got %d", successfulRequests))

			// Verify that most requests were rate limited
			Expect(rateLimitedRequests).To(BeNumerically(">=", 70),
				fmt.Sprintf("Expected greater than or equal to 70 rate limited requests, got %d", rateLimitedRequests))

			By("########################## RATE LIMITING END ################################")

		})
	})
})

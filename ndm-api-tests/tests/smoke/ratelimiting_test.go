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
			var mu sync.Mutex     // Mutex to protect shared counters
			var wg sync.WaitGroup // WaitGroup to ensure all requests complete

			By("Sending exactly 100 requests in 800ms to test rate limiting")

			maxRequests := 100
			// Record start time
			startTime := time.Now()

			// Create a ticker to send requests at 125 requests per second (8ms intervals = 800ms total)
			ticker := time.NewTicker(8 * time.Millisecond)
			defer ticker.Stop()

			requestsSent := 0

			// Send requests at controlled rate
			for range ticker.C {
				if requestsSent >= maxRequests {
					break
				}

				requestsSent++
				reqNum := requestsSent

				wg.Add(1) // Increment WaitGroup counter
				go func(reqNum int) {
					defer wg.Done() // Decrement WaitGroup counter when goroutine completes

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

			// Wait for all requests to complete using WaitGroup
			LogDebug("Waiting for all requests to complete...")
			wg.Wait() // Wait for all goroutines to finish

			By("Verifying rate limiting behavior")
			totalRequests := successfulRequests + rateLimitedRequests + otherErrors
			LogDebug(fmt.Sprintf("Test Results - Successful: %d, Rate Limited: %d, Other Errors: %d, Total: %d",
				successfulRequests, rateLimitedRequests, otherErrors, totalRequests))

			// Verify all requests were processed
			Expect(totalRequests).To(Equal(maxRequests),
				fmt.Sprintf("Expected %d total requests to be processed, got %d", maxRequests, totalRequests))

			// todo: check why >45 requests are successful since 25 is istio token limit configured
			maxAllowedSuccess := RATE_LIMIT_MAX_ALLOWED_SUCCESS_REQ
			Expect(successfulRequests).To(BeNumerically("<=", maxAllowedSuccess),
				fmt.Sprintf("Expected less than or equal to %d successful requests (configurable via RATE_LIMIT_MAX_ALLOWED_SUCCESS_REQ env var), got %d", maxAllowedSuccess, successfulRequests))

			// Verify that most requests were rate limited
			// Calculation: 100 total - 52 max successful = 48 minimum rate limited
			// This ensures rate limiting is working correctly
			minRateLimited := maxRequests - maxAllowedSuccess // 100 - 52 = 48
			Expect(rateLimitedRequests).To(BeNumerically(">=", minRateLimited),
				fmt.Sprintf("Expected greater than or equal to %d rate limited requests (100 total - %d max successful), got %d", minRateLimited, maxAllowedSuccess, rateLimitedRequests))

			By("########################## RATE LIMITING END ################################")

		})
	})
})

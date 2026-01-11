package tests

import (
	"fmt"
	. "ndm-api-tests/utils"
	"net/http"
	"os"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// Dell Isilon test environment variables
var (
	ISILON_MANAGEMENT_HOST     string
	ISILON_MANAGEMENT_PORT     int
	ISILON_MANAGEMENT_USERNAME string
	ISILON_MANAGEMENT_PASSWORD string
	ISILON_NFS_HOST            string
	ISILON_NFS_USERNAME        string
	ISILON_NFS_PASSWORD        string
	ISILON_SMB_HOST            string
	ISILON_SMB_USERNAME        string
	ISILON_SMB_PASSWORD        string
	ISILON_ZONE_ID             int
)

func initIsilonEnv() {
	ISILON_MANAGEMENT_HOST = os.Getenv("ISILON_MANAGEMENT_HOST")
	ISILON_MANAGEMENT_PORT = 8080
	ISILON_MANAGEMENT_USERNAME = os.Getenv("ISILON_MANAGEMENT_USERNAME")
	ISILON_MANAGEMENT_PASSWORD = os.Getenv("ISILON_MANAGEMENT_PASSWORD")
	ISILON_NFS_HOST = os.Getenv("ISILON_NFS_HOST")
	ISILON_NFS_USERNAME = os.Getenv("ISILON_NFS_USERNAME")
	ISILON_NFS_PASSWORD = os.Getenv("ISILON_NFS_PASSWORD")
	ISILON_SMB_HOST = os.Getenv("ISILON_SMB_HOST")
	ISILON_SMB_USERNAME = os.Getenv("ISILON_SMB_USERNAME")
	ISILON_SMB_PASSWORD = os.Getenv("ISILON_SMB_PASSWORD")
	ISILON_ZONE_ID = 1 // Default to System zone (zone ID 1)
}

var _ = Describe("TC-ISILON: Dell Isilon File Server Creation and Validation", func() {
	var headers map[string]string
	var (
		ProjectId             string
		workerId1             string
		workerIds             []string
		err                   error
		attachedWorkersConfig map[string]SSHConfig
	)

	Context("Dell Isilon File Server Operations", func() {

		BeforeEach(func() {
			// Initialize Isilon-specific environment variables
			initIsilonEnv()

			// Validate required environment variables
			Expect(ISILON_MANAGEMENT_HOST).NotTo(BeEmpty(), "ISILON_MANAGEMENT_HOST is required")
			Expect(ISILON_MANAGEMENT_USERNAME).NotTo(BeEmpty(), "ISILON_MANAGEMENT_USERNAME is required")
			Expect(ISILON_MANAGEMENT_PASSWORD).NotTo(BeEmpty(), "ISILON_MANAGEMENT_PASSWORD is required")

			numberOfWorker := 1
			ProjectId, attachedWorkersConfig, err = SetupTestEnv(numberOfWorker)
			Expect(err).To(BeNil(), "Error during test environment setup")
			Expect(len(attachedWorkersConfig)).Should(BeNumerically(">=", 1), "Expected at least 1 worker to be attached")
			workerIds = GetWorkerIds()
			workerId1 = workerIds[0]
			headers = GetHeaders(AuthToken, ContentTypeJSON)
		})

		It("TC-ISILON: Complete Dell Isilon file server workflow - certificate, zones, NFS, SMB, dual-protocol, and error handling", func() {
			By("########################## TC-ISILON start ################################")

			// ============================================================================
			// STEP 1: Certificate Fetch
			// ============================================================================
			By("STEP 1: Fetching TLS certificate from Dell Isilon management console")
			certResp, err := FetchIsilonCertificate(ISILON_MANAGEMENT_HOST, headers)
			Expect(err).NotTo(HaveOccurred(), "Error fetching certificate")
			Expect(certResp).NotTo(BeNil(), "Certificate response should not be nil")
			Expect(certResp.Data.CertificatePEM).NotTo(BeEmpty(), "Certificate PEM should not be empty")
			Expect(certResp.Data.ValidTo).NotTo(BeEmpty(), "Certificate valid-to should not be empty")
			Expect(certResp.Data.IsExpired).To(BeFalse(), "Certificate should not be expired")

			LogDebug("Certificate fetched successfully:")
			LogDebug(fmt.Sprintf("  - Fingerprint: %s", certResp.Data.Fingerprint))
			LogDebug(fmt.Sprintf("  - Valid From: %s", certResp.Data.ValidFrom))
			LogDebug(fmt.Sprintf("  - Valid To: %s", certResp.Data.ValidTo))
			LogDebug(fmt.Sprintf("  - Days Remaining: %d", certResp.Data.DaysRemaining))
			LogDebug(fmt.Sprintf("  - Is Self-Signed: %v", certResp.Data.IsSelfSigned))

			// ============================================================================
			// STEP 2: Zones Fetch
			// ============================================================================
			By("STEP 2: Fetching zones from Dell Isilon management console")
			zonesResp, err := FetchIsilonZones(
				ISILON_MANAGEMENT_HOST,
				ISILON_MANAGEMENT_USERNAME,
				ISILON_MANAGEMENT_PASSWORD,
				certResp.Data.CertificatePEM,
				headers,
			)
			Expect(err).NotTo(HaveOccurred(), "Error fetching zones")
			Expect(zonesResp).NotTo(BeNil(), "Zones response should not be nil")
			Expect(zonesResp.Data.Items.TotalZones).To(BeNumerically(">", 0), "Should have at least one zone")
			Expect(len(zonesResp.Data.Items.Zones)).To(BeNumerically(">", 0), "Zones array should not be empty")

			LogDebug("Zones fetched successfully:")
			LogDebug(fmt.Sprintf("  - Total Zones: %d", zonesResp.Data.Items.TotalZones))
			LogDebug(fmt.Sprintf("  - Total IP Addresses: %d", zonesResp.Data.Items.TotalIpAddresses))
			for _, zone := range zonesResp.Data.Items.Zones {
				LogDebug(fmt.Sprintf("  - Zone %d: %s (IPs: %d)", zone.ZoneId, zone.ZoneName, len(zone.IpAddresses)))
			}

			// ============================================================================
			// STEP 3: Create Dell Isilon File Server with NFS Only
			// ============================================================================
			var nfsOnlyConfigID string
			if ISILON_NFS_HOST != "" {
				By("STEP 3: Creating Dell Isilon file server with NFS only")
				nfsCredentials := map[int]*IsilonZoneCredentials{
					ISILON_ZONE_ID: {
						Host:            ISILON_NFS_HOST,
						Username:        ISILON_NFS_USERNAME,
						Password:        ISILON_NFS_PASSWORD,
						ProtocolVersion: "v3",
						Workers:         []string{workerId1},
					},
				}

				nfsOnlyConfigID, err = CreateIsilonFileServerWithFlow(
					ProjectId,
					"isilon-nfs-only-test",
					ISILON_MANAGEMENT_HOST,
					ISILON_MANAGEMENT_USERNAME,
					ISILON_MANAGEMENT_PASSWORD,
					ISILON_MANAGEMENT_PORT,
					[]int{ISILON_ZONE_ID},
					nfsCredentials,
					nil, // No SMB credentials
					headers,
				)
				Expect(err).NotTo(HaveOccurred(), "Error creating Isilon file server with NFS")
				Expect(nfsOnlyConfigID).NotTo(BeEmpty(), "Config ID should not be empty")

				By("Validating NFS-only file server status is ACTIVE")
				err = ValidateIsilonFileServerStatus(nfsOnlyConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "File server should be ACTIVE")

				LogDebug(fmt.Sprintf("Dell Isilon NFS-only file server created: %s", nfsOnlyConfigID))
			} else {
				LogDebug("STEP 3: Skipping NFS-only test - ISILON_NFS_HOST not configured")
			}

			// ============================================================================
			// STEP 4: Create Dell Isilon File Server with SMB Only
			// ============================================================================
			var smbOnlyConfigID string
			if ISILON_SMB_HOST != "" {
				By("STEP 4: Creating Dell Isilon file server with SMB only")
				smbCredentials := map[int]*IsilonZoneCredentials{
					ISILON_ZONE_ID: {
						Host:     ISILON_SMB_HOST,
						Username: ISILON_SMB_USERNAME,
						Password: ISILON_SMB_PASSWORD,
						Workers:  []string{workerId1},
					},
				}

				smbOnlyConfigID, err = CreateIsilonFileServerWithFlow(
					ProjectId,
					"isilon-smb-only-test",
					ISILON_MANAGEMENT_HOST,
					ISILON_MANAGEMENT_USERNAME,
					ISILON_MANAGEMENT_PASSWORD,
					ISILON_MANAGEMENT_PORT,
					[]int{ISILON_ZONE_ID},
					nil, // No NFS credentials
					smbCredentials,
					headers,
				)
				Expect(err).NotTo(HaveOccurred(), "Error creating Isilon file server with SMB")
				Expect(smbOnlyConfigID).NotTo(BeEmpty(), "Config ID should not be empty")

				By("Validating SMB-only file server status is ACTIVE")
				err = ValidateIsilonFileServerStatus(smbOnlyConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "File server should be ACTIVE")

				LogDebug(fmt.Sprintf("Dell Isilon SMB-only file server created: %s", smbOnlyConfigID))
			} else {
				LogDebug("STEP 4: Skipping SMB-only test - ISILON_SMB_HOST not configured")
			}

			// ============================================================================
			// STEP 5: Create Dell Isilon File Server with Dual Protocol (NFS + SMB)
			// ============================================================================
			var dualProtocolConfigID string
			if ISILON_NFS_HOST != "" && ISILON_SMB_HOST != "" {
				By("STEP 5: Creating Dell Isilon file server with both NFS and SMB")
				nfsCredentials := map[int]*IsilonZoneCredentials{
					ISILON_ZONE_ID: {
						Host:            ISILON_NFS_HOST,
						Username:        ISILON_NFS_USERNAME,
						Password:        ISILON_NFS_PASSWORD,
						ProtocolVersion: "v3",
						Workers:         []string{workerId1},
					},
				}

				smbCredentials := map[int]*IsilonZoneCredentials{
					ISILON_ZONE_ID: {
						Host:     ISILON_SMB_HOST,
						Username: ISILON_SMB_USERNAME,
						Password: ISILON_SMB_PASSWORD,
						Workers:  []string{workerId1},
					},
				}

				dualProtocolConfigID, err = CreateIsilonFileServerWithFlow(
					ProjectId,
					"isilon-dual-protocol-test",
					ISILON_MANAGEMENT_HOST,
					ISILON_MANAGEMENT_USERNAME,
					ISILON_MANAGEMENT_PASSWORD,
					ISILON_MANAGEMENT_PORT,
					[]int{ISILON_ZONE_ID},
					nfsCredentials,
					smbCredentials,
					headers,
				)
				Expect(err).NotTo(HaveOccurred(), "Error creating Isilon file server with dual protocol")
				Expect(dualProtocolConfigID).NotTo(BeEmpty(), "Config ID should not be empty")

				By("Validating dual-protocol file server status is ACTIVE")
				err = ValidateIsilonFileServerStatus(dualProtocolConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "File server should be ACTIVE")

				LogDebug(fmt.Sprintf("Dell Isilon dual-protocol file server created: %s", dualProtocolConfigID))
			} else {
				LogDebug("STEP 5: Skipping dual-protocol test - Both ISILON_NFS_HOST and ISILON_SMB_HOST required")
			}

			// ============================================================================
			// STEP 6: Create Dell Isilon with Multiple Zones (if available)
			// ============================================================================
			if ISILON_NFS_HOST != "" && zonesResp.Data.Items.TotalZones >= 2 {
				By("STEP 6: Creating Dell Isilon file server with multiple zones")

				// Get first two zone IDs
				zone1 := zonesResp.Data.Items.Zones[0]
				zone2 := zonesResp.Data.Items.Zones[1]
				selectedZones := []int{zone1.ZoneId, zone2.ZoneId}

				// Configure NFS for both zones
				nfsCredentials := map[int]*IsilonZoneCredentials{
					zone1.ZoneId: {
						Host:            ISILON_NFS_HOST,
						Username:        ISILON_NFS_USERNAME,
						Password:        ISILON_NFS_PASSWORD,
						ProtocolVersion: "v3",
						Workers:         []string{workerId1},
					},
					zone2.ZoneId: {
						Host:            ISILON_NFS_HOST,
						Username:        ISILON_NFS_USERNAME,
						Password:        ISILON_NFS_PASSWORD,
						ProtocolVersion: "v3",
						Workers:         []string{workerId1},
					},
				}

				multiZoneConfigID, err := CreateIsilonFileServerWithFlow(
					ProjectId,
					"isilon-multi-zone-test",
					ISILON_MANAGEMENT_HOST,
					ISILON_MANAGEMENT_USERNAME,
					ISILON_MANAGEMENT_PASSWORD,
					ISILON_MANAGEMENT_PORT,
					selectedZones,
					nfsCredentials,
					nil,
					headers,
				)
				Expect(err).NotTo(HaveOccurred(), "Error creating Isilon file server with multiple zones")
				Expect(multiZoneConfigID).NotTo(BeEmpty(), "Config ID should not be empty")

				By("Validating multi-zone file server status is ACTIVE")
				err = ValidateIsilonFileServerStatus(multiZoneConfigID, headers)
				Expect(err).NotTo(HaveOccurred(), "File server should be ACTIVE")

				LogDebug(fmt.Sprintf("Dell Isilon multi-zone file server created: %s", multiZoneConfigID))
			} else {
				LogDebug("STEP 6: Skipping multi-zone test - Either NFS not configured or fewer than 2 zones available")
			}

			// ============================================================================
			// STEP 7: Verify File Server List Contains Dell Isilon
			// ============================================================================
			if nfsOnlyConfigID != "" {
				By("STEP 7: Verifying Dell Isilon file server appears in file server list")
				getURL := fmt.Sprintf("%s%s/%s", CONFIG_SERVICE_URL, FILESERVER_ENDPOINT, nfsOnlyConfigID)
				resp, err := SendAPIRequest(http.MethodGet, getURL, nil, headers)
				Expect(err).NotTo(HaveOccurred(), "Error getting file server")
				Expect(resp.StatusCode).To(Equal(http.StatusOK), "Expected HTTP 200 OK")
				defer resp.Body.Close()

				LogDebug(fmt.Sprintf("Dell Isilon file server %s verified in list", nfsOnlyConfigID))
			} else {
				LogDebug("STEP 7: Skipping list verification - No file server was created")
			}

			// ============================================================================
			// STEP 8: Error Handling - Invalid Certificate Host
			// ============================================================================
			By("STEP 8: Testing error handling for invalid management host")
			_, err = FetchIsilonCertificate("invalid.isilon.host", headers)
			Expect(err).To(HaveOccurred(), "Should fail with invalid host")
			LogDebug("Error handling for invalid host verified")

			// ============================================================================
			// STEP 9: Error Handling - Invalid Credentials
			// ============================================================================
			By("STEP 9: Testing error handling for invalid management credentials")
			_, err = FetchIsilonZones(
				ISILON_MANAGEMENT_HOST,
				"invalid_user",
				"invalid_password",
				certResp.Data.CertificatePEM,
				headers,
			)
			Expect(err).To(HaveOccurred(), "Should fail with invalid credentials")
			LogDebug("Error handling for invalid credentials verified")

			By("########################## TC-ISILON end ################################")
		})

		AfterEach(func() {
			By("Cleanup started")

			err := StopAllWorkersAndWait()
			Expect(err).NotTo(HaveOccurred(), "Error stopping workers")

			err = CleanupTestEnv()
			Expect(err).To(BeNil(), "Error during test environment cleanup")
			LogDebug("Cleanup complete.")
		})
	})
})

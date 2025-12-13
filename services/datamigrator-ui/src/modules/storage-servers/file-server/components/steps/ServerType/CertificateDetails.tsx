import { Box } from "@components/container/index";
import { Button } from "@netapp/bxp-design-system-react";
import { CertificateResponseType } from "@modules/storage-servers/file-server/fileServer.interface";

interface CertificateDetailsProps {
  certificate: CertificateResponseType | null;
  onAccept: () => void;
  onDecline: () => void;
  isLoading?: boolean;
  isOpen: boolean;
  error?: string | null;
}

const CertificateDetails = ({
  certificate,
  onAccept,
  onDecline,
  isLoading = false,
  isOpen,
  error = null,
}: CertificateDetailsProps) => {
  if (!isOpen) return null;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getValidityStatus = () => {
    if (!certificate) return { text: "", color: "", bg: "" };
    if (certificate.isExpired) {
      return { text: "Expired", color: "text-red-600", bg: "bg-red-100" };
    }
    if (certificate.daysRemaining <= 30) {
      return { text: "Expiring Soon", color: "text-yellow-600", bg: "bg-yellow-100" };
    }
    return { text: "Valid", color: "text-green-600", bg: "bg-green-100" };
  };

  const validityStatus = getValidityStatus();

  const renderSubjectInfo = (
    title: string,
    data: { CN?: string; O?: string; OU?: string; C?: string; ST?: string; L?: string }
  ) => (
    <Box className="mb-4">
      <Box className="text-sm font-semibold text-gray-700 mb-2">{title}</Box>
      <Box className="bg-gray-50 rounded-md p-3 text-sm space-y-1">
        {data?.CN && (
          <Box className="flex">
            <span className="text-gray-500 w-40">Common Name (CN):</span>
            <span className="text-gray-900 font-medium">{data.CN}</span>
          </Box>
        )}
        {data?.O && (
          <Box className="flex">
            <span className="text-gray-500 w-40">Organization (O):</span>
            <span className="text-gray-900">{data.O}</span>
          </Box>
        )}
        {data?.OU && (
          <Box className="flex">
            <span className="text-gray-500 w-40">Org. Unit (OU):</span>
            <span className="text-gray-900">{data.OU}</span>
          </Box>
        )}
        {data?.C && (
          <Box className="flex">
            <span className="text-gray-500 w-40">Country (C):</span>
            <span className="text-gray-900">{data.C}</span>
          </Box>
        )}
        {data?.ST && (
          <Box className="flex">
            <span className="text-gray-500 w-40">State (ST):</span>
            <span className="text-gray-900">{data.ST}</span>
          </Box>
        )}
        {data?.L && (
          <Box className="flex">
            <span className="text-gray-500 w-40">Locality (L):</span>
            <span className="text-gray-900">{data.L}</span>
          </Box>
        )}
      </Box>
    </Box>
  );

  // Determine header title based on state
  const getHeaderTitle = () => {
    if (isLoading) return "Fetching...";
    if (error) return "Certificate Error";
    return "Certificate Details";
  };

  // Determine header subtitle based on state
  const getHeaderSubtitle = () => {
    if (isLoading) return "Please wait while we retrieve the certificate details.";
    if (error) return "";
    return certificate ? `${certificate.host}:${certificate.port}` : "";
  };

  return (
    <Box 
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center"
      onClick={!isLoading ? onDecline : undefined}
    >
      {/* Modal Content */}
      <Box 
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <Box className="flex items-center gap-3 p-4 border-b border-gray-200 bg-gray-50">
          <Box className="flex-1">
            <Box className="text-lg font-semibold text-gray-900">{getHeaderTitle()}</Box>
            {getHeaderSubtitle() && (
              <Box className="text-sm text-gray-500">{getHeaderSubtitle()}</Box>
            )}
          </Box>
          {/* Close button - hidden during loading */}
          {!isLoading && (
            <button
              onClick={onDecline}
              className="text-gray-400 hover:text-gray-600 text-xl font-bold p-1"
            >
              ×
            </button>
          )}
        </Box>

        {/* Content */}
        <Box className="p-4 max-h-[60vh] overflow-y-auto">
          {/* Loading State */}
          {isLoading && (
            <Box className="flex flex-col items-center justify-center py-12">
              <Box className="animate-spin rounded-full h-10 w-10 border-4 border-blue-600 border-t-transparent mb-4"></Box>
              <Box className="text-sm text-gray-500">Connecting to management console...</Box>
            </Box>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <Box className="py-6">
              <Box className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-md">
                <Box className="flex-shrink-0 w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                  <span className="text-red-600 font-bold">!</span>
                </Box>
                <Box>
                  <Box className="text-sm font-medium text-red-800 mb-1">Failed to fetch certificate</Box>
                  <Box className="text-sm text-red-700">{error}</Box>
                </Box>
              </Box>
            </Box>
          )}

          {/* Certificate Details - Only show when we have data and no error */}
          {certificate && !isLoading && !error && (
            <>
              {/* Self-Signed Warning Banner */}
              {certificate.isSelfSigned && (
                <Box className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                  <Box className="text-sm font-semibold text-yellow-800 mb-1">Self-Signed Certificate</Box>
                  <Box className="text-sm text-yellow-700">
                    This certificate is self-signed and was not issued by a trusted Certificate Authority. Proceed only if you trust this server.
                  </Box>
                </Box>
              )}

              {/* Subject */}
              {renderSubjectInfo("Subject", certificate.subject)}

              {/* Issuer */}
              {renderSubjectInfo("Issuer", certificate.issuer)}

              {/* Validity */}
              <Box className="mb-4">
                <Box className="text-sm font-semibold text-gray-700 mb-2">Validity</Box>
                <Box className="bg-gray-50 rounded-md p-3 text-sm space-y-1">
                  <Box className="flex">
                    <span className="text-gray-500 w-40">Valid From:</span>
                    <span className="text-gray-900">{formatDate(certificate.validFrom)}</span>
                  </Box>
                  <Box className="flex">
                    <span className="text-gray-500 w-40">Valid To:</span>
                    <span className="text-gray-900">{formatDate(certificate.validTo)}</span>
                  </Box>
                  <Box className="flex items-center">
                    <span className="text-gray-500 w-40">Status:</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${validityStatus.bg} ${validityStatus.color}`}>
                      {validityStatus.text}
                    </span>
                    <span className="text-gray-500 ml-2">
                      ({certificate.daysRemaining} days remaining)
                    </span>
                  </Box>
                </Box>
              </Box>

              {/* Serial Number */}
              <Box className="mb-4">
                <Box className="text-sm font-semibold text-gray-700 mb-2">Serial Number</Box>
                <Box className="bg-gray-50 rounded-md p-3 text-sm">
                  <code className="text-gray-900 break-all">{certificate.serialNumber}</code>
                </Box>
              </Box>

              {/* Fingerprints */}
              <Box className="mb-4">
                <Box className="text-sm font-semibold text-gray-700 mb-2">Fingerprints</Box>
                <Box className="bg-gray-50 rounded-md p-3 text-sm space-y-2">
                  <Box>
                    <span className="text-gray-500 block mb-1">SHA-1:</span>
                    <code className="text-gray-900 text-xs break-all">{certificate.fingerprint}</code>
                  </Box>
                  <Box>
                    <span className="text-gray-500 block mb-1">SHA-256:</span>
                    <code className="text-gray-900 text-xs break-all">{certificate.fingerprint256}</code>
                  </Box>
                </Box>
              </Box>

              {/* Subject Alternative Names */}
              {certificate.subjectAltNames && certificate.subjectAltNames.length > 0 && (
                <Box className="mb-4">
                  <Box className="text-sm font-semibold text-gray-700 mb-2">Subject Alternative Names</Box>
                  <Box className="bg-gray-50 rounded-md p-3 text-sm">
                    <Box className="flex flex-wrap gap-2">
                      {certificate.subjectAltNames.map((san, index) => (
                        <span
                          key={index}
                          className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded"
                        >
                          {san}
                        </span>
                      ))}
                    </Box>
                  </Box>
                </Box>
              )}
            </>
          )}
        </Box>

        {/* Footer - Show different buttons based on state */}
        <Box className="flex justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50 items-center">
          {/* Loading state - no buttons */}
          {isLoading && (
            <Box className="text-sm text-gray-500">Please wait...</Box>
          )}

          {/* Error state - just Close button */}
          {error && !isLoading && (
            <Button
              onClick={onDecline}
              style={{ minWidth: 100, height: 40 }}
            >
              Close
            </Button>
          )}

          {/* Success state - Decline and Accept buttons */}
          {certificate && !isLoading && !error && (
            <>
              <button
                onClick={onDecline}
                className="px-4 h-10 bg-red-600 hover:bg-red-700 text-white font-medium rounded"
                style={{ minWidth: 100 }}
              >
                Decline
              </button>
              <Button
                onClick={onAccept}
                style={{ minWidth: 180, height: 40 }}
              >
                Accept and Continue
              </Button>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default CertificateDetails;

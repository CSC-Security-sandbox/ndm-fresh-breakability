import React from "react";
import { Box } from "@components/container/index";
import { Text, Button } from "@netapp/bxp-design-system-react";
import { ProtocolType } from "@/types/app.type";

interface IdentityMappingData {
  identityType: string;
  identityMap?: string;
  sourceMapping: string;
  targetMapping: string;
}

interface ExistingMappingsResponse {
  items?: {
    data: IdentityMappingData[];
    crossMappings?: any[];
  };
}

interface ExistingIdentityMappingsProps {
  existingMappings?: ExistingMappingsResponse;
  protocol: string;
  jobId: string;
  jobRunId?: string;
}

export const convertMappingsToCSV = (
  mappingsData: IdentityMappingData[],
  protocol: string
): string => {
  if (!mappingsData || mappingsData.length === 0) {
    return protocol === ProtocolType.NFS 
      ? "gid_source,gid_target,uid_source,uid_target\n"
      : "sid_source,sid_target\n";
  }
  if (protocol === ProtocolType.NFS) {
    return convertGidUidMappingsToCSV(mappingsData);
  } else {
    return convertSidMappingsToCSV(mappingsData);
  }
};

export const convertGidUidMappingsToCSV = (mappingsData: IdentityMappingData[]): string => {
  const header = "gid_source,gid_target,uid_source,uid_target\n";
  const rows: string[] = [];
  for (let i = 0; i < mappingsData.length; i += 2) {
    const gid = mappingsData[i];
    const uid = mappingsData[i + 1];
    const gidSource = gid?.sourceMapping ?? "";
    const gidTarget = gid?.targetMapping ?? "";
    const uidSource = uid?.sourceMapping ?? "";
    const uidTarget = uid?.targetMapping ?? "";
    rows.push(`${gidSource},${gidTarget},${uidSource},${uidTarget}`);
  }
  return header + rows.join("\n");
};

export const convertSidMappingsToCSV = (mappingsData: IdentityMappingData[]): string => {
  const header = "sid_source,sid_target\n";
  const sidMappings = mappingsData
    .filter(mapping => mapping.identityType.toUpperCase() === 'SID')
    .map(mapping => `${mapping.sourceMapping},${mapping.targetMapping}`)
    .join('\n');
  return header + sidMappings;
};

export const downloadCSVFile = (csvContent: string, filename: string): void => {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

const ExistingIdentityMappings: React.FC<ExistingIdentityMappingsProps> = ({
  existingMappings,
  protocol,
  jobId,
  jobRunId,
}) => {
  const mappingsData = existingMappings?.items?.data;
  const handleDownloadExistingMappings = () => {
    const csvContent = convertMappingsToCSV(mappingsData, protocol);
    const filename = jobRunId ?
    protocol === ProtocolType.NFS ? `Uploaded_GidMapping_${jobRunId}.csv` : `Uploaded_SidMapping_${jobRunId}.csv`
    : protocol === ProtocolType.NFS ? `Uploaded_GidMapping_${jobId}.csv` : `Uploaded_SidMapping_${jobId}.csv`;
    downloadCSVFile(csvContent, filename);
  };

  return (
    <Box className="flex gap-2 items-center">
        { jobRunId ? <Text bold className="!mb-0">Mapping Used: </Text> : 
          <Text bold className="!mb-0">Uploaded Mapping: </Text>
        }
        <Button
          variant="text"
          onClick={handleDownloadExistingMappings}
          className="!p-1 !text-sm"
        >
          Download CSV
        </Button>
    </Box>
  );
};

export default ExistingIdentityMappings;
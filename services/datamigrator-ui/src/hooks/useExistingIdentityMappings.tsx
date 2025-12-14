import React from "react";
import { Box } from "@components/container/index";
import { Text, Button } from "@netapp/bxp-design-system-react"
import { ProtocolType } from "@/types/app.type";

interface IdentityMappingData {
  identityType: string;
  sourceMapping: string;
  targetMapping: string;
}

interface ExistingMappingsResponse {
  items?: {
    data: IdentityMappingData[];
    crossMappings: any[];
  };
}

interface ExistingIdentityMappingsProps {
  existingMappings?: ExistingMappingsResponse;
  protocol: string;
}

const convertMappingsToCSV = (
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

const convertGidUidMappingsToCSV = (mappingsData: IdentityMappingData[]): string => {
  const header = "gid_source,gid_target,uid_source,uid_target\n";
  
  // Group mappings by source mapping to pair GID and UID together
  const groupedMappings = new Map<string, { gid?: IdentityMappingData, uid?: IdentityMappingData }>();
  
  mappingsData.forEach(mapping => {
    const key = mapping.sourceMapping;
    if (!groupedMappings.has(key)) {
      groupedMappings.set(key, {});
    }
    
    const group = groupedMappings.get(key)!;
    if (mapping.identityType.toUpperCase() === 'GID') {
      group.gid = mapping;
    } else if (mapping.identityType.toUpperCase() === 'UID') {
      group.uid = mapping;
    }
  });
  
  const rows: string[] = [];
  
  groupedMappings.forEach((group) => {
    const gidSource = group.gid?.sourceMapping || '';
    const gidTarget = group.gid?.targetMapping || '';
    const uidSource = group.uid?.sourceMapping || '';
    const uidTarget = group.uid?.targetMapping || '';
    
    if (gidSource || uidSource) {
      rows.push(`${gidSource},${gidTarget},${uidSource},${uidTarget}`);
    }
  });
  
  return header + rows.join('\n');
};

const convertSidMappingsToCSV = (mappingsData: IdentityMappingData[]): string => {
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

export const getExistingMappingsFilename = (protocol: string): string => {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  return protocol === ProtocolType.NFS 
    ? `existing-gid-uid-mappings-${timestamp}.csv`
    : `existing-sid-mappings-${timestamp}.csv`;
};

const ExistingIdentityMappings: React.FC<ExistingIdentityMappingsProps> = ({
  existingMappings,
  protocol,
}) => {
  const mappingsData = existingMappings?.items?.data;
  const handleDownloadExistingMappings = () => {
    const csvContent = convertMappingsToCSV(mappingsData, protocol);
    const filename = getExistingMappingsFilename(protocol);
    downloadCSVFile(csvContent, filename);
  };

  return (
    <Box className="flex gap-2 items-center mb-2">
        <Text bold className="!mb-0">Uploaded Mapping: </Text>
        <Button
            variant="text"
            onClick={handleDownloadExistingMappings}
            className="!p-1 !text-sm"
        >
            Download as CSV
        </Button>
    </Box>
  );
};

export default ExistingIdentityMappings;
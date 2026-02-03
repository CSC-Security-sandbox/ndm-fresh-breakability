import { useState, useMemo } from "react";
import { Box } from "@components/container/index";
import useFileServerDetails from "@hooks/useFileServerDetails";
import { Button, Checkbox } from "@netapp/bxp-design-system-react";
import { VolumeType } from "@/types/app.type";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import { ArrowBackIcon } from "@netapp/bxp-design-system-react/icons/monochrome";

// Dummy data for demonstration
const DUMMY_EXPORT_PATHS: VolumeType[] = [
  {
    id: "ep-1",
    volumePath: "/mnt/data/production",
    protocol: "NFS",
    isValid: true,
    isDisabled: false,
    jobConfig: [],
  },
  {
    id: "ep-2",
    volumePath: "/mnt/data/development",
    protocol: "SMB",
    isValid: true,
    isDisabled: false,
    jobConfig: [],
  },
  {
    id: "ep-3",
    volumePath: "/mnt/data/archives",
    protocol: "NFS",
    isValid: true,
    isDisabled: false,
    jobConfig: [],
  },
  {
    id: "ep-4",
    volumePath: "/mnt/data/backup",
    protocol: "SMB",
    isValid: false,
    isDisabled: true,
    jobConfig: [],
  },
  {
    id: "ep-5",
    volumePath: "/mnt/data/shared",
    protocol: "NFS",
    isValid: true,
    isDisabled: false,
    jobConfig: [],
  },
];

const ExploreExportPaths = () => {
  const navigate = useNavigate();
  const { fileServerId } = useParams<{ fileServerId: string }>();
  // Use dummy data instead of API call
  const allExportPaths = DUMMY_EXPORT_PATHS;
  const isFetching = false;
  const fileServerDetails = { id: fileServerId, configName: "File Server - Demo" };
  
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  // Get zone name and fileServerId from query parameters (for Dell Isilon zones)
  const zoneNameParam = searchParams.get('zone');
  const zoneFileServerId = searchParams.get('fileServerId');

  // Build query string for navigation
  const queryString = useMemo(() => {
    if (zoneFileServerId && zoneNameParam) {
      return `?zone=${encodeURIComponent(zoneNameParam)}&fileServerId=${zoneFileServerId}`;
    }
    return '';
  }, [zoneFileServerId, zoneNameParam]);

  // Determine display name
  const displayName = useMemo(() => {
    if (zoneNameParam) {
      return decodeURIComponent(zoneNameParam);
    }
    return fileServerDetails?.configName;
  }, [fileServerDetails?.configName, zoneNameParam]);

  // Handle radio button selection
  const handlePathSelect = (pathId: string) => {
    setSelectedPath(pathId === selectedPath ? null : pathId);
  };

  // Handle explore button click
  const handleExploreClick = () => {
    if (selectedPath) {
      navigate(`/file-server/${fileServerDetails.id}/explore-directories/${selectedPath}${queryString}`);
    }
  };

  // Handle back navigation
  const handleBack = () => {
    navigate(`/file-server/${fileServerDetails.id}${queryString}`);
  };

  if (isFetching && allExportPaths.length === 0) {
    return (
      <Box className="p-8">
        <Box className="text-lg">Loading export paths...</Box>
      </Box>
    );
  }

  return (
    <Box className="p-8">
      {/* Header */}
      <Box className="flex justify-between items-center mb-6">
        <Box className="flex items-center gap-4">
          <Button
            variant="secondary"
            onClick={handleBack}
          >
            <ArrowBackIcon size="20" />
          </Button>
          <Box className="text-xl flex gap-3">
            <Box className="text-lg">Export Paths for:</Box>
            <Box className="text-lg font-semibold">{displayName}</Box>
          </Box>
        </Box>
      </Box>

      {/* Export Paths List */}
      {allExportPaths.length === 0 ? (
        <Box className="text-center py-8 text-gray-500">
          No export paths found for this file server.
        </Box>
      ) : (
        <Box className="bg-white rounded-lg shadow">
          {/* Table Header */}
          <Box className="grid grid-cols-12 gap-4 p-4 border-b bg-gray-50 font-semibold">
            <Box className="col-span-1 flex items-center">
              Select
            </Box>
            <Box className="col-span-6">Export Path</Box>
            <Box className="col-span-2">Protocol</Box>
            <Box className="col-span-3">Status</Box>
          </Box>

          {/* Table Body */}
          <Box className="divide-y">
            {allExportPaths.map((path) => {
              const isSelected = selectedPath === path.id;
              const isDisabled = path.isValid === false || path.isDisabled === true;
              
              return (
                <Box
                  key={path.id}
                  className={`grid grid-cols-12 gap-4 p-4 hover:bg-gray-50 transition-colors ${
                    isDisabled ? 'opacity-50' : ''
                  }`}
                >
                  <Box className="col-span-1 flex items-center">
                    <input
                      type="radio"
                      checked={isSelected}
                      onChange={() => handlePathSelect(path.id)}
                      disabled={isDisabled}
                      className="w-4 h-4 cursor-pointer"
                    />
                  </Box>
                  <Box className="col-span-6 flex items-center font-mono text-sm">
                    {path.volumePath}
                  </Box>
                  <Box className="col-span-2 flex items-center">
                    <Box className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-semibold uppercase">
                      {path.protocol}
                    </Box>
                  </Box>
                  <Box className="col-span-3 flex items-center">
                    {isDisabled ? (
                      <Box className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-semibold">
                        Disabled
                      </Box>
                    ) : (
                      <Box className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-semibold">
                        Active
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* Footer with Explore button */}
          <Box className="p-4 border-t bg-gray-50 flex justify-end">
            <Button
              disabled={!selectedPath}
              onClick={handleExploreClick}
            >
              Explore
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default ExploreExportPaths;
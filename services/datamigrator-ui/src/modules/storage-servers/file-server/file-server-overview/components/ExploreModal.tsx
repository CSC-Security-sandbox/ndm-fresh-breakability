import { useState, useMemo, useEffect, useCallback } from "react";
import { Box } from "@components/container/index";
import {
  Button,
  Modal,
  ModalHeader,
  ModalContent,
  ModalFooter,
} from "@netapp/bxp-design-system-react";
import { ArrowBackIcon, FolderIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { VolumeType } from "@/types/app.type";

// API base URL for jobs service
const JOBS_SERVICE_URL = window?.env?.VITE_JOBS_SERVICE_URL || import.meta.env.VITE_JOBS_SERVICE_URL;

// API Request DTO - matches backend GetDirsDto
interface GetDirsRequest {
  fileServerId: string;
  exportPath: string;
  path?: string;
  protocol?: string;
  hostname?: string;
  dir?: string;
  username?: string;
  password?: string;
  protocolVersion?: string;
}

// API Response - matches backend DirectoryEntry
interface DirectoryEntryResponse {
  name: string;
}

// Directory item interface for UI
interface DirectoryItem {
  id: string;
  name: string;
  path: string;
  type: "directory";
}

// Fetch directory contents from backend API
const fetchDirectoryContents = async (
  fileServerId: string,
  exportPath: string,
  currentPath: string
): Promise<DirectoryItem[]> => {
  const token = localStorage.getItem("token") || sessionStorage.getItem("token");
  
  // The API expects:
  // - exportPath: the NFS/SMB export path (e.g., "/nfs/smallEDA")
  // - path: the relative path within the export (e.g., "" for root, or "/subdir")
  const requestBody: GetDirsRequest = {
    fileServerId,
    exportPath,
    path: currentPath === "/" ? "" : currentPath,
  };

  // JOBS_SERVICE_URL already includes /api/v1, so we just append the endpoint
  const baseUrl = JOBS_SERVICE_URL?.endsWith('/api/v1') 
    ? JOBS_SERVICE_URL 
    : `${JOBS_SERVICE_URL}/api/v1`;
  
  const response = await fetch(`${baseUrl}/jobs/get-dirs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to fetch directories: ${response.status}`);
  }

  const result = await response.json();
  
  // Handle the API response structure: { data: { items: [...] } }
  // The items array contains objects with { name: string }
  let items: DirectoryEntryResponse[] = [];
  
  if (result?.data?.items && Array.isArray(result.data.items)) {
    items = result.data.items;
  } else if (result?.items && Array.isArray(result.items)) {
    items = result.items;
  } else if (Array.isArray(result?.data)) {
    items = result.data;
  } else if (Array.isArray(result)) {
    items = result;
  }

  if (!Array.isArray(items)) {
    console.error("Unexpected API response structure:", result);
    throw new Error("Unexpected response format from server");
  }

  // Transform API response to DirectoryItem format
  // The path is relative to the export path, not including the export path itself
  const directories: DirectoryItem[] = items.map((entry, index) => {
    const name = entry.name;
    // Build the relative path within the export path
    const relativePath = currentPath === "/" || currentPath === "" 
      ? `/${name}` 
      : `${currentPath}/${name}`;
    
    return {
      id: `dir-${index}-${name}`,
      name: name,
      path: relativePath, // This is the path relative to export path root
      type: "directory" as const,
    };
  });

  // Remove duplicates (in case API returns nested paths)
  const uniqueDirectories = directories.filter(
    (dir, index, self) => index === self.findIndex((d) => d.name === dir.name)
  );

  // Sort alphabetically, but put hidden files (starting with .) at the end
  uniqueDirectories.sort((a, b) => {
    const aHidden = a.name.startsWith(".");
    const bHidden = b.name.startsWith(".");
    if (aHidden && !bHidden) return 1;
    if (!aHidden && bHidden) return -1;
    return a.name.localeCompare(b.name);
  });

  return uniqueDirectories;
};

// Export Paths Content Component
interface ExportPathsContentProps {
  allExportPaths: VolumeType[];
  selectedExportPath: string | null;
  onPathSelect: (pathId: string) => void;
}

const ExportPathsContent = ({
  allExportPaths,
  selectedExportPath,
  onPathSelect,
}: ExportPathsContentProps) => {
  if (allExportPaths.length === 0) {
    return (
      <Box className="text-center py-8 text-gray-500">
        No export paths found for this file server.
      </Box>
    );
  }

  return (
    <Box className="bg-white rounded-lg">
      {/* Table Header */}
      <Box className="grid grid-cols-12 gap-4 p-4 border-b bg-gray-50 font-semibold">
        <Box className="col-span-1 flex items-center">Select</Box>
        <Box className="col-span-6">Export Path</Box>
        <Box className="col-span-2">Protocol</Box>
        <Box className="col-span-3">Status</Box>
      </Box>

      {/* Table Body */}
      <Box className="divide-y max-h-80 overflow-y-auto">
        {allExportPaths.map((path) => {
          const isSelected = selectedExportPath === path.id;
          // Only disable if explicitly set to disabled, not based on validation status
          // This allows exploration of paths that haven't been validated yet
          const isExplicitlyDisabled = path.isDisabled === true;
          // Determine the status for display
          const isValidated = path.isValid === true;
          const isInvalid = path.isValid === false && path.isDisabled !== true;

          return (
            <Box
              key={path.id}
              className={`grid grid-cols-12 gap-4 p-4 hover:bg-gray-50 transition-colors ${
                isExplicitlyDisabled ? "opacity-50" : ""
              }`}
            >
              <Box className="col-span-1 flex items-center">
                <input
                  type="radio"
                  checked={isSelected}
                  onChange={() => onPathSelect(path.id)}
                  disabled={isExplicitlyDisabled}
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
                {isExplicitlyDisabled ? (
                  <Box className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-semibold">
                    Disabled
                  </Box>
                ) : isValidated ? (
                  <Box className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-semibold">
                    Active
                  </Box>
                ) : isInvalid ? (
                  <Box className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-semibold">
                    Not Validated
                  </Box>
                ) : (
                  <Box className="px-2 py-1 bg-gray-100 text-gray-800 rounded text-xs font-semibold">
                    Pending
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

// Directories Content Component
interface DirectoriesContentProps {
  exportPath: VolumeType | undefined;
  currentPath: string;
  directoryContents: DirectoryItem[];
  isLoading: boolean;
  error: string | null;
  selectedItems: Set<string>;
  onItemToggle: (itemId: string) => void;
  onNavigateToFolder: (folderPath: string) => void;
  onPathChange: (path: string) => void;
  onBackToExportPaths: () => void;
  fileServerId: string;
}

const DirectoriesContent = ({
  exportPath,
  currentPath,
  directoryContents,
  isLoading,
  error,
  selectedItems,
  onItemToggle,
  onNavigateToFolder,
  onPathChange,
  onBackToExportPaths,
  fileServerId,
}: DirectoriesContentProps) => {
  // Search/Jump to path state
  const [searchPath, setSearchPath] = useState<string>(currentPath);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Sync search bar with current path when navigating via folder clicks or parent button
  useEffect(() => {
    setSearchPath(currentPath);
    setSearchError(null); // Clear any previous search errors when path changes
  }, [currentPath]);

  const handleParentClick = () => {
    const parentPath =
      currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
    onPathChange(parentPath);
  };

  const handleFolderClick = (item: DirectoryItem) => {
    if (item.type === "directory") {
      onNavigateToFolder(item.path);
    }
  };

  // Handle search/jump to path
  const handleJumpToPath = async () => {
    if (!searchPath.trim() || !exportPath || !fileServerId) {
      return;
    }

    // Normalize the path - ensure it starts with /
    let normalizedPath = searchPath.trim();
    if (!normalizedPath.startsWith("/")) {
      normalizedPath = "/" + normalizedPath;
    }
    // Remove trailing slash if present (except for root)
    if (normalizedPath !== "/" && normalizedPath.endsWith("/")) {
      normalizedPath = normalizedPath.slice(0, -1);
    }

    setIsValidating(true);
    setSearchError(null);

    try {
      // Validate the path by trying to fetch its contents
      await fetchDirectoryContents(
        fileServerId,
        exportPath.volumePath,
        normalizedPath
      );
      
      // If successful, navigate to that path
      onPathChange(normalizedPath);
      // Keep the path in search bar so user can see where they navigated
      setSearchPath(normalizedPath);
      setSearchError(null);
    } catch (err) {
      console.error("Path validation failed:", err);
      setSearchError(
        err instanceof Error 
          ? `Invalid path: ${err.message}` 
          : "Path not found or inaccessible"
      );
    } finally {
      setIsValidating(false);
    }
  };

  // Handle Enter key in search input
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isValidating) {
      handleJumpToPath();
    }
  };

  return (
    <>
      {/* Directory Header with Back Button */}
      <Box className="flex items-center gap-4 mb-4">
        <Button variant="secondary" onClick={onBackToExportPaths}>
          <ArrowBackIcon size="20" />
        </Button>
        <Box className="flex flex-col gap-1">
          <Box className="text-sm text-gray-600">
            Export Path:{" "}
            <span className="font-mono">{exportPath?.volumePath}</span>
          </Box>
        </Box>
      </Box>

      {/* Jump to Path Search Bar */}
      <Box className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
        <Box className="text-sm font-semibold text-gray-700 mb-2">
          Jump to Path
        </Box>
        <Box className="flex gap-2">
          <input
            type="text"
            value={searchPath}
            onChange={(e) => {
              setSearchPath(e.target.value);
              setSearchError(null); // Clear error when typing
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Enter path (e.g., /folder1/subfolder)"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={isValidating}
          />
          <Button
            onClick={handleJumpToPath}
            disabled={!searchPath.trim() || isValidating}
          >
            {isValidating ? "Validating..." : "Go"}
          </Button>
        </Box>
        {searchError && (
          <Box className="mt-2 text-sm text-red-600">
            {searchError}
          </Box>
        )}
        <Box className="mt-2 text-xs text-gray-500">
          Enter an absolute path relative to the export path to jump directly to that directory.
        </Box>
      </Box>

      {/* Current Path Display */}
      <Box className="mb-4 p-3 bg-gray-100 rounded-md">
        <Box className="text-sm font-semibold text-gray-700 mb-1">Export Path</Box>
        <Box className="font-mono text-sm text-gray-800 mb-2">
          {exportPath?.volumePath}
        </Box>
        <Box className="text-sm font-semibold text-gray-700 mb-1">Directory Path (relative to export)</Box>
        <Box className="font-mono text-sm text-gray-800">
          {currentPath === "/" || currentPath === "" ? "/" : currentPath}
        </Box>
      </Box>

      {/* Parent Directory Link */}
      {currentPath !== "/" && (
        <Box className="mb-4">
          <Button variant="secondary" onClick={handleParentClick}>
            ↑ Go to Parent Directory
          </Button>
        </Box>
      )}

      {/* Selected Items Count */}
      {selectedItems.size > 0 && (
        <Box className="mb-4 p-2 bg-blue-50 rounded-md text-sm text-blue-700">
          {selectedItems.size} item(s) selected
        </Box>
      )}

      {/* Error Display */}
      {error && (
        <Box className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </Box>
      )}

      {/* Directory Contents */}
      {isLoading ? (
        <Box className="text-center py-8 text-gray-500">
          Loading directory contents...
        </Box>
      ) : directoryContents.length === 0 && !error ? (
        <Box className="text-center py-8 text-gray-500">
          This directory is empty.
        </Box>
      ) : (
        <Box className="bg-white rounded-lg border">
          {/* Table Header */}
          <Box className="grid grid-cols-12 gap-4 p-4 border-b bg-gray-50 font-semibold">
            <Box className="col-span-1 flex items-center">
              Select
            </Box>
            <Box className="col-span-11">Name</Box>
          </Box>

          {/* Directory Items */}
          <Box className="max-h-64 overflow-y-auto">
            {directoryContents.map((item) => {
              const isSelected = selectedItems.has(item.id);
              const isDirectory = item.type === "directory";

              return (
                <Box
                  key={item.id}
                  className={`grid grid-cols-12 gap-4 p-4 border-b hover:bg-gray-50 transition-colors ${
                    isSelected ? "bg-blue-50" : ""
                  }`}
                >
                  {/* Checkbox */}
                  <Box className="col-span-1 flex items-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onItemToggle(item.id)}
                      className="w-4 h-4 cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Box>
                  
                  {/* Name - clickable for directories */}
                  <Box 
                    className={`col-span-11 flex items-center gap-2 ${
                      isDirectory ? "cursor-pointer" : ""
                    }`}
                    onClick={() => isDirectory && handleFolderClick(item)}
                  >
                    {isDirectory && (
                      <FolderIcon size="20" className="text-blue-500" />
                    )}
                    <Box
                      className={`${
                        isDirectory
                          ? "text-blue-600 font-medium hover:underline"
                          : "text-gray-900"
                      }`}
                    >
                      {item.name}
                    </Box>
                    {isDirectory && (
                      <Box className="text-xs text-gray-400 ml-2">
                        (click to open)
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </>
  );
};

// Selected item info for confirmation
export interface SelectedItemInfo {
  id: string;
  name: string;
  path: string;
  type: "directory" | "file";
}

// Props for the ExploreModal component
interface ExploreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: (selectedItems: SelectedItemInfo[], exportPath: VolumeType) => void;
  fileServerName: string;
  fileServerId: string;
  allExportPaths: VolumeType[];
}

// Main ExploreModal Component
const ExploreModal = ({
  isOpen,
  onClose,
  onConfirm,
  fileServerName,
  fileServerId,
  allExportPaths,
}: ExploreModalProps) => {
  // View state: "export-paths" or "directories"
  const [currentView, setCurrentView] = useState<"export-paths" | "directories">(
    "export-paths"
  );

  // Export paths selection state
  const [selectedExportPath, setSelectedExportPath] = useState<string | null>(
    null
  );

  // Directory exploration state
  const [currentPath, setCurrentPath] = useState<string>("/");
  const [directoryContents, setDirectoryContents] = useState<DirectoryItem[]>(
    []
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // Selected items (checkbox selection)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Get the selected export path details
  const selectedExportPathDetails = useMemo(() => {
    return allExportPaths.find((path) => path.id === selectedExportPath);
  }, [allExportPaths, selectedExportPath]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setCurrentView("export-paths");
      setSelectedExportPath(null);
      setCurrentPath("/");
      setDirectoryContents([]);
      setSelectedItems(new Set());
      setError(null);
    }
  }, [isOpen]);

  // Load directory contents when view changes to directories or path changes
  useEffect(() => {
    // Only fetch when in directories view with a selected export path
    if (currentView === "directories" && selectedExportPathDetails && fileServerId) {
      const fetchData = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const contents = await fetchDirectoryContents(
            fileServerId,
            selectedExportPathDetails.volumePath,
            currentPath
          );
          setDirectoryContents(contents);
        } catch (err) {
          console.error("Error loading directory contents:", err);
          setError(err instanceof Error ? err.message : "Failed to load directories");
          setDirectoryContents([]);
        } finally {
          setIsLoading(false);
        }
      };
      fetchData();
    }
  }, [currentView, selectedExportPathDetails?.id, currentPath, fileServerId]);

  // Handle export path selection
  const handlePathSelect = useCallback((pathId: string) => {
    setSelectedExportPath((prev) => (pathId === prev ? null : pathId));
  }, []);

  // Handle item toggle (checkbox selection)
  const handleItemToggle = useCallback((itemId: string) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  }, []);

  // Handle path change (navigating into a folder)
  const handlePathChange = useCallback((path: string) => {
    setCurrentPath(path);
    // Clear selection when navigating to a new folder
    setSelectedItems(new Set());
  }, []);

  // Handle navigating into a folder (click on folder name)
  const handleNavigateToFolder = useCallback((folderPath: string) => {
    setCurrentPath(folderPath);
    setSelectedItems(new Set());
  }, []);

  // Handle explore export path (switch to directories view)
  const handleExploreExportPath = useCallback(() => {
    if (selectedExportPath) {
      setCurrentView("directories");
      setCurrentPath("/");
    }
  }, [selectedExportPath]);

  // Handle back to export paths
  const handleBackToExportPaths = useCallback(() => {
    setCurrentView("export-paths");
    setCurrentPath("/");
    setDirectoryContents([]);
    setSelectedItems(new Set());
    setError(null);
  }, []);

  // Handle close modal
  const handleClose = useCallback(() => {
    setCurrentView("export-paths");
    setSelectedExportPath(null);
    setCurrentPath("/");
    setDirectoryContents([]);
    setSelectedItems(new Set());
    setError(null);
    onClose();
  }, [onClose]);

  // Handle confirm selection
  const handleConfirmSelection = useCallback(() => {
    if (selectedItems.size > 0 && selectedExportPathDetails && onConfirm) {
      const selectedItemsInfo: SelectedItemInfo[] = directoryContents
        .filter((item) => selectedItems.has(item.id))
        .map((item) => ({
          id: item.id,
          name: item.name,
          path: item.path,
          type: item.type,
        }));
      onConfirm(selectedItemsInfo, selectedExportPathDetails);
      handleClose();
    }
  }, [selectedItems, directoryContents, selectedExportPathDetails, onConfirm, handleClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      target={null}
      closeTrigger={handleClose}
      className=""
      style={{ width: "800px", maxWidth: "90vw" }}
      form={null}
      dataTestId="explore-modal"
    >
      <ModalHeader>
        {currentView === "export-paths"
          ? `Explore Export Paths - ${fileServerName}`
          : "Directory Explorer"}
      </ModalHeader>
      <ModalContent className="" style={{ maxHeight: "60vh", overflowY: "auto" }}>
        {currentView === "export-paths" ? (
          <ExportPathsContent
            allExportPaths={allExportPaths}
            selectedExportPath={selectedExportPath}
            onPathSelect={handlePathSelect}
          />
        ) : (
          <DirectoriesContent
            exportPath={selectedExportPathDetails}
            currentPath={currentPath}
            directoryContents={directoryContents}
            isLoading={isLoading}
            error={error}
            selectedItems={selectedItems}
            onItemToggle={handleItemToggle}
            onNavigateToFolder={handleNavigateToFolder}
            onPathChange={handlePathChange}
            onBackToExportPaths={handleBackToExportPaths}
            fileServerId={fileServerId}
          />
        )}
      </ModalContent>
      <ModalFooter>
        {currentView === "export-paths" ? (
          <Box className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              disabled={!selectedExportPath}
              onClick={handleExploreExportPath}
            >
              Explore
            </Button>
          </Box>
        ) : (
          <Box className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              disabled={selectedItems.size === 0}
              onClick={handleConfirmSelection}
            >
              Confirm Selection ({selectedItems.size})
            </Button>
          </Box>
        )}
      </ModalFooter>
    </Modal>
  );
};

// Custom hook for managing explore modal state
export const useExploreModal = () => {
  const [isOpen, setIsOpen] = useState(false);

  const openExploreModal = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeExploreModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    isOpen,
    openExploreModal,
    closeExploreModal,
  };
};

export default ExploreModal;

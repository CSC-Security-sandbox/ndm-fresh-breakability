import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSelector } from "react-redux";
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
import { RootStateType } from "@store/store";
import useSelectedProjectId from "@hooks/useSelectedProjectId";

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

// Helper function to find matching directory item using 3-tier matching:
// 1. Exact match
// 2. Case-insensitive match
// 3. Trimmed whitespace match
const findMatchingItem = (items: DirectoryItem[], target: string): DirectoryItem | undefined =>
  items.find((i) => i.name === target) ??
  items.find((i) => i.name.toLowerCase() === target.toLowerCase()) ??
  items.find((i) => i.name.trim() === target.trim());

// Fetch directory contents from backend API
const fetchDirectoryContents = async (
  fileServerId: string,
  exportPath: string,
  currentPath: string,
  token: string | null,
  projectId?: string
): Promise<DirectoryItem[]> => {
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
      ...(projectId ? { projectid: projectId } : {}),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `Failed to fetch directories: ${response.status}`);
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
    
    // Generate unique ID by including the path to avoid collisions across directories
    const pathForId = relativePath.replace(/\//g, '-').replace(/^-/, '');
    return {
      id: `dir-${pathForId}-${index}-${name}`,
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
  selectedDirectoryItem: DirectoryItem | null;
  onItemToggle: (item: DirectoryItem) => void;
  onNavigateToFolder: (folderPath: string) => void;
  onPathChange: (path: string) => void;
  /** Navigate to parent path and auto-select the target folder */
  onNavigateAndSelect: (parentPath: string, targetFolderName: string) => void;
  onBackToExportPaths: () => void;
  fileServerId: string;
  /** Auth token for API calls */
  token: string | null;
  /** Active project ID for RBAC authorization */
  projectId?: string;
  /** Whether to show the back button (hidden when skipExportPathsView is true) */
  showBackButton?: boolean;
}

const DirectoriesContent = ({
  exportPath,
  currentPath,
  directoryContents,
  isLoading,
  error,
  selectedDirectoryItem,
  onItemToggle,
  onNavigateToFolder,
  onPathChange,
  onNavigateAndSelect,
  onBackToExportPaths,
  fileServerId,
  token,
  projectId,
  showBackButton = true,
}: DirectoriesContentProps) => {
  // Search/Jump to path state - synced with current path navigation
  const [searchPath, setSearchPath] = useState<string>("");
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Sync searchPath with currentPath when currentPath changes
  useEffect(() => {
    setSearchPath(currentPath === "/" ? "" : currentPath);
  }, [currentPath]);

  // Get the selected item full path (uses stored item that persists across navigation)
  const selectedItemPath = useMemo(() => {
    if (!selectedDirectoryItem) return null;
    return selectedDirectoryItem.path;
  }, [selectedDirectoryItem]);

  // Note: searchError persists until a valid path is entered and Validate is clicked
  // This ensures users see the error message until they correct the path

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

  // Handle search/jump to path - navigates to parent directory and auto-selects the target folder
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

    // Extract parent path and target folder name
    const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf("/")) || "/";
    const targetFolderName = normalizedPath.substring(normalizedPath.lastIndexOf("/") + 1);

    // If user entered just "/" or empty, navigate to root
    if (!targetFolderName) {
      onPathChange("/");
      setSearchError(null);
      setIsValidating(false);
      return;
    }

    try {
      // Fetch the parent directory contents to verify the target folder exists
      const parentContents = await fetchDirectoryContents(
        fileServerId,
        exportPath.volumePath,
        parentPath,
        token,
        projectId
      );

      // Check if the target folder exists in parent directory
      // Use the same matching logic as auto-select (exact → case-insensitive → trim)
      const folderExists = findMatchingItem(parentContents, targetFolderName) !== undefined;

      if (!folderExists) {
        setSearchError(`Path not found: "${normalizedPath}" does not exist`);
        return;
      }

      // Navigate to parent directory and auto-select the target folder
      onNavigateAndSelect(parentPath, targetFolderName);
      setSearchError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      // Provide user-friendly error messages
      if (errorMessage.includes("404") || errorMessage.includes("not found")) {
        setSearchError(`Path not found: "${normalizedPath}" does not exist`);
      } else if (errorMessage.includes("403") || errorMessage.includes("permission")) {
        setSearchError(`Access denied: You don't have permission to access "${normalizedPath}"`);
      } else if (errorMessage.includes("timeout") || errorMessage.includes("network")) {
        setSearchError("Network error: Unable to reach the server. Please try again.");
      } else {
        setSearchError(`Invalid path: ${errorMessage}`);
      }
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
      {/* Directory Header with Back Button (hidden when skipExportPathsView is true) */}
      {showBackButton && (
        <Box className="flex items-center gap-4 mb-4">
          <Button variant="secondary" onClick={onBackToExportPaths}>
            <ArrowBackIcon size="20" />
          </Button>
        </Box>
      )}

      {/* Jump to Path Search Bar with Directory Path */}
      <Box className="mb-4 p-3 border border-blue-200 rounded-md bg-table-header-background">
        <Box className="text-sm font-semibold text-gray-700 mb-2">
          Search
        </Box>
        <Box className="flex gap-2">
          {/* Static Export Path Box */}
          <Box className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-sm font-mono text-gray-700 whitespace-nowrap">
            {exportPath?.volumePath}
          </Box>
          <input
            type="text"
            value={searchPath}
            onChange={(e) => {
              setSearchPath(e.target.value);
              // Error persists until Validate is clicked with a valid path
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
            {isValidating ? "Searching..." : "Search"}
          </Button>
        </Box>
        {searchError && (
          <Box className="mt-2 text-sm text-red-600">
            {searchError}
          </Box>
        )}
        <Box className="mt-2 text-xs text-gray-500">
          Enter a full path (e.g., /A/B/C) to navigate to the parent directory and auto-select the target folder.
        </Box>
      </Box>

      {/* Parent Directory Link */}
      <Box className="mb-4">
        <Button
          variant="secondary"
          onClick={handleParentClick}
          disabled={currentPath === "/"}
          className={`text-sm font-semibold ${currentPath === "/" ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          ↑ Go to Parent Directory
        </Button>
      </Box>

      {/* Currently Selected Indicator */}
      {selectedItemPath && (
        <Box className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <Box className="text-sm font-semibold text-gray-700">
            Currently Selected: <span className="font-mono text-blue-700">{selectedItemPath}</span>
          </Box>
        </Box>
      )}

      {/* Directory Contents */}
      <Box className="bg-white rounded-lg border min-h-[150px]">
        {isLoading ? (
          <Box className="flex items-center justify-center py-8 text-gray-500">
            <Box className="flex items-center gap-2">
              <Box className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span>Loading...</span>
            </Box>
          </Box>
        ) : searchError ? (
          <Box className="p-4">
            <Box className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
              <Box className="font-semibold mb-1">Path Not Found</Box>
              <Box className="text-sm">{searchError}</Box>
            </Box>
          </Box>
        ) : error ? (
          <Box className="p-4">
            <Box className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
              <Box className="font-semibold mb-1">Error Loading Directory</Box>
              <Box className="text-sm">{error}</Box>
            </Box>
          </Box>
        ) : directoryContents.length === 0 ? (
          <Box className="flex items-center justify-center py-8 text-gray-500">
            No sub-directories available at this level.
          </Box>
        ) : (
          /* Directory Items */
          <Box className="max-h-64 overflow-y-auto">
            {directoryContents.map((item) => {
              const isSelected = selectedDirectoryItem?.id === item.id;
              const isDirectory = item.type === "directory";

              return (
                <Box
                  key={item.id}
                  className={`grid grid-cols-12 gap-4 px-4 py-2 border-b hover:bg-gray-50 transition-colors ${
                    isSelected ? "bg-blue-50" : ""
                  }`}
                >
                  {/* Radio Button - Single Select with Toggle */}
                  <Box className="col-span-1 flex items-center">
                    <input
                      type="radio"
                      name="directory-selection"
                      checked={isSelected}
                      onChange={() => onItemToggle(item)}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Allow deselection by clicking an already selected radio button
                        if (isSelected) {
                          onItemToggle(item);
                        }
                      }}
                      className="w-4 h-4 cursor-pointer"
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
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
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
  /** Pre-selected export path ID - if provided, skips the export paths selection view */
  preSelectedExportPathId?: string;
  /** Initial selected directory path - used for pre-selection when editing */
  initialSelectedPath?: string;
  /** If true, skips the export paths view and goes directly to directory browsing */
  skipExportPathsView?: boolean;
}

// Main ExploreModal Component
const ExploreModal = ({
  isOpen,
  onClose,
  onConfirm,
  fileServerName,
  fileServerId,
  allExportPaths,
  preSelectedExportPathId,
  initialSelectedPath,
  skipExportPathsView = false,
}: ExploreModalProps) => {
  // Get auth token reactively from Redux store
  const token = useSelector((state: RootStateType) => state.authSlice?.accessToken);
  const { selectedProjectId: projectId } = useSelectedProjectId();

  // View state: "export-paths" or "directories"
  const [currentView, setCurrentView] = useState<"export-paths" | "directories">("export-paths");

  // Export paths selection state
  const [selectedExportPath, setSelectedExportPath] = useState<string | null>(null);

  // Directory exploration state
  const [currentPath, setCurrentPath] = useState<string>("/");
  const [directoryContents, setDirectoryContents] = useState<DirectoryItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // Store the selected directory item (persists across navigation)
  const [selectedDirectoryItem, setSelectedDirectoryItem] = useState<DirectoryItem | null>(null);
  
  // Track if initial selection has been applied (to avoid re-applying on every render)
  const [initialSelectionApplied, setInitialSelectionApplied] = useState<boolean>(false);

  // Get the selected export path details
  const selectedExportPathDetails = useMemo(() => {
    return allExportPaths.find((path) => path.id === selectedExportPath);
  }, [allExportPaths, selectedExportPath]);

  // Initialize state when modal opens
  useEffect(() => {
    if (isOpen) {
      const shouldSkipExportPaths = skipExportPathsView && preSelectedExportPathId;
      
      // Set export path
      setSelectedExportPath(preSelectedExportPathId || null);
      
      // Determine initial view
      if (shouldSkipExportPaths) {
        setCurrentView("directories");
        
        // If we have an initialSelectedPath, navigate to its parent directory
        if (initialSelectedPath && initialSelectedPath !== "/") {
          // Get parent directory path
          const parentPath = initialSelectedPath.substring(0, initialSelectedPath.lastIndexOf("/")) || "/";
          setCurrentPath(parentPath);
        } else {
          setCurrentPath("/");
        }
      } else {
        setCurrentView("export-paths");
        setCurrentPath("/");
      }
      
      // Reset other state
      setDirectoryContents([]);
      setSelectedDirectoryItem(null);
      setError(null);
      setInitialSelectionApplied(false);
      // Clear pending auto-select to avoid stale selections from previous modal session
      setPendingAutoSelect(null);
      pendingAutoSelectRef.current = null;
    }
  }, [isOpen, skipExportPathsView, preSelectedExportPathId, initialSelectedPath]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCurrentView("export-paths");
      setSelectedExportPath(null);
      setCurrentPath("/");
      setDirectoryContents([]);
      setSelectedDirectoryItem(null);
      setError(null);
      setInitialSelectionApplied(false);
      // Clear pending auto-select to avoid stale selections when modal reopens
      setPendingAutoSelect(null);
      pendingAutoSelectRef.current = null;
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
            currentPath,
            token,
            projectId
          );
          setDirectoryContents(contents);
          
          // Pre-select the initial path item if we have one and haven't applied it yet
          if (initialSelectedPath && !initialSelectionApplied) {
            // Extract the directory name from the initial path
            const targetName = initialSelectedPath.substring(initialSelectedPath.lastIndexOf("/") + 1);
            // Find the matching item in the loaded contents
            const matchingItem = contents.find((item) => item.name === targetName);
            if (matchingItem) {
              setSelectedDirectoryItem(matchingItem);
            }
            setInitialSelectionApplied(true);
          }
          
          // Auto-select pending folder from search/jump to path
          // This handles the case when user searches for a path like /A/B/C
          // We navigate to /A/B and auto-select C
          // Use ref to avoid closure issues
          const currentPendingAutoSelect = pendingAutoSelectRef.current;
          if (currentPendingAutoSelect) {
            const matchingItem = findMatchingItem(contents, currentPendingAutoSelect);
            
            if (matchingItem) {
              setSelectedDirectoryItem(matchingItem);
              // Clear pending auto-select after successful selection
              setPendingAutoSelect(null);
            }
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load directories");
          setDirectoryContents([]);
        } finally {
          setIsLoading(false);
        }
      };
      fetchData();
    }
  }, [currentView, selectedExportPathDetails?.id, currentPath, fileServerId, initialSelectedPath, initialSelectionApplied, token, projectId]);

  // Handle export path selection
  const handlePathSelect = useCallback((pathId: string) => {
    setSelectedExportPath((prev) => (pathId === prev ? null : pathId));
  }, []);

  // Handle item toggle (radio button selection - single select with toggle)
  const handleItemToggle = useCallback((item: DirectoryItem) => {
    // Toggle behavior: if already selected, deselect; otherwise select
    if (selectedDirectoryItem?.id === item.id) {
      setSelectedDirectoryItem(null); // Deselect
    } else {
      setSelectedDirectoryItem(item); // Select this one
    }
  }, [selectedDirectoryItem]);

  // Handle path change, persist currently selected path (navigating into a folder)
  const handlePathChange = useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

  // Handle navigating into a folder, persist currently selected path across navigation (click on folder name)
  const handleNavigateToFolder = useCallback((folderPath: string) => {
    setCurrentPath(folderPath);
  }, []);

  // State to track pending auto-selection after navigation
  const [pendingAutoSelect, setPendingAutoSelect] = useState<string | null>(null);
  // Ref to track pending auto-select to avoid closure issues in async functions
  const pendingAutoSelectRef = useRef<string | null>(null);
  
  // Sync ref with state
  useEffect(() => {
    pendingAutoSelectRef.current = pendingAutoSelect;
  }, [pendingAutoSelect]);

  // Handle navigate to parent path and auto-select target folder
  const handleNavigateAndSelect = useCallback((parentPath: string, targetFolderName: string) => {
    // Set the pending auto-select target
    setPendingAutoSelect(targetFolderName);
    // Navigate to parent path - the useEffect below will handle auto-selection
    setCurrentPath(parentPath);
  }, []);

  // Auto-select the pending folder when directory contents load
  useEffect(() => {
    if (pendingAutoSelect && directoryContents.length > 0) {
      const matchingItem = findMatchingItem(directoryContents, pendingAutoSelect);
      
      if (matchingItem) {
        setSelectedDirectoryItem(matchingItem);
        // Clear pending auto-select only after successful selection
        setPendingAutoSelect(null);
      } else {
        // Clear pending auto-select after a delay to allow for retry if contents update
        const timer = setTimeout(() => {
          setPendingAutoSelect(null);
        }, 1000);
        // Cleanup timeout if component unmounts or effect re-runs
        return () => clearTimeout(timer);
      }
    }
  }, [pendingAutoSelect, directoryContents]);

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
    setSelectedDirectoryItem(null);
    setError(null);
  }, []);

  // Handle close modal
  const handleClose = useCallback(() => {
    setCurrentView("export-paths");
    setSelectedExportPath(null);
    setCurrentPath("/");
    setDirectoryContents([]);
    setSelectedDirectoryItem(null);
    setError(null);
    // Clear pending auto-select when modal closes
    setPendingAutoSelect(null);
    pendingAutoSelectRef.current = null;
    onClose();
  }, [onClose]);

  // Handle confirm selection (uses persistent selected directory item)
  const handleConfirmSelection = useCallback(() => {
    if (selectedExportPathDetails && onConfirm && selectedDirectoryItem) {
      const selectedItemsInfo: SelectedItemInfo[] = [{
        id: selectedDirectoryItem.id,
        name: selectedDirectoryItem.name,
        path: selectedDirectoryItem.path,
        type: selectedDirectoryItem.type,
      }];
      onConfirm(selectedItemsInfo, selectedExportPathDetails);
      handleClose();
    }
  }, [selectedDirectoryItem, selectedExportPathDetails, onConfirm, handleClose]);

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
      <ModalContent className="pb-2" style={{ maxHeight: "60vh", overflowY: "auto" }}>
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
            selectedDirectoryItem={selectedDirectoryItem}
            onItemToggle={handleItemToggle}
            onNavigateToFolder={handleNavigateToFolder}
            onPathChange={handlePathChange}
            onNavigateAndSelect={handleNavigateAndSelect}
            onBackToExportPaths={handleBackToExportPaths}
            fileServerId={fileServerId}
            token={token}
            projectId={projectId}
            showBackButton={!skipExportPathsView}
          />
        )}
      </ModalContent>
      <ModalFooter>
        {currentView === "export-paths" ? (
          <Box className="flex justify-end gap-2">
            <Button onClick={handleClose}>
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
            <Button onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmSelection}
              disabled={isLoading || error !== null || !selectedDirectoryItem}
            >
              Confirm Selection
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
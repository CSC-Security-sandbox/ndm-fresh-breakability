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

// Directory item interface
interface DirectoryItem {
  id: string;
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number;
  modifiedDate?: string;
  children?: DirectoryItem[];
}

// Mock fetch function for directories - replace with actual API call
const mockFetchDirectoryContents = async (
  exportPathId: string,
  currentPath: string
): Promise<DirectoryItem[]> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (currentPath === "/") {
        resolve([
          {
            id: "dir-1",
            name: "Documents",
            path: "/Documents",
            type: "directory",
            modifiedDate: "2026-01-15",
          },
          {
            id: "dir-2",
            name: "Images",
            path: "/Images",
            type: "directory",
            modifiedDate: "2026-01-20",
          },
          {
            id: "dir-3",
            name: "Videos",
            path: "/Videos",
            type: "directory",
            modifiedDate: "2026-01-10",
          },
          {
            id: "dir-4",
            name: "Projects",
            path: "/Projects",
            type: "directory",
            modifiedDate: "2026-01-05",
          },
          {
            id: "dir-5",
            name: "Archive",
            path: "/Archive",
            type: "directory",
            modifiedDate: "2025-12-25",
          },
        ]);
      } else if (currentPath === "/Documents") {
        resolve([
          {
            id: "dir-doc-1",
            name: "Reports",
            path: "/Documents/Reports",
            type: "directory",
            modifiedDate: "2026-01-14",
          },
          {
            id: "dir-doc-2",
            name: "Presentations",
            path: "/Documents/Presentations",
            type: "directory",
            modifiedDate: "2026-01-12",
          },
          {
            id: "dir-doc-3",
            name: "Spreadsheets",
            path: "/Documents/Spreadsheets",
            type: "directory",
            modifiedDate: "2026-01-10",
          },
        ]);
      } else if (currentPath === "/Images") {
        resolve([
          {
            id: "dir-img-1",
            name: "Photos",
            path: "/Images/Photos",
            type: "directory",
            modifiedDate: "2026-01-18",
          },
          {
            id: "dir-img-2",
            name: "Graphics",
            path: "/Images/Graphics",
            type: "directory",
            modifiedDate: "2026-01-20",
          },
          {
            id: "dir-img-3",
            name: "Logos",
            path: "/Images/Logos",
            type: "directory",
            modifiedDate: "2026-01-19",
          },
        ]);
      } else if (currentPath === "/Projects") {
        resolve([
          {
            id: "dir-proj-1",
            name: "WebApp",
            path: "/Projects/WebApp",
            type: "directory",
            modifiedDate: "2026-01-05",
          },
          {
            id: "dir-proj-2",
            name: "MobileApp",
            path: "/Projects/MobileApp",
            type: "directory",
            modifiedDate: "2026-01-03",
          },
          {
            id: "dir-proj-3",
            name: "Backend",
            path: "/Projects/Backend",
            type: "directory",
            modifiedDate: "2026-01-04",
          },
        ]);
      } else {
        resolve([
          {
            id: "dir-sub-1",
            name: "Subfolder1",
            path: `${currentPath}/Subfolder1`,
            type: "directory",
            modifiedDate: "2026-01-01",
          },
          {
            id: "dir-sub-2",
            name: "Subfolder2",
            path: `${currentPath}/Subfolder2`,
            type: "directory",
            modifiedDate: "2026-01-02",
          },
        ]);
      }
    }, 300);
  });
};

// Dummy export paths data
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
          const isDisabled = path.isValid === false || path.isDisabled === true;

          return (
            <Box
              key={path.id}
              className={`grid grid-cols-12 gap-4 p-4 hover:bg-gray-50 transition-colors ${
                isDisabled ? "opacity-50" : ""
              }`}
            >
              <Box className="col-span-1 flex items-center">
                <input
                  type="radio"
                  checked={isSelected}
                  onChange={() => onPathSelect(path.id)}
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
    </Box>
  );
};

// Directories Content Component
interface DirectoriesContentProps {
  exportPath: VolumeType | undefined;
  currentPath: string;
  directoryContents: DirectoryItem[];
  isLoading: boolean;
  selectedItems: Set<string>;
  onItemToggle: (itemId: string) => void;
  onNavigateToFolder: (folderPath: string) => void;
  onPathChange: (path: string) => void;
  onBackToExportPaths: () => void;
}

const DirectoriesContent = ({
  exportPath,
  currentPath,
  directoryContents,
  isLoading,
  selectedItems,
  onItemToggle,
  onNavigateToFolder,
  onPathChange,
  onBackToExportPaths,
}: DirectoriesContentProps) => {
  const handleParentClick = () => {
    const parentPath =
      currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
    onPathChange(parentPath);
  };

  const handleFolderDoubleClick = (item: DirectoryItem) => {
    if (item.type === "directory") {
      onNavigateToFolder(item.path);
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

      {/* Current Path Display */}
      <Box className="mb-4 p-3 bg-gray-100 rounded-md">
        <Box className="text-sm font-semibold text-gray-700 mb-1">Current Path</Box>
        <Box className="font-mono text-sm text-gray-800">
          {exportPath?.volumePath}{currentPath === "/" ? "" : currentPath}
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

      {/* Directory Contents */}
      {isLoading ? (
        <Box className="text-center py-8 text-gray-500">
          Loading directory contents...
        </Box>
      ) : directoryContents.length === 0 ? (
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
                    onClick={() => isDirectory && handleFolderDoubleClick(item)}
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
  allExportPaths?: VolumeType[];
}

// Main ExploreModal Component
const ExploreModal = ({
  isOpen,
  onClose,
  onConfirm,
  fileServerName,
  fileServerId,
  allExportPaths = DUMMY_EXPORT_PATHS,
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
    }
  }, [isOpen]);

  // Load directory contents when path changes
  useEffect(() => {
    const loadDirectoryContents = async () => {
      if (currentView === "directories" && selectedExportPath) {
        setIsLoading(true);
        try {
          const contents = await mockFetchDirectoryContents(
            selectedExportPath,
            currentPath
          );
          setDirectoryContents(contents);
        } catch (error) {
          console.error("Error loading directory contents:", error);
        } finally {
          setIsLoading(false);
        }
      }
    };
    loadDirectoryContents();
  }, [currentView, selectedExportPath, currentPath]);

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
  }, []);

  // Handle close modal
  const handleClose = useCallback(() => {
    setCurrentView("export-paths");
    setSelectedExportPath(null);
    setCurrentPath("/");
    setDirectoryContents([]);
    setSelectedItems(new Set());
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
            selectedItems={selectedItems}
            onItemToggle={handleItemToggle}
            onNavigateToFolder={handleNavigateToFolder}
            onPathChange={handlePathChange}
            onBackToExportPaths={handleBackToExportPaths}
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

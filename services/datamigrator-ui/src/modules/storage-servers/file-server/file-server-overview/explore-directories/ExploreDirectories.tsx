import { useState, useMemo, useEffect } from "react";
import { Box } from "@components/container/index";
import useFileServerDetails from "@hooks/useFileServerDetails";
import { Button, Checkbox } from "@netapp/bxp-design-system-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowBackIcon, FolderIcon, FileIcon } from "@netapp/bxp-design-system-react/icons/monochrome";

// Mock directory structure - In production, this should come from API
interface DirectoryItem {
  id: string;
  name: string;
  path: string;
  type: 'directory' | 'file';
  size?: number;
  modifiedDate?: string;
  children?: DirectoryItem[];
}

// TODO: Replace with actual API call
const mockFetchDirectoryContents = async (exportPathId: string, currentPath: string): Promise<DirectoryItem[]> => {
  // This is mock data - replace with actual API call
  return new Promise((resolve) => {
    setTimeout(() => {
      // Different content based on current path
      if (currentPath === '/') {
        resolve([
          {
            id: 'dir-1',
            name: 'Documents',
            path: '/Documents',
            type: 'directory',
            modifiedDate: '2026-01-15',
          },
          {
            id: 'dir-2',
            name: 'Images',
            path: '/Images',
            type: 'directory',
            modifiedDate: '2026-01-20',
          },
          {
            id: 'dir-3',
            name: 'Videos',
            path: '/Videos',
            type: 'directory',
            modifiedDate: '2026-01-10',
          },
          {
            id: 'dir-4',
            name: 'Projects',
            path: '/Projects',
            type: 'directory',
            modifiedDate: '2026-01-05',
          },
          {
            id: 'dir-5',
            name: 'Archive',
            path: '/Archive',
            type: 'directory',
            modifiedDate: '2025-12-25',
          },
        ]);
      } else if (currentPath === '/Documents') {
        resolve([
          {
            id: 'dir-doc-1',
            name: 'Reports',
            path: '/Documents/Reports',
            type: 'directory',
            modifiedDate: '2026-01-14',
          },
          {
            id: 'dir-doc-2',
            name: 'Presentations',
            path: '/Documents/Presentations',
            type: 'directory',
            modifiedDate: '2026-01-12',
          },
          {
            id: 'dir-doc-3',
            name: 'Spreadsheets',
            path: '/Documents/Spreadsheets',
            type: 'directory',
            modifiedDate: '2026-01-10',
          },
        ]);
      } else if (currentPath === '/Images') {
        resolve([
          {
            id: 'dir-img-1',
            name: 'Photos',
            path: '/Images/Photos',
            type: 'directory',
            modifiedDate: '2026-01-18',
          },
          {
            id: 'dir-img-2',
            name: 'Graphics',
            path: '/Images/Graphics',
            type: 'directory',
            modifiedDate: '2026-01-20',
          },
          {
            id: 'dir-img-3',
            name: 'Logos',
            path: '/Images/Logos',
            type: 'directory',
            modifiedDate: '2026-01-19',
          },
        ]);
      } else if (currentPath === '/Projects') {
        resolve([
          {
            id: 'dir-proj-1',
            name: 'WebApp',
            path: '/Projects/WebApp',
            type: 'directory',
            modifiedDate: '2026-01-05',
          },
          {
            id: 'dir-proj-2',
            name: 'MobileApp',
            path: '/Projects/MobileApp',
            type: 'directory',
            modifiedDate: '2026-01-03',
          },
          {
            id: 'dir-proj-3',
            name: 'Backend',
            path: '/Projects/Backend',
            type: 'directory',
            modifiedDate: '2026-01-04',
          },
        ]);
      } else {
        // Default for any other path - show some subdirectories
        resolve([
          {
            id: 'dir-sub-1',
            name: 'Subfolder1',
            path: `${currentPath}/Subfolder1`,
            type: 'directory',
            modifiedDate: '2026-01-01',
          },
          {
            id: 'dir-sub-2',
            name: 'Subfolder2',
            path: `${currentPath}/Subfolder2`,
            type: 'directory',
            modifiedDate: '2026-01-02',
          },
        ]);
      }
    }, 300);
  });
};

const ExploreDirectories = () => {
  const navigate = useNavigate();
  const { fileServerId, exportPathId } = useParams<{ fileServerId: string; exportPathId: string }>();
  // Use dummy data instead of API call
  const fileServerDetails = { id: fileServerId, configName: "File Server - Demo" };
  const dummyExportPaths = [
    { id: "ep-1", volumePath: "/mnt/data/production", protocol: "NFS" },
    { id: "ep-2", volumePath: "/mnt/data/development", protocol: "SMB" },
    { id: "ep-3", volumePath: "/mnt/data/archives", protocol: "NFS" },
  ];
  const allExportPaths = dummyExportPaths;
  
  const [searchParams] = useSearchParams();
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('/');
  const [directoryContents, setDirectoryContents] = useState<DirectoryItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ name: string; path: string }>>([
    { name: 'Root', path: '/' }
  ]);

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

  // Find current export path
  const currentExportPath = useMemo(() => {
    return allExportPaths.find(path => path.id === exportPathId);
  }, [allExportPaths, exportPathId]);

  // Load directory contents
  useEffect(() => {
    const loadDirectoryContents = async () => {
      if (exportPathId) {
        setIsLoading(true);
        try {
          const contents = await mockFetchDirectoryContents(exportPathId, currentPath);
          setDirectoryContents(contents);
        } catch (error) {
          console.error('Error loading directory contents:', error);
        } finally {
          setIsLoading(false);
        }
      }
    };
    loadDirectoryContents();
  }, [exportPathId, currentPath]);

  // Handle checkbox toggle
  const handleItemToggle = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  // Handle folder radio selection
  const handleFolderSelect = (folderId: string) => {
    setSelectedFolder(folderId === selectedFolder ? null : folderId);
  };

  // Handle select all / deselect all
  const handleSelectAll = () => {
    if (selectedItems.size === directoryContents.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(directoryContents.map(item => item.id)));
    }
  };

  // Handle directory navigation
  const handleNavigateToDirectory = (item: DirectoryItem) => {
    if (item.type === 'directory') {
      const newPath = item.path;
      setCurrentPath(newPath);
      
      // Update breadcrumbs
      const pathParts = newPath.split('/').filter(Boolean);
      const newBreadcrumbs = [{ name: 'Root', path: '/' }];
      let currentBreadcrumbPath = '';
      pathParts.forEach(part => {
        currentBreadcrumbPath += `/${part}`;
        newBreadcrumbs.push({ name: part, path: currentBreadcrumbPath });
      });
      setBreadcrumbs(newBreadcrumbs);
      setSelectedFolder(null);
    }
  };

  // Handle explore selected folder
  const handleExploreFolder = () => {
    if (selectedFolder) {
      const folder = directoryContents.find(item => item.id === selectedFolder);
      if (folder && folder.type === 'directory') {
        handleNavigateToDirectory(folder);
      }
    }
  };

  // Handle breadcrumb navigation
  const handleBreadcrumbClick = (path: string) => {
    setCurrentPath(path);
    
    // Update breadcrumbs
    const pathParts = path === '/' ? [] : path.split('/').filter(Boolean);
    const newBreadcrumbs = [{ name: 'Root', path: '/' }];
    let currentBreadcrumbPath = '';
    pathParts.forEach(part => {
      currentBreadcrumbPath += `/${part}`;
      newBreadcrumbs.push({ name: part, path: currentBreadcrumbPath });
    });
    setBreadcrumbs(newBreadcrumbs);
    
    // Clear selections when navigating
    setSelectedItems(new Set());
  };

  // Handle back to export paths list
  const handleBackToExportPaths = () => {
    navigate(`/file-server/${fileServerId}/explore${queryString}`);
  };

  // Format file size
  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const allSelected = directoryContents.length > 0 && selectedItems.size === directoryContents.length;
  const someSelected = selectedItems.size > 0 && selectedItems.size < directoryContents.length;

  return (
    <Box className="p-8">
      {/* Header */}
      <Box className="flex justify-between items-center mb-6">
        <Box className="flex items-center gap-4">
          <Button
            variant="secondary"
            onClick={handleBackToExportPaths}
          >
            <ArrowBackIcon size="20" />
          </Button>
          <Box className="flex flex-col gap-1">
            <Box className="text-xl font-semibold">
              Directory Explorer
            </Box>
            <Box className="text-sm text-gray-600">
              Export Path: <span className="font-mono">{currentExportPath?.volumePath}</span>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Path Input */}
      <Box className="mb-4">
        <Box className="text-sm font-semibold text-gray-700 mb-2">Path</Box>
        <input
          type="text"
          value={currentPath}
          onChange={(e) => setCurrentPath(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter path..."
        />
      </Box>

      {/* Parent Directory Link */}
      {currentPath !== '/' && (
        <Box className="mb-4">
          <Button
            variant="primary"
            size="small"
            onClick={() => {
              const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
              handleBreadcrumbClick(parentPath);
            }}
          >
            Parent
          </Button>
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
        <Box className="bg-white rounded-lg shadow">
          {/* Table Header */}
          <Box className="grid grid-cols-12 gap-4 p-4 border-b bg-gray-50 font-semibold">
            <Box className="col-span-12">Name</Box>
          </Box>

          {/* Directory Items */}
          <Box>
            {directoryContents.map((item) => {
              const isSelected = selectedItems.has(item.id);
              const isFolderSelected = selectedFolder === item.id;
              const isDirectory = item.type === 'directory';
              
              return (
                <Box key={item.id}>
                  <Box
                    className={`grid grid-cols-12 gap-4 p-4 border-b hover:bg-gray-50 transition-colors ${
                      isDirectory ? 'cursor-pointer' : ''
                    } ${isFolderSelected ? 'bg-blue-50' : ''}`}
                    onClick={() => isDirectory && handleFolderSelect(item.id)}
                  >
                    <Box className="col-span-12 flex items-center justify-between">
                      <Box className="flex items-center gap-2">
                        {isDirectory ? (
                          <FolderIcon size="20" className="text-blue-500" />
                        ) : (
                          <FileIcon size="20" className="text-gray-500" />
                        )}
                        <Box className={`${isDirectory ? 'text-blue-600 font-medium' : 'text-gray-900'}`}>
                          {item.name}
                        </Box>
                      </Box>
                      {isFolderSelected && isDirectory && (
                        <Box className="flex gap-2">
                          <Button size="small" variant="primary" onClick={(e) => {
                            e.stopPropagation();
                            handleExploreFolder();
                          }}>
                            Explore
                          </Button>
                          <Button size="small" variant="primary" onClick={(e) => {
                            e.stopPropagation();
                            // Handle select action
                          }}>
                            Select
                          </Button>
                        </Box>
                      )}
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default ExploreDirectories;

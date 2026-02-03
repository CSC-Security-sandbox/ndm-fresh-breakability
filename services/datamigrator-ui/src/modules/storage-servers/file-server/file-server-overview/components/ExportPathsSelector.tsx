import { Box } from "@components/container/index";
import { VolumeType } from "@/types/app.type";

interface ExportPathsSelectorProps {
  allExportPaths: VolumeType[];
  selectedPath: string | null;
  onPathSelect: (pathId: string) => void;
}

const ExportPathsSelector = ({ allExportPaths, selectedPath, onPathSelect }: ExportPathsSelectorProps) => {
  if (!allExportPaths || allExportPaths.length === 0) {
    return null;
  }

  return (
    <Box className="my-4 bg-white rounded-lg shadow p-4">
      <Box className="text-sm font-semibold mb-3 text-gray-700">
        Select Export Path to Explore:
      </Box>
      <Box className="space-y-2">
        {allExportPaths.map((path) => {
          const isDisabled = path.isValid === false || path.isDisabled === true;
          const isSelected = selectedPath === path.id;
          
          return (
            <Box
              key={path.id}
              className={`flex items-center gap-3 p-3 rounded border transition-colors ${
                isSelected
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              } ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              onClick={() => !isDisabled && onPathSelect(path.id)}
            >
              <input
                type="radio"
                checked={isSelected}
                onChange={() => onPathSelect(path.id)}
                disabled={isDisabled}
                className="w-4 h-4 cursor-pointer"
              />
              <Box className="flex-1 flex items-center gap-3">
                <Box className="font-mono text-sm flex-1">{path.volumePath}</Box>
                <Box className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-semibold uppercase">
                  {path.protocol}
                </Box>
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

export default ExportPathsSelector;

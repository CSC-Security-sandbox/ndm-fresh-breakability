import { Box } from "@components/container/index";
import { Button, Text } from "@netapp/bxp-design-system-react";
import { useDispatch } from "react-redux";
import { setModalClose } from "@store/reducer/commonComponentSlice";
import { useState } from "react";

export interface AddSourceDirectoryPathModalProps {
  onSave: (path: string) => void;
  initialPath?: string;
  /** Modal title and field label when used for destination */
  fieldLabel?: string;
}

const AddSourceDirectoryPathModal = ({
  onSave,
  initialPath = "",
  fieldLabel = "Source Directory",
}: AddSourceDirectoryPathModalProps) => {
  const dispatch = useDispatch();
  const [path, setPath] = useState(initialPath);
  const [error, setError] = useState("");

  const handleSubmit = () => {
    const trimmed = path?.trim() ?? "";
    setError("");
    onSave(trimmed);
    dispatch(setModalClose());
  };

  const handleCancel = () => {
    dispatch(setModalClose());
  };

  return (
    <Box className="flex flex-col gap-4">
      <Box>
        <Text className="block mb-1">{fieldLabel}</Text>
        <input
          type="text"
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            if (error) setError("");
          }}
          placeholder="e.g. /export/vol1 or C:\share"
          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#0067c5] focus:outline-none focus:ring-1 focus:ring-[#0067c5]"
          aria-invalid={!!error}
        />
        {error && (
          <Text className="text-red-600 text-sm mt-1">{error}</Text>
        )}
      </Box>
      <Box className="flex justify-end gap-2 pt-2">
        <Button color="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button onClick={handleSubmit}>Submit</Button>
      </Box>
    </Box>
  );
};

export default AddSourceDirectoryPathModal;

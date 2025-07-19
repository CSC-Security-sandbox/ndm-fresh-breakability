import ListComponent from "@/components/list/ListComponent";
import { UploadFileDetailsPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";
import { useMemo } from "react";
import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification";
import { NoticeTriangleIcon } from "@netapp/bxp-style/react-icons/Notification";
import { Box } from "@/components/container";

const UploadFileDetails = ({
  exportPathSourceData,
}: UploadFileDetailsPropsType) => {
  if (!exportPathSourceData) return null;

  const { newPaths, alreadyExitingPaths, noLongerAvailablePaths } =
    exportPathSourceData;

  const listItems = useMemo(() => {
    return [
      {
        label: "New Paths",
        value: newPaths,
        children: <InfoIcon className="w-4" />,
      },
      {
        label: "Already Existing Paths",
        value: alreadyExitingPaths,
        children: <InfoIcon className="w-4" />,
      },
      {
        label: "Disabled Paths",
        value: noLongerAvailablePaths,
        children: <NoticeTriangleIcon className="w-4" color="warning" />,
        tooltip:
          "Any existing paths that were not part of uploaded path list will be considered disabled.",
      },
    ];
  }, [newPaths, alreadyExitingPaths, noLongerAvailablePaths]);

  return (
    <Box className="py-3">
      <ListComponent itemsList={listItems} />
    </Box>
  );
};

export default UploadFileDetails;

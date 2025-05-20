import { ConfigListTypeApiType } from "@/types/app.type";
import { calculateLastScanned } from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discover.utils";
import { Text } from "@netapp/bxp-design-system-react";
import { useEffect, useState } from "react";

const ReFreshExportPathsTime = ({
  fileServerDetails,
}: {
  fileServerDetails: ConfigListTypeApiType;
}) => {
  const [lastScannedText, setLastScannedText] = useState<string>("");

  useEffect(() => {
    const updateLastScannedText = () => {
      if (fileServerDetails?.scannedDate) {
        setLastScannedText(calculateLastScanned(fileServerDetails.scannedDate));
      }
    };
    updateLastScannedText();
    const intervalId = setInterval(updateLastScannedText, 1000);
    return () => clearInterval(intervalId);
  }, [fileServerDetails]);

  return <Text>{lastScannedText}</Text>;
};

export default ReFreshExportPathsTime;

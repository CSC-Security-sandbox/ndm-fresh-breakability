import React, { useEffect, useState } from "react";
import { Text } from "@netapp/bxp-design-system-react";
import { calculateLastScanned } from "../bulk-discover/bulk-discover.utils";
import { ConfigListTypeApiType } from "@/types/app.type";

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

import { Box } from "@components/container/index";
import { Popover } from "@netapp/bxp-design-system-react";
import PreCheckPathInfo from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/PreCheckPathInfo";
import { PreCheckAccordionTitlePropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/pre-check.types";

const PreCheckAccordionTitle = ({
  truncateSourcePath,
  sourcePath,
  truncateDestinationPath,
  destination,
  destinationPath,
  errorLabel,
}: PreCheckAccordionTitlePropsType) => (
  <Box className="flex flex-row gap-2 items-center">
    <Popover Trigger="error">Fail</Popover>
    <Box className="flex flex-col gap-1">
      <PreCheckPathInfo
        label="Source Path"
        truncatedPath={truncateSourcePath}
        fullPath={sourcePath}
      />
      <PreCheckPathInfo
        label="Destination Path"
        truncatedPath={truncateDestinationPath}
        destination={destination}
        fullPath={destinationPath}
      />
      <Box>{errorLabel}</Box>
    </Box>
  </Box>
);

export default PreCheckAccordionTitle;

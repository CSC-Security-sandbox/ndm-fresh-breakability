import { Box } from "@components/container/index";
import { Button, useWizard } from "@netapp/bxp-design-system-react";
import { useParams, useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";

import { ReactNode, useContext } from "react";
import BulkMigrateProceedButton from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/footer/BulkMigrateProceedButton";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";

const BulkMigrateFooter = ({ content }: { content?: ReactNode }) => {
  const { fileServerId } = useParams<{ fileServerId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentStepIndex, gotoPreviousStep } = useWizard();
  const { isFormSubmitting } = useContext(BulkMigrateContext);

  // Get zone query params for Dell Isilon - to preserve when navigating back
  const zoneNameParam = searchParams.get('zone');
  const zoneFileServerId = searchParams.get('fileServerId');

  const handleCancel = () => {
    // Build query string to preserve zone params for Dell Isilon
    const queryString = zoneFileServerId && zoneNameParam 
      ? `?zone=${encodeURIComponent(zoneNameParam)}&fileServerId=${zoneFileServerId}`
      : '';
    navigate(`/file-server/${fileServerId}${queryString}`);
  };

  return (
    <Box className="py-4 flex justify-center">
      <Box>{content}</Box>
      <Box className="flex justify-end gap-4">
        <Button
          color="secondary"
          onClick={gotoPreviousStep}
          disabled={currentStepIndex === 0 || isFormSubmitting}
          style={{ width: 152 }}
        >
          Back
        </Button>
        <Button
          color="secondary"
          onClick={handleCancel}
          style={{ width: 152 }}
          disabled={isFormSubmitting}
        >
          Cancel
        </Button>
        <BulkMigrateProceedButton />
      </Box>
    </Box>
  );
};

export default BulkMigrateFooter;

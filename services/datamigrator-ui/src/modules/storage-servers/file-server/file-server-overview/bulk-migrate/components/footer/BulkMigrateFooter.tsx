import { Box } from "@components/container/index";
import { Button, useWizard } from "@netapp/bxp-design-system-react";
import { ReactNode, useContext } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import BulkMigrateProceedButton from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/footer/BulkMigrateProceedButton";
import { BulkMigrateContext } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/context/BulkMigrateContextProvider";

const BulkMigrateFooter = ({ content }: { content?: ReactNode }) => {
  const navigate = useNavigate();
  const { fileServerId } = useParams<{ fileServerId: string }>();
  const [searchParams] = useSearchParams();
  const { currentStepIndex, gotoPreviousStep } = useWizard();
  const { isFormSubmitting } = useContext(BulkMigrateContext);

  const zoneNameParam = searchParams.get("zone");
  const zoneFileServerId = searchParams.get("fileServerId");
  const queryString =
    zoneFileServerId && zoneNameParam
      ? `?zone=${encodeURIComponent(zoneNameParam)}&fileServerId=${zoneFileServerId}`
      : "";

  const handleBack = () => {
    if (currentStepIndex === 0) {
      navigate(`/file-server/${fileServerId}${queryString}`);
    } else {
      gotoPreviousStep();
    }
  };

  const handleCancel = () => {
    navigate(`/file-server/${fileServerId}${queryString}`);
  };

  return (
    <Box className="py-4 flex justify-center">
      <Box>{content}</Box>
      <Box className="flex justify-end gap-4">
        <Button
          color="secondary"
          onClick={handleBack}
          disabled={isFormSubmitting || currentStepIndex === 0}
          style={{ width: 152 }}
        >
          Cancel
        </Button>
        <Button
          color="secondary"
          onClick={handleCancel}
          disabled={isFormSubmitting}
          style={{ width: 152 }}
        >
          Back
        </Button>
        <BulkMigrateProceedButton />
      </Box>
    </Box>
  );
};

export default BulkMigrateFooter;

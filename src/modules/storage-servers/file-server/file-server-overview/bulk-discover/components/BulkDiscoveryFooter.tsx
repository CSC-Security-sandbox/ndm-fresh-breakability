import { Box } from "@components/container/index";
import { Button } from "@netapp/bxp-design-system-react";
import { useNavigate } from "react-router-dom";
import { BulkDiscoveryFooterType } from "../bulk-discovery.interface";

const BulkDiscoveryFooter = ({
  bulkDiscoveryForm,
  selectedExportPathsIds,
  handleCreateBulkDiscovery,
  isSubmitting,
}: BulkDiscoveryFooterType) => {
  const navigate = useNavigate();

  return (
    <Box className="flex gap-3">
      <Button color="secondary" onClick={() => navigate(-1)}>
        Cancel
      </Button>
      <Button
        disabled={
          !bulkDiscoveryForm?.isValid || selectedExportPathsIds.length === 0
        }
        isSubmitting={isSubmitting}
        onClick={handleCreateBulkDiscovery}
      >
        Submit
      </Button>
    </Box>
  );
};

export default BulkDiscoveryFooter;

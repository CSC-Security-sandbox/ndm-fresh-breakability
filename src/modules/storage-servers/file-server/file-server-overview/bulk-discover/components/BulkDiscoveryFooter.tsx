import React from "react";
import { Button } from "@netapp/bxp-design-system-react";
import { Box } from "@components/container/index";
import { BulkDiscoveryFooterType } from "../bulk-discovery.interface";
import { useNavigate } from "react-router-dom";

const BulkDiscoveryFooter = ({
  bulkDiscoveryForm,
  selectedExportPathsIds,
  handleCreateBulkDiscovery,
  isSubmitting,
}: BulkDiscoveryFooterType) => {
  const navigate = useNavigate();

  return (
    <Box className="flex gap-3">
      <Button color="secondary" onClick={() => router.back()}>
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

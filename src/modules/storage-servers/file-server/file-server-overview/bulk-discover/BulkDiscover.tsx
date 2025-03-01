import { Box } from "@components/container/index";
import AppFooter from "@/components/layout/app-footer/AppFooter";
import { notify } from "@components/notification/NotificationWrapper";
import useFileServerDetails from "@hooks/useFileServerDetails";
import { useBulkDiscoveryMutation } from "@api/jobsApi";
import { BlueXpFormType } from "@/types/app.type";
import { INITIAL_VALUE_EXCLUDE_PATH_PATTERN } from "@/utils/constants";
import { Button, useForm } from "@netapp/bxp-design-system-react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import ExportPathsTable from "../components/ExportPathsTable";
import { BULK_DISCOVERY_FORM_SCHEMA } from "./bulk-discover.constant";
import { generateBulkDiscoveryPayload } from "./bulk-discover.utils";
import { bulkDiscoveryFormType } from "./bulk-discovery.interface";
import BulkDiscoveryFooter from "./components/BulkDiscoveryFooter";
import TopSection from "./components/TopSection";

dayjs.extend(utc);

const BulkDiscover = () => {
  const navigate = useNavigate();
  const [createBulkDiscoveryApi, { isLoading: isSubmitting }] =
    useBulkDiscoveryMutation();
  const { fileServerDetails, allExportPaths, getFileServerDetails } =
    useFileServerDetails();
  const [selectedExportPathsIds, setSelectedExportPathsIds] = useState<
    string[]
  >([]);

  const bulkDiscoveryForm: BlueXpFormType<bulkDiscoveryFormType> = useForm(
    {
      excludeFilePatterns: INITIAL_VALUE_EXCLUDE_PATH_PATTERN.replaceAll(
        ",",
        "\n"
      ),
      scheduleTime: "start_now",
      firstRunAt: dayjs.utc(),
    },
    BULK_DISCOVERY_FORM_SCHEMA
  );

  const handleCreateBulkDiscovery = async () => {
    try {
      const payload = generateBulkDiscoveryPayload(
        bulkDiscoveryForm,
        selectedExportPathsIds
      );
      await createBulkDiscoveryApi(payload).unwrap();
      navigate(`/config/file-server/${fileServerDetails?.id}`);
      const successMessage = (
        <>
          Bulk Discover Job has been created.
          <Button variant="text" onClick={() => navigate("/jobs/listing")}>
            View Job Listing
          </Button>
        </>
      );
      notify.success(successMessage, 15000);
    } catch (error) {
      notify.error("Something Went Wrong.");
      console.error("Error creating bulk discovery:", error);
    }
  };

  return (
    <Box className="flex flex-col gap-4">
      <Box className="p-8">
        <Box className="text-xl font-semibold mb-3">Bulk Discover</Box>
        <TopSection
          fileServerDetails={fileServerDetails}
          bulkDiscoveryForm={bulkDiscoveryForm}
        />
        <ExportPathsTable
          allExportPaths={allExportPaths}
          getFileServerDetails={getFileServerDetails}
          fileServerDetails={fileServerDetails}
          showRefetch={false}
          isRowSelectingEnabled={true}
          setSelectedExportPathsIds={setSelectedExportPathsIds}
        />
      </Box>
      <AppFooter
        footerContent={
          <BulkDiscoveryFooter
            bulkDiscoveryForm={bulkDiscoveryForm}
            selectedExportPathsIds={selectedExportPathsIds}
            handleCreateBulkDiscovery={handleCreateBulkDiscovery}
            isSubmitting={isSubmitting}
          />
        }
      />
    </Box>
  );
};

export default BulkDiscover;

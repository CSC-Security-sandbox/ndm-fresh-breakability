import { Box } from "@components/container/index";
import AppFooter from "@components/layout/app-footer/AppFooter";
import { notify } from "@components/notification/NotificationWrapper";
import useFileServerDetails from "@/hooks/useFileServerDetails";
import { useBulkDiscoveryMutation } from "@api/jobsApi";
import { BlueXpFormType, JOBS_TYPE, } from "@/types/app.type";
import { INITIAL_VALUE_EXCLUDE_PATH_PATTERN } from "@/utils/constants";
import {
  Button,
  Card,
  useForm,
  Text,
  FormFieldSelect,
} from "@netapp/bxp-design-system-react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import ExportPathsTable from "../components/ExportPathsTable";
import { BULK_DISCOVERY_FORM_SCHEMA } from "./bulk-discover.constant";
import { generateBulkDiscoveryPayload } from "./bulk-discover.utils";
import { bulkDiscoveryFormType } from "./bulk-discovery.interface";
import BulkDiscoveryFooter from "./components/BulkDiscoveryFooter";
import TopSection from "./components/TopSection";
import { getOptionsFromArray } from "@/utils/common.utils";
import { nanoid } from "@reduxjs/toolkit";

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
  const [key, setKey] = useState(nanoid());

  const options = useMemo(() => {
    return getOptionsFromArray(
      fileServerDetails?.fileServers?.map((data) => data.protocol) || [
        "NFS",
        "SMB",
      ]
    );
  }, [fileServerDetails?.fileServers?.length]);

  const defaultState = {
    excludeFilePatterns: INITIAL_VALUE_EXCLUDE_PATH_PATTERN.replaceAll(
      ",",
      "\n"
    ),
    scheduleTime: "start_now",
    firstRunAt: dayjs.utc(),
    protocol: options[0],
  };

  const bulkDiscoveryForm: BlueXpFormType<bulkDiscoveryFormType> = useForm(
    defaultState,
    BULK_DISCOVERY_FORM_SCHEMA
  );

  useEffect(() => {
    setSelectedExportPathsIds([]);
    setKey(nanoid());
  }, [bulkDiscoveryForm.formState.protocol.value]);

  const handleCreateBulkDiscovery = async () => {
    try {
      const payload = generateBulkDiscoveryPayload(
        bulkDiscoveryForm,
        selectedExportPathsIds
      );
      await createBulkDiscoveryApi(payload).unwrap();
      navigate(`/file-server/${fileServerDetails?.id}`);

      const configName = fileServerDetails?.configName;
      const successMessage = (
        <>
          Bulk Discover Job has been created.
          <Button variant="text" onClick={() => navigate(`/jobs-list?source=${configName}&type=${JOBS_TYPE.DISCOVERY}`)}>
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

  useEffect(() => {
    bulkDiscoveryForm.resetForm(defaultState);
  }, [options]);

  return (
    <Box className="flex flex-col gap-4">
      <Box className="p-8">
        <Box className="text-xl font-semibold mb-3">Bulk Discover</Box>
        <TopSection
          fileServerDetails={fileServerDetails}
          bulkDiscoveryForm={bulkDiscoveryForm}
        />
        <Card className="mt-8 p-6">
          <Box className="w-1/2 pr-6">
            <Text>Select Protocol </Text>
            <FormFieldSelect
              name="protocol"
              form={bulkDiscoveryForm}
              options={options}
              disabled={!fileServerDetails}
            />
          </Box>
        </Card>
        <ExportPathsTable
          allExportPaths={allExportPaths.filter(
            (row) => row.protocol === bulkDiscoveryForm.formState.protocol.value
          )}
          getFileServerDetails={getFileServerDetails}
          fileServerDetails={fileServerDetails}
          showRefetch={false}
          isRowSelectingEnabled={true}
          setSelectedExportPathsIds={setSelectedExportPathsIds}
          key={key}
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

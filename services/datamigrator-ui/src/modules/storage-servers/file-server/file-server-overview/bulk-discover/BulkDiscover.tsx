import useFileServerDetails from "@/hooks/useFileServerDetails";
import {
  BlueXpFormType,
  JOBS_TYPE,
  AllFileServerWithVolumesApiType,
} from "@/types/app.type";
import { getOptionsFromArray } from "@/utils/common.utils";
import { INITIAL_VALUE_EXCLUDE_PATH_PATTERN } from "@/constant/app.constants";
import {
  useBulkDiscoveryMutation,
  useLazyGetAllFileServersWithVolumeQuery,
} from "@api/jobsApi";
import { Box } from "@components/container/index";
import AppFooter from "@components/layout/app-footer/AppFooter";
import { notify } from "@components/notification/NotificationWrapper";
import {
  BULK_DISCOVERY_FORM_SCHEMA,
  DEFAULT_MINUTES_AHEAD,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discover.constant";
import { generateBulkDiscoveryPayload } from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discover.utils";
import { bulkDiscoveryFormType } from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/bulk-discovery.interface";
import BulkDiscoveryFooter from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/components/BulkDiscoveryFooter";
import TopSection from "@modules/storage-servers/file-server/file-server-overview/bulk-discover/components/TopSection";
import ExportPathsTable from "@modules/storage-servers/file-server/file-server-overview/components/ExportPathsTable";
import {
  Button,
  Card,
  FormFieldSelect,
  Text,
  useForm,
} from "@netapp/bxp-design-system-react";
import { nanoid } from "@reduxjs/toolkit";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BULK_DISCOVERY_DEFAULT_COLUMN_STATE } from "@modules/storage-servers/file-server/file-server-overview/fileServerId.constant";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { SCHEDULE_OPTIONS } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.constant";

dayjs.extend(utc);

const BulkDiscover = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Get zone query params for Dell Isilon - to preserve when navigating back
  const zoneNameParam = searchParams.get('zone');
  const zoneFileServerId = searchParams.get('fileServerId');
  
  const [createBulkDiscoveryApi, { isLoading: isSubmitting }] =
    useBulkDiscoveryMutation();
  const [getAllFileServersApi] = useLazyGetAllFileServersWithVolumeQuery();
  const { selectedProjectId: projectId } = useSelectedProjectId();
  const { fileServerDetails, allExportPaths, refetch, isFetching } =
    useFileServerDetails();
  const [selectedExportPathsIds, setSelectedExportPathsIds] = useState<
    string[]
  >([]);
  const [key, setKey] = useState(nanoid());
  const [notReachableExportPaths, setNotReachableExportPaths] = useState<
    string[]
  >([]);
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

  // Update firstRunAt based on scheduleTime
  useEffect(() => {
    const { scheduleTime } = bulkDiscoveryForm?.formState ?? {};
    const isScheduledLater = scheduleTime !== SCHEDULE_OPTIONS.START_NOW;

    const offsetMinutes = isScheduledLater
      ? DEFAULT_MINUTES_AHEAD.SCHEDULE_DATE
      : DEFAULT_MINUTES_AHEAD.START_NOW;

    const firstRunAt = dayjs.utc().add(offsetMinutes, "minute");

    bulkDiscoveryForm.resetForm({
      ...bulkDiscoveryForm?.formState,
      firstRunAt,
    });
  }, [bulkDiscoveryForm?.formState?.scheduleTime]);

  useEffect(() => {
    setSelectedExportPathsIds([]);
    setKey(nanoid());
  }, [bulkDiscoveryForm.formState.protocol.value]);

  useEffect(() => {
    const fetchFileServers = async () => {
      try {
        const resp = await getAllFileServersApi({ projectId }).unwrap();
        const allFileServers: AllFileServerWithVolumesApiType[] = resp?.configs;
        let notReachableExportPaths = [];
        allFileServers.forEach((config) => {
          config?.fileServers?.flatMap((fileServer) =>
            fileServer?.volumes?.map((volume) => {
              if (volume?.reachableCount === 0) {
                notReachableExportPaths.push(volume.id);
              }
            })
          );
        });
        setNotReachableExportPaths(notReachableExportPaths);
      } catch (error) {
        console.error("Error fetching file servers:", error);
      }
    };
    fetchFileServers();
  }, [projectId, getAllFileServersApi]);

  const handleCreateBulkDiscovery = async () => {
    try {
      const payload = generateBulkDiscoveryPayload(
        bulkDiscoveryForm,
        selectedExportPathsIds
      );
      await createBulkDiscoveryApi(payload).unwrap();
      
      // Build query string to preserve zone params for Dell Isilon
      const queryString = zoneFileServerId && zoneNameParam 
        ? `?zone=${encodeURIComponent(zoneNameParam)}&fileServerId=${zoneFileServerId}`
        : '';
      navigate(`/file-server/${fileServerDetails?.id}${queryString}`);

      const configName = fileServerDetails?.configName;
      const successMessage = (
        <>
          Bulk Discover Job has been created.
          <Button
            variant="text"
            onClick={() =>
              navigate(
                `/jobs-list?source=${configName}&type=${JOBS_TYPE.DISCOVERY}`
              )
            }
          >
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
    <Box className="flex flex-col gap-4 h-[80vh] overflow-y-auto">
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
        <Box className="mb-4">
          <ExportPathsTable
            jobType="bulk_discover"
            defaultColumnState={BULK_DISCOVERY_DEFAULT_COLUMN_STATE}
            allExportPaths={allExportPaths.filter(
              (row) =>
                row.protocol === bulkDiscoveryForm.formState.protocol.value &&
                row.isValid
            )}
            fileServerDetails={fileServerDetails}
            showRefetch={false}
            isRowSelectingEnabled={true}
            setSelectedExportPathsIds={setSelectedExportPathsIds}
            key={key}
            notReachableExportPaths={notReachableExportPaths}
            refetch={refetch}
            isFetching={isFetching}
          />
        </Box>
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

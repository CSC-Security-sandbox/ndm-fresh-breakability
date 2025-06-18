import {
  BlueXpFormType,
  GetAllWorkersApiType,
  ProtocolType,
  ValidateConnectionApiType,
  ValidateConnectionStatus,
  WorkerConnectionStatus,
} from "@/types/app.type";
import {
  useLazyCheckConnectionRespQuery,
  useValidateConnectionMutation,
} from "@api/workerManagerApi";
import { useLazyGetAllWorkersQuery } from "@api/workersApi";
import { notify } from "@components/notification/NotificationWrapper";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { createValidateConnectionPayload } from "@modules/storage-servers/file-server/components/add-file-server.util";
import {
  HOST_CREDENTIALS_VALIDATION_SCHEMA,
  INITIAL_VALUE_JOB_CONFIG,
  INITIAL_VALUE_NFS_CREDENTIALS_FORM,
  INITIAL_VALUE_SERVER_TYPE_FORM,
  INITIAL_VALUE_SERVICE_AND_PROTOCOL_FORM,
  INITIAL_VALUE_SMB_CREDENTIALS_FORM,
  NFS_CREDENTIALS_VALIDATION_SCHEMA,
  SERVICE_AND_PROTOCOL_VALIDATION_SCHEMA,
  SMB_CREDENTIALS_VALIDATION_SCHEMA,
  VALIDATE_CONNECTION_COLUMN_DEF,
} from "@modules/storage-servers/file-server/components/file-server.constant";
import {
  ErroredWorkersDetailsType,
  MountPathsOptionsListType,
  WorkerIdWithNameType,
  jobConfigFormFormType,
} from "@modules/storage-servers/file-server/fileServer.interface";
import { useForm } from "@netapp/bxp-design-system-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MAX_RETRY_API_ATTEMPTS } from "@/utils/constants";

export const useFileServerForm = () => {
  const interval = useRef<any | undefined>("");
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const { fileServerId } = useParams<{ fileServerId: string }>();
  const [isJobRunning, setIsJobRunning] = useState<boolean>(false);
  const { selectedProjectId } = useSelectedProjectId();
  // State management
  const [allWorkersList, setAllWorkersList] = useState<GetAllWorkersApiType[]>(
    []
  );

  // FOR WORKERS SCREEN
  const [workerIdWithName, setWorkerIdWithName] =
    useState<WorkerIdWithNameType>({});
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [nfsValidatedWorkersIds, setNfsValidatedWorkersIds] = useState<
    string[]
  >([]);
  const [smbValidatedWorkersIds, setSmbValidatedWorkersIds] = useState<
    string[]
  >([]);

  const [nfsFailedWorkersIds, setNfsFailedWorkersIds] = useState<string[]>([]);
  const [smbFailedWorkersIds, setSmbFailedWorkersIds] = useState<string[]>([]);

  const [validateConnectionLoader, setValidateConnectionLoader] =
    useState(false);
  const [activeWorkerIds, setActiveWorkerIds] = useState<string[]>([]);
  const [inactiveWorkerIds, setInactiveWorkerIds] = useState<string[]>([]);
  const [validateConnectionResults, setValidateConnectionResults] =
    useState<ValidateConnectionApiType>({} as ValidateConnectionApiType);
  const [disableNextButton, setDisableNextButton] = useState<boolean>(false);
  const [errorMessageList, setErrorMessageList] = useState<
    ErroredWorkersDetailsType[]
  >([]);

  // WORKING DIR SCREEN
  const [mountPaths, setMountPaths] = useState<MountPathsOptionsListType[]>([]);

  // API
  const [getAllWorkers, { isFetching }] = useLazyGetAllWorkersQuery();
  const [validateConnectionMutationApi] = useValidateConnectionMutation();
  const [checkConnectionRespApi] = useLazyCheckConnectionRespQuery();

  const fetchWorkers = async () => {
    await getAllWorkers(`?projectId=${selectedProjectId}`)
      .unwrap()
      .then((resp) => {
        const allWorkersWithNameAndId: WorkerIdWithNameType = {};
        resp?.forEach((worker: GetAllWorkersApiType) => {
          allWorkersWithNameAndId[worker.workerId] = worker.workerName;
        });
        setWorkerIdWithName(allWorkersWithNameAndId);
        setAllWorkersList(resp);
      })
      .catch((error: any) => {
        console.error({
          level:
            "Unable to fetch workers for the selected project in file server form",
          error,
        });
      });
  };

  // API TO GET ALL WORKERS
  useEffect(() => {
    fetchWorkers();
    return () => {
      if (interval.current) {
        clearInterval(interval.current);
      }
    };
  }, [selectedProjectId]);

  // Initialize forms
  const serverTypeForm: BlueXpFormType<
    typeof INITIAL_VALUE_SERVICE_AND_PROTOCOL_FORM
  > = useForm(
    INITIAL_VALUE_SERVICE_AND_PROTOCOL_FORM,
    SERVICE_AND_PROTOCOL_VALIDATION_SCHEMA
  );

  const hostCredentialsForm: BlueXpFormType<
    typeof INITIAL_VALUE_SERVER_TYPE_FORM
  > = useForm(
    INITIAL_VALUE_SERVER_TYPE_FORM,
    HOST_CREDENTIALS_VALIDATION_SCHEMA
  );

  const nfsCredentialsForm: BlueXpFormType<
    typeof INITIAL_VALUE_NFS_CREDENTIALS_FORM
  > = useForm(
    INITIAL_VALUE_NFS_CREDENTIALS_FORM,
    NFS_CREDENTIALS_VALIDATION_SCHEMA
  );

  const smbCredentialsForm: BlueXpFormType<
    typeof INITIAL_VALUE_SMB_CREDENTIALS_FORM
  > = useForm(
    INITIAL_VALUE_SMB_CREDENTIALS_FORM,
    SMB_CREDENTIALS_VALIDATION_SCHEMA
  );

  const jobConfigForm: BlueXpFormType<jobConfigFormFormType> = useForm(
    INITIAL_VALUE_JOB_CONFIG
  );

  const workersListTableStateProps: any = {
    columns: VALIDATE_CONNECTION_COLUMN_DEF,
    rows: allWorkersList,
    isSorting: true,
    pageSize: 10,
  };

  const showErrorOnFailure = (error: Error) => {
    setValidateConnectionLoader(false);
    if (interval.current) {
      clearInterval(interval.current);
    }

    notify.error(
      `Failed to perform validaton, reason - ${error?.message || "unknown."}`
    );
    console.error({ level: "File Server - Validate connection.", error });
  };

  const handleValidateConnection = async () => {
    let retryCount = 0;
    if (selectedWorkerIds.length === 0) return [];

    setValidateConnectionLoader(true);
    setActiveWorkerIds([]);
    setDisableNextButton(true);

    const payload = createValidateConnectionPayload(
      selectedWorkerIds,
      nfsCredentialsForm,
      smbCredentialsForm,
      hostCredentialsForm
    );

    try {
      const resp = await validateConnectionMutationApi(payload).unwrap();
      console.log('before return Promisrrrrr', resp)

      return new Promise((resolve) => {
        interval.current = setInterval(async () => {
          console.log('>SDADASDASDASDASDASDASDASDASDSADASDSADAS',await checkConnectionRespApi({
            id: resp?.data?.items?.workflowId,
          }));
          const data = await checkConnectionRespApi({
            id: resp?.data?.items?.workflowId,
          }).unwrap();
          console.log('inside the Ptomise USer File Server', data )
          if (data?.status === ValidateConnectionStatus.COMPLETED) {
            const errorMessageList = await handleConnectionValidationComplete(
              data
            );
            if (interval.current) {
              clearInterval(interval.current);
            }
            resolve({ errorMessageList });
            setDisableNextButton(false);
          } else if (data?.status === ValidateConnectionStatus.TERMINATED) {
            const error = new Error(
              "Request got terminated, please try again."
            );
            showErrorOnFailure(error);
          } else if (++retryCount === MAX_RETRY_API_ATTEMPTS) {
            let message = "Worker(s) are not responding.";
            try {
              const incompleteWorkers = data?.status?.data.filter(
                (item: { status: string }) => item.status !== "COMPLETED"
              );
              const workerNames = incompleteWorkers.map(
                (item: { workerId: string }) =>
                  workerIdWithName[item.workerId] || item.workerId
              );
              message = `Worker is not responding, Validation for workers ${workerNames.join(
                ", "
              )} took too long`;
            } catch (error: any) {
              console.error({
                level:
                  "File Server validation - Worker taking too long to respond, and failed to create list of workers",
                error,
              });
            }

            const error = new Error(message);
            showErrorOnFailure(error);
          }
        }, 50000);
      });
    } catch (error: any) {
      showErrorOnFailure(error);
    }
  };

  const handleConnectionValidationComplete = async (
    status: ValidateConnectionApiType
  ) => {
    setErrorMessageList([]);
    setValidateConnectionLoader(false);
    setValidateConnectionResults(status);

    const nfsValidatedWorkers: string[] = [];
    const smbValidatedWorkers: string[] = [];
    const nfsFailedWorkers: string[] = [];
    const smbFailedWorkers: string[] = [];
    const newErrorMessageList: ErroredWorkersDetailsType[] = [];

    status.completed.forEach((row:any) => {

      if (row?.status === WorkerConnectionStatus.SUCCESS) {
        const rowData= row?.data;
        if (rowData?.protocolType === ProtocolType.NFS)
          nfsValidatedWorkers.push(rowData?.workerId);
        else if (rowData?.protocolType === ProtocolType.SMB)
          smbValidatedWorkers.push(rowData?.workerId);
      } else if (row?.status === WorkerConnectionStatus.ERROR) {
        const errorDetails= row?.error;
        console.log('row>>>>>>>>>>>>>>>', errorDetails)
        newErrorMessageList.push({
          errorMessage: errorDetails?.displayMessage || "Unknown-Error",
          workerId: errorDetails?.details.workerId,
          workerName: workerIdWithName?.[errorDetails?.details?.workerId] || "workerName ",
        });
        if (errorDetails?.details?.protocolType === ProtocolType.NFS)
          nfsFailedWorkers.push(errorDetails?.details?.workerId);
        else if (errorDetails?.details?.protocolType === ProtocolType.SMB)
          smbFailedWorkers.push(errorDetails?.details?.workerId);
      }
    });
    setErrorMessageList(newErrorMessageList);
    setNfsValidatedWorkersIds(nfsValidatedWorkers);
    setSmbValidatedWorkersIds(smbValidatedWorkers);
    setNfsFailedWorkersIds(nfsFailedWorkers);
    setSmbFailedWorkersIds(smbFailedWorkers);

    return newErrorMessageList;
  };

  return {
    // DYNAMIC PARAMS
    fileServerId,

    // FORMS STATE
    isEditMode,
    serverTypeForm,
    hostCredentialsForm,
    nfsCredentialsForm,
    smbCredentialsForm,
    workersListTableStateProps,
    isFetching,
    refetch: fetchWorkers,
    jobConfigForm,
    // LOCAL STATE
    workerIdWithName,
    selectedWorkerIds,
    nfsValidatedWorkersIds,
    smbValidatedWorkersIds,

    validateConnectionLoader,
    activeWorkerIds,
    inactiveWorkerIds,
    validateConnectionResults,
    disableNextButton,
    errorMessageList,
    allWorkersList,
    nfsFailedWorkersIds,
    setNfsFailedWorkersIds,
    smbFailedWorkersIds,
    setSmbFailedWorkersIds,
    mountPaths,
    setMountPaths,
    isJobRunning,
    setIsJobRunning,
    // STATE SETTERS
    setWorkerIdWithName,
    setIsEditMode,
    setAllWorkersList,
    setNfsValidatedWorkersIds,
    setSmbValidatedWorkersIds,
    setSelectedWorkerIds,
    setValidateConnectionLoader,
    setActiveWorkerIds,
    setInactiveWorkerIds,
    setValidateConnectionResults,
    setDisableNextButton,
    setErrorMessageList,
    handleValidateConnection,
  };
};

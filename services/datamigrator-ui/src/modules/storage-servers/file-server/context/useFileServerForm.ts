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
import { useFetchCertificateMutation } from "@api/configApi";
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
  INITIAL_VALUE_MANAGEMENT_CONSOLE_FORM,
  MANAGEMENT_CONSOLE_VALIDATION_SCHEMA,
  NFS_CREDENTIALS_VALIDATION_SCHEMA,
  SERVICE_AND_PROTOCOL_VALIDATION_SCHEMA,
  SMB_CREDENTIALS_VALIDATION_SCHEMA,
  VALIDATE_CONNECTION_COLUMN_DEF,
} from "@modules/storage-servers/file-server/components/file-server.constant";
import {
  CertificateResponseType,
  ErroredWorkersDetailsType,
  ManagementConsoleFormType,
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
  const [selectedProtocol, setSelectedProtocol] = useState<'NFS' | 'SMB'>('NFS');
  const [originalProtocol, setOriginalProtocol] = useState<'NFS' | 'SMB' | null>(null);
  
  const [originalNfsWorkers, setOriginalNfsWorkers] = useState<string[]>([]);
  const [originalSmbWorkers, setOriginalSmbWorkers] = useState<string[]>([]);
  
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

  // DELL ISILON CERTIFICATE STATE
  const [certificateData, setCertificateData] = useState<CertificateResponseType | null>(null);
  const [showCertificateView, setShowCertificateView] = useState<boolean>(false);
  const [certificateAccepted, setCertificateAccepted] = useState<boolean>(false);
  const [fetchingCertificate, setFetchingCertificate] = useState<boolean>(false);
  const [certificateError, setCertificateError] = useState<string | null>(null);

  // DELL ISILON ACCESS ZONES STATE
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [zoneCredentials, setZoneCredentials] = useState<Record<string, any>>({});
  const [zoneWorkerAssignments, setZoneWorkerAssignments] = useState<Record<string, { nfs: string[]; smb: string[] }>>({});
  // Track currently active zone in the worker assignment sidebar (for Dell Isilon)
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  // Track zones fetch error (prevents navigation in edit mode)
  const [zonesError, setZonesError] = useState<string | null>(null);

  // API
  const [getAllWorkers, { isFetching }] = useLazyGetAllWorkersQuery();
  const [validateConnectionMutationApi] = useValidateConnectionMutation();
  const [checkConnectionRespApi] = useLazyCheckConnectionRespQuery();
  const [fetchCertificateApi] = useFetchCertificateMutation();

  const fetchWorkers = async () => {
    await getAllWorkers(`?projectId=${selectedProjectId}`)
      .unwrap()
      .then((resp) => {
        const allWorkersWithNameAndId: WorkerIdWithNameType = {};
        resp?.forEach((worker: GetAllWorkersApiType) => {
          allWorkersWithNameAndId[worker.workerId] = worker.workerName;
        });
        setWorkerIdWithName(allWorkersWithNameAndId);
        
        // Store all workers - filtering is done in components based on context
        // For Other NAS: ValidateConnection filters by selectedProtocol
        // For Dell Isilon: ValidateConnection filters per-zone based on configured protocols
        setAllWorkersList(resp || []);
      })
      .catch((error: any) => {
        console.error({
          level:
            "Unable to fetch workers for the selected project in file server form",
          error,
        });
      });
  };

  const handleProtocolChangeForEdit = (newProtocol: 'NFS' | 'SMB') => {
    if (!isEditMode || !originalProtocol) return;

    if (newProtocol === originalProtocol) {
      if (newProtocol === 'NFS') {
        setSelectedWorkerIds(originalNfsWorkers);
      } else if (newProtocol === 'SMB') {
        setSelectedWorkerIds(originalSmbWorkers);
      }
    } else {
      setSelectedWorkerIds([]);
    }
  };

  // Re-fetch workers when protocol changes
  useEffect(() => {
    if (selectedProjectId && selectedProtocol) {
      fetchWorkers();
      
      if (isEditMode) {
        // Handle protocol change for edit mode
        handleProtocolChangeForEdit(selectedProtocol);
      } else {
        // For add mode, always clear workers on protocol change
        setSelectedWorkerIds([]);
      }
    }
  }, [selectedProjectId, selectedProtocol]);

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

  // Dell Isilon Management Console Form
  const managementConsoleForm: BlueXpFormType<ManagementConsoleFormType> = useForm(
    INITIAL_VALUE_MANAGEMENT_CONSOLE_FORM,
    MANAGEMENT_CONSOLE_VALIDATION_SCHEMA
  );

  // Dell Isilon Certificate Handlers
  const handleFetchCertificate = async () => {
    const host = managementConsoleForm?.formState?.managementHost;
    if (!host) {
      notify.error("Management host is required");
      return;
    }

    // Show modal immediately with loading state
    setCertificateError(null);
    setCertificateData(null);
    setShowCertificateView(true);
    setFetchingCertificate(true);
    
    try {
      const result: any = await fetchCertificateApi({ host, serverType: "Dell" }).unwrap();
      // Extract certificate data from the API response structure: { data: { items: {...} } }
      const certificateInfo = result?.data?.items || result?.items || result;
      setCertificateData(certificateInfo as CertificateResponseType);
    } catch (error: any) {
      console.error("Certificate fetch error:", error);
      const errorMessage = error?.data?.message || error?.message || "Failed to fetch certificate from management console";
      setCertificateError(errorMessage);
    } finally {
      setFetchingCertificate(false);
    }
  };

  const handleAcceptCertificate = async (): Promise<boolean> => {
    // Lazy approach: Just store certificate acceptance in memory
    // Management server will be created when user clicks "Finish" button
    try {
      // Close the modal and mark certificate as accepted
      setShowCertificateView(false);
      setCertificateError(null);
      setCertificateAccepted(true);
      return true;
    } catch (error: any) {
      console.error("Certificate acceptance error:", error);
      return false;
    }
  };

  const handleDeclineCertificate = () => {
    setCertificateData(null);
    setCertificateAccepted(false);
    setShowCertificateView(false);
    setCertificateError(null);
  };

  // Reset certificate state when coming back to this step
  const resetCertificateState = () => {
    setCertificateData(null);
    setCertificateAccepted(false);
    setShowCertificateView(false);
    setCertificateError(null);
  };

  // Check if Dell Isilon form is valid for proceeding
  const isDellIsilonFormValid = () => {
    const serverType = serverTypeForm?.formState?.serverType?.value;
    if (serverType !== "dell") return true; // Not Dell Isilon, no validation needed
    
    const configName = serverTypeForm?.formState?.configName?.trim();
    const managementHost = managementConsoleForm?.formState?.managementHost?.trim();
    const managementUsername = managementConsoleForm?.formState?.managementUsername?.trim();
    const managementPassword = managementConsoleForm?.formState?.managementPassword;
    
    return !!(configName && managementHost && managementUsername && managementPassword);
  };

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
      hostCredentialsForm,
      selectedProtocol
    );

    try {
      const resp = await validateConnectionMutationApi(payload).unwrap();

      return new Promise((resolve) => {
        interval.current = setInterval(async () => {
          const data = await checkConnectionRespApi({
            id: resp?.workflowId,
          }).unwrap();
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
        }, 2000);
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

    status.completed.forEach((row) => {
      if (row?.status === WorkerConnectionStatus.SUCCESS) {
        if (row?.protocolType === ProtocolType.NFS)
          nfsValidatedWorkers.push(row?.workerId);
        else if (row?.protocolType === ProtocolType.SMB)
          smbValidatedWorkers.push(row?.workerId);

        if (row?.warnings?.length > 0) {
          newErrorMessageList.push({
            errorMessage: '',
            warnings: row.warnings,
            workerId: row?.workerId,
            workerName: workerIdWithName?.[row?.workerId] || 'workerName',
          });
        }
      } else if (row.status === WorkerConnectionStatus.ERROR) {
        newErrorMessageList.push({
          errorMessage: row?.message || "Unknown-Error",
          workerId: row?.workerId,
          workerName: workerIdWithName?.[row?.workerId] || "workerName ",
        });
        if (row?.protocolType === ProtocolType.NFS)
          nfsFailedWorkers.push(row?.workerId);
        else if (row?.protocolType === ProtocolType.SMB)
          smbFailedWorkers.push(row?.workerId);
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
    managementConsoleForm,
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
    // Protocol selection
    selectedProtocol,
    setSelectedProtocol,
    originalProtocol,
    setOriginalProtocol,
    // Original workers for edit mode
    originalNfsWorkers,
    setOriginalNfsWorkers,
    originalSmbWorkers,
    setOriginalSmbWorkers,
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
    // Dell Isilon Certificate State & Handlers
    certificateData,
    setCertificateData,
    showCertificateView,
    setShowCertificateView,
    certificateAccepted,
    setCertificateAccepted,
    fetchingCertificate,
    certificateError,
    handleFetchCertificate,
    handleAcceptCertificate,
    handleDeclineCertificate,
    resetCertificateState,
    isDellIsilonFormValid,
    // Dell Isilon Access Zones State
    selectedZoneIds,
    setSelectedZoneIds,
    zoneCredentials,
    setZoneCredentials,
    zoneWorkerAssignments,
    setZoneWorkerAssignments,
    activeZoneId,
    setActiveZoneId,
    zonesError,
    setZonesError,
  };
};

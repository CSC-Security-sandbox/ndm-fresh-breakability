import { Button, useWizard } from "@netapp/bxp-design-system-react";
import { useContext, useMemo } from "react";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { useLazyGetUniqueFileServerNamesQuery } from "@api/configApi";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { notify } from "@components/notification/NotificationWrapper";

const STEP_0_FILE_SERVER_NAME = 0;
const STEP_1_CREDENTIALS = 1;
const STEP_2_WORKERS = 2;
const STEP_3_WORKING_DIRECTORY = 3;

const NextAndSubmitButton = () => {
  const { currentStepIndex, goToNextStep } = useWizard();
  const [getUniqueFileServerName] = useLazyGetUniqueFileServerNamesQuery();
  const { selectedProjectId } = useSelectedProjectId();

  const {
    handleEditConfiguration,
    handleCreateConfiguration,
    handleValidateConnection,
    serverTypeForm,
    selectedWorkerIds,
    nfsCredentialsForm,
    smbCredentialsForm,
    hostCredentialsForm,
    fileServerId,
    isEditMode,
    validateConnectionLoader,
    disableNextButton,
    nfsValidatedWorkersIds,
    editingFileServerDetails,
    selectedProtocol,
    // Dell Isilon Certificate
    isDellIsilonFormValid,
    handleFetchCertificate,
    fetchingCertificate,
    showCertificateView,
    certificateAccepted,
    selectedZoneIds,
    zoneCredentials,
    zonesError,
  } = useContext(CommonFileServerContext);

  // Ensure safe defaults for zone state
  const safeSelectedZoneIds = selectedZoneIds || [];
  const safeZoneCredentials = zoneCredentials || {};

  const isDellIsilon = serverTypeForm?.formState?.serverType?.value === "dell";

  // Build map of originally configured zones and protocols for edit mode validation
  const originalConfiguredZones = useMemo(() => {
    if (!isEditMode || !editingFileServerDetails?.fileServers) {
      return new Map<string, { hasNfs: boolean; hasSmb: boolean }>();
    }
    
    const configMap = new Map<string, { hasNfs: boolean; hasSmb: boolean }>();
    editingFileServerDetails.fileServers.forEach((fs: any) => {
      const zoneName = fs.fileServerName || "";
      if (!configMap.has(zoneName)) {
        configMap.set(zoneName, { hasNfs: false, hasSmb: false });
      }
      const zoneConfig = configMap.get(zoneName)!;
      if (fs.protocol === "NFS") {
        zoneConfig.hasNfs = true;
      } else if (fs.protocol === "SMB") {
        zoneConfig.hasSmb = true;
      }
    });
    return configMap;
  }, [isEditMode, editingFileServerDetails]);

  console.debug("[NextAndSubmitButton] Render", {
    currentStepIndex,
    isDellIsilon,
    isEditMode,
    selectedZoneIds: safeSelectedZoneIds,
    zoneCredentials: safeZoneCredentials,
    selectedProtocol,
    hostCredentialsForm,
    nfsCredentialsForm,
    smbCredentialsForm,
    originalConfiguredZones: Array.from(originalConfiguredZones.entries()),
  });

  const handleFinish = async () => {
    console.debug("[NextAndSubmitButton] handleFinish", { isEditMode });
    if (isEditMode) {
      handleEditConfiguration();
    } else {
      handleCreateConfiguration();
    }
  };

  const getDisableStatus = () => {
    console.debug("[NextAndSubmitButton] getDisableStatus", { currentStepIndex });
    switch (currentStepIndex) {
      case STEP_0_FILE_SERVER_NAME: {
        // For Dell Isilon, check management console form validity
        if (isDellIsilon) {
          // If certificate view is showing, hide the button (handled in render)
          if (showCertificateView) {
            return true;
          }
          // Check if Dell Isilon form is valid for fetching certificate
          return !isDellIsilonFormValid();
        }
        
        // For Other NAS (existing logic)
        const isFormValid = serverTypeForm.isValid;
        const isFormDirty = serverTypeForm.dirty;

        if (fileServerId !== null) {
          return !isFormValid;
        }
        return !(isFormValid && isFormDirty);
      }

      case STEP_1_CREDENTIALS: {
        // Dell Isilon: Check if all selected zones have valid credentials
        if (isDellIsilon) {
          // In edit mode, if zones fetch failed, disable Next button
          if (isEditMode && zonesError) {
            console.debug("[NextAndSubmitButton] Dell Isilon edit mode - zones fetch failed, disabling Next", { zonesError });
            return true; // Disabled - zones fetch failed in edit mode
          }

          // Must have at least one zone selected
          if (safeSelectedZoneIds.length === 0) {
            return true; // Disabled - no zones selected
          }
          
          // Validation rules:
          // 1. If NFS IP is selected → NFS Username is required
          // 2. If NFS Username is filled → NFS IP is required (prevent partial config)
          // 3. If SMB IP is selected → SMB Username AND Password are required
          // 4. If SMB Username or Password is filled → SMB IP is required (prevent partial config)
          // 5. At least one protocol must be fully configured per zone
          const allZonesValid = safeSelectedZoneIds.every((zoneId) => {
            const creds = safeZoneCredentials[zoneId] || {};
            const configuredProtocols = originalConfiguredZones.get(zoneId);
            
            // Check if IPs are selected
            const nfsIpSelected = !!creds.nfsIp;
            const smbIpSelected = !!creds.smbIp;
            
            // Check if credentials are filled
            const nfsUsernameEntered = !!creds.nfsUsername?.trim();
            const smbUsernameEntered = !!creds.smbUsername?.trim();
            const smbPasswordEntered = !!creds.smbPassword?.trim();
            
            // NFS validation:
            // - If NFS IP is selected, username is required
            // - If NFS username is entered, IP must be selected (prevent partial config)
            const nfsIpRequiresUsername = !nfsIpSelected || nfsUsernameEntered;
            const nfsUsernameRequiresIp = !nfsUsernameEntered || nfsIpSelected;
            const nfsCredsValid = nfsIpRequiresUsername && nfsUsernameRequiresIp;
            
            // SMB validation:
            // - If SMB IP is selected, both username AND password are required
            // - If SMB username or password is entered, IP must be selected (prevent partial config)
            const smbIpRequiresCreds = !smbIpSelected || (smbUsernameEntered && smbPasswordEntered);
            const smbCredsRequireIp = !(smbUsernameEntered || smbPasswordEntered) || smbIpSelected;
            const smbCredsValid = smbIpRequiresCreds && smbCredsRequireIp;
            
            // A protocol is "fully configured" when IP + required credentials are present
            const nfsFullyConfigured = nfsIpSelected && nfsUsernameEntered;
            const smbFullyConfigured = smbIpSelected && smbUsernameEntered && smbPasswordEntered;
            
            // Edit mode additional validation
            if (isEditMode && configuredProtocols) {
              // If SMB was configured, it must still have a valid IP
              if (configuredProtocols.hasSmb && !smbIpSelected) {
                return false; // SMB IP is required for configured protocols
              }
              // If NFS was configured, it must still have a valid IP
              if (configuredProtocols.hasNfs && !nfsIpSelected) {
                return false; // NFS IP is required for configured protocols
              }
            }
            
            // Zone is valid if:
            // 1. All credentials are properly paired with IPs (no partial configs), AND
            // 2. At least one protocol is fully configured
            const hasAtLeastOneProtocol = nfsFullyConfigured || smbFullyConfigured;
            return nfsCredsValid && smbCredsValid && hasAtLeastOneProtocol;
          });
          console.debug("[NextAndSubmitButton] Dell Isilon STEP_1_CREDENTIALS validation", {
            safeSelectedZoneIds,
            safeZoneCredentials,
            allZonesValid,
            isEditMode,
            originalConfiguredZones: Array.from(originalConfiguredZones.entries()),
          });
          return !allZonesValid; // Disabled if not all zones are valid
        }

        // Other NAS: existing logic
        const isHostValid = hostCredentialsForm.isValid;
        
        // Only validate the selected protocol form
        if (selectedProtocol === 'NFS') {
          const isNfsValid = nfsCredentialsForm.isValid;
          return !isHostValid || !isNfsValid;
        } else if (selectedProtocol === 'SMB') {
          const isSmbValid = smbCredentialsForm.isValid;
          return !isHostValid || !isSmbValid;
        }
        
        return true; // Default to disabled if no protocol selected
      }

      case STEP_2_WORKERS: {
        return false;
      }

      case STEP_3_WORKING_DIRECTORY: {
        return false;
      }

      default:
        return false;
    }
  };

  const handleProceed = () => {
    console.debug("[NextAndSubmitButton] handleProceed", { currentStepIndex, isEditMode, isDellIsilon, certificateAccepted });
    const isConfigNameChanged =
      editingFileServerDetails?.configName !==
      serverTypeForm?.formState?.configName;

    const isFirstStep = currentStepIndex === STEP_0_FILE_SERVER_NAME;

    if (isFirstStep) {
      // Dell Isilon: Handle certificate flow
      if (isDellIsilon) {
        // In edit mode, if certificate was already accepted (from existing config), skip certificate fetch
        if (isEditMode && certificateAccepted) {
          // Check unique name if changed
          if (isConfigNameChanged) {
            checkUniqueFileServerName();
          } else {
            handleNextClick();
          }
          return;
        }
        
        // New config or certificate not yet accepted: fetch certificate
        // Modal's Accept button handles navigation
        handleFetchCertificate();
        return;
      }
      
      // Other NAS: existing logic
      if (!isEditMode) {
        checkUniqueFileServerName();
        return;
      }

      if (isEditMode && isConfigNameChanged) {
        checkUniqueFileServerName();
        return;
      }
    }

    handleNextClick();
  };

  const checkUniqueFileServerName = async () => {
    console.debug("[NextAndSubmitButton] checkUniqueFileServerName");
    if (
      currentStepIndex === STEP_0_FILE_SERVER_NAME &&
      serverTypeForm?.formState?.configName
    ) {
      try {
        await getUniqueFileServerName({
          projectId: selectedProjectId,
          configName: serverTypeForm?.formState?.configName,
        }).unwrap();

        handleNextClick();
      } catch (err) {
        console.log(err?.data?.message || "File Server creation error");
        notify.error("File Server Name already exists.");
      }
    }
  };

  const handleNextClick = async () => {
    console.debug("[NextAndSubmitButton] handleNextClick", { currentStepIndex });
    if (selectedWorkerIds?.length === 0) {
      // Remove this if else and keep only gotoNextStep once speed test is enabled
      if (currentStepIndex === 2) {
        handleFinish();
      } else {
        goToNextStep();
      }
    } else if (currentStepIndex === 2) {
      const selectedSet = new Set(selectedWorkerIds);
      const validatedSet = new Set(nfsValidatedWorkersIds);

      const areIdsEqual =
        selectedSet.size === validatedSet.size &&
        Array.from(selectedSet).every((id) => validatedSet.has(id));
      if (areIdsEqual) {
        // Remove handleFinish and enable goToNextStep once speed test is enabled
        // goToNextStep();
        handleFinish();
      } else {
        const resp = await handleValidateConnection();
        if (resp.errorMessageList.length === 0) {
          // Remove handleFinish and enable goToNextStep once speed test is enabled
          // goToNextStep();
          handleFinish();
        }
      }
    } else {
      goToNextStep();
    }
  };

  const areAllSelectedZonesFilled = () => {
    if (!isDellIsilon) return true;
    if (!safeSelectedZoneIds.length) return false;
    const result = safeSelectedZoneIds.every((zoneId) => {
      const creds = safeZoneCredentials[zoneId] || {};
      // SMB validation: if SMB IP is chosen, username and password must be filled
      const smbValid = creds.smbIp
        ? creds.smbUsername?.trim() && creds.smbPassword?.trim()
        : false;
      // NFS validation: if NFS IP is chosen, only username is required (password NOT required for Isilon)
      const nfsValid = creds.nfsIp
        ? creds.nfsUsername?.trim()
        : false;
      // At least one protocol must be fully filled
      return smbValid || nfsValid;
    });
    console.debug("[NextAndSubmitButton] areAllSelectedZonesFilled result", result, { selectedZoneIds: safeSelectedZoneIds, zoneCredentials: safeZoneCredentials });
    return result;
  };

  // Uncomment this and remove the below return and handleProccedAndFinish method once decided to enable speed test
  /* return (
    <>
      {currentStepIndex === 3 ? (
        <Button
          onClick={handleFinish}
          style={{ width: 152 }}
          isSubmitting={validateConnectionLoader || disableNextButton}
        >
          Finish
        </Button>
      ) : (
        <Button
          onClick={handleProceed}
          disabled={getDisableStatus()}
          isSubmitting={validateConnectionLoader}
          style={{ width: 152 }}
        >
          Proceed
        </Button>
      )}
    </>
  ); */

  return (
    <>
      {console.debug("[NextAndSubmitButton] render return", { currentStepIndex, isDellIsilon, selectedZoneIds: safeSelectedZoneIds, zoneCredentials: safeZoneCredentials })}
      {currentStepIndex === 2 ? (
        <Button
          onClick={handleProceed}
          style={{ width: 152 }}
          isSubmitting={validateConnectionLoader || disableNextButton}
        >
          Finish
        </Button>
      ) : (
        <Button
          onClick={handleProceed}
          disabled={getDisableStatus()}
          isSubmitting={validateConnectionLoader}
          style={{ width: 152 }}
        >
          Proceed
        </Button>
      )}
    </>
  );
};

export default NextAndSubmitButton;

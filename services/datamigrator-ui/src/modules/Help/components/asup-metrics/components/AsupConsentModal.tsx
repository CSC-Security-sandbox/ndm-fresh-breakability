/* eslint-disable */
// @ts-nocheck
import { useCallback, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  Button,
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Checkbox,
  useForm,
} from "@netapp/bxp-design-system-react";
import { BlueXpFormType } from "@/types/app.type";
import { RootStateType } from "@store/store";
import {
  setAsupEnabled,
  setAsupConsent,
  closeConsentModal,
} from "@store/reducer/asupSlice";
import { useUpdateAsupSettingsMutation } from "@api/asupApi";
import { notify } from "@components/notification/NotificationWrapper";
import Box from "@/components/container/Box";

interface ConsentFormState {
  agreeToShare: boolean;
}

/**
 * AsupConsentModal displays a modal for users to consent to ASUP data sharing.
 * On submit, it saves consent and downloads the generated XML.
 * In the future, this will send the XML to the ASUP endpoint.
 */
const AsupConsentModal = () => {
  const dispatch = useDispatch();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isConsentModalOpen } = useSelector(
    (state: RootStateType) => state.asupSlice
  );
  const [updateSettings] = useUpdateAsupSettingsMutation();

  const consentForm: BlueXpFormType<ConsentFormState> = useForm({
    agreeToShare: false,
  });

  const isConsentValid = consentForm.formState.agreeToShare;

  const handleAccept = useCallback(async () => {
    if (!isConsentValid) {
      notify.error("Please check the checkbox to continue");
      return;
    }

    setIsSubmitting(true);

    try {
      // Update local state
      dispatch(setAsupConsent(true));
      dispatch(setAsupEnabled(true));

      // Sync with backend - this will return the XML preview
      const response = await updateSettings({ enabled: true, consentGiven: true }).unwrap();

      // If we got XML back, download it
      if (response?.xmlPreview) {
        // Create a blob and download the XML
        const blob = new Blob([response.xmlPreview], { type: "application/xml" });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `asup-metrics-${new Date().toISOString().split("T")[0]}.xml`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        notify.success("ASUP Metrics Sharing enabled. XML downloaded successfully.");
      } else {
        notify.success("ASUP Metrics Sharing enabled successfully");
      }

      dispatch(closeConsentModal());

      // TODO: In the future, send XML to ASUP endpoint
      // const ASUP_ENDPOINT_URL = process.env.ASUP_ENDPOINT_URL;
      // if (ASUP_ENDPOINT_URL && response?.xmlPreview) {
      //   await fetch(ASUP_ENDPOINT_URL, {
      //     method: 'POST',
      //     headers: { 'Content-Type': 'application/xml' },
      //     body: response.xmlPreview,
      //   });
      // }

    } catch (error) {
      notify.error("Failed to enable ASUP Metrics Sharing");
      console.error("Error enabling ASUP:", error);
    } finally {
      setIsSubmitting(false);
    }
  }, [isConsentValid, dispatch, updateSettings]);

  const handleDecline = useCallback(() => {
    dispatch(closeConsentModal());
    notify.info("ASUP Metrics Sharing consent declined");
  }, [dispatch]);

  if (!isConsentModalOpen) {
    return null;
  }

  return (
    <Modal>
      <ModalHeader>Enable ASUP Metrics Sharing</ModalHeader>
      <ModalContent>
        <>
          <Box className="mb-6">
            <p className="text-gray-700">
              I understand that enabling ASUP Metrics Sharing will send system metrics to Auto Support (ASUP) weekly.
            </p>
          </Box>

          <Box className="mt-4">
            <Checkbox
              form={consentForm}
              name="agreeToShare"
              key="agreeToShare"
            >
              I agree to share metrics
            </Checkbox>
          </Box>
        </>
      </ModalContent>
      <ModalFooter>
        <Button color="secondary" onClick={handleDecline} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          disabled={!isConsentValid || isSubmitting}
          onClick={handleAccept}
        >
          {isSubmitting ? "Submitting..." : "Submit"}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default AsupConsentModal;

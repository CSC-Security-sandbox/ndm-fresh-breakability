import {
  Button,
  Checkbox,
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useForm,
} from "@netapp/bxp-design-system-react";
import {
  BlueXpFormType,
  CutOverConfirmModalPropType,
  CUTOVER_STATUS_TYPE_ENUM,
  REPORT_TYPES_ENUM,
} from "@/types/app.type";
import { useConfirmCutOverMutation } from "@api/jobsApi";
import { useDownloadReportsMutation } from "@api/reportApi";
import { notify } from "@components/notification/NotificationWrapper";
import { handleDownloadReport } from "@modules/jobs/jobs.utils";
import { Box } from "@components/container/index";

export default function CutoverConfirmationModal({
  jobRunId,
  closeConfirmationBox,
}: CutOverConfirmModalPropType) {
  const confirmCutOverForm: BlueXpFormType<{
    confirmCutOver: boolean;
  }> = useForm({
    confirmCutOver: false,
  });
  const [confirmCutOverApi] = useConfirmCutOverMutation();
  const [downloadReportApi] = useDownloadReportsMutation();

  const handleConfirmCutOver = async (
    jobRunId: string,
    action: CUTOVER_STATUS_TYPE_ENUM
  ) => {
    try {
      await confirmCutOverApi({ jobRunId, action }).unwrap();
      closeConfirmationBox();
      notify.success("Successfully confirmed cut over.");
    } catch (error) {
      notify.error("Failed to confirm cut over.");
      console.error(error);
    }
  };

  return (
    <Modal>
      <ModalHeader>Cutover Confirmation</ModalHeader>
      <ModalContent>
        <>
          <Box>
            Are you sure you want to Approve the Cutover ?
            <Box>
              <Button
                onClick={() =>
                  handleDownloadReport(
                    downloadReportApi,
                    jobRunId,
                    REPORT_TYPES_ENUM.COC,
                    "CSV"
                  )
                }
                variant="text"
              >
                Download CoC Report
              </Button>
            </Box>
          </Box>

          <Checkbox
            form={confirmCutOverForm}
            name="confirmCutOver"
            key="confirmCutOver"
          >
            I have reviewed and verified the COC document and all other
            essential information.
          </Checkbox>
        </>
      </ModalContent>
      <ModalFooter>
        <Button color="secondary" onClick={closeConfirmationBox}>
          Close
        </Button>
        <Button
          color="secondary"
          onClick={() =>
            handleConfirmCutOver(jobRunId, CUTOVER_STATUS_TYPE_ENUM.REJECTED)
          }
        >
          Reject
        </Button>
        <Button
          disabled={!confirmCutOverForm?.formState?.confirmCutOver}
          onClick={() =>
            handleConfirmCutOver(jobRunId, CUTOVER_STATUS_TYPE_ENUM.APPROVED)
          }
        >
          Confirm
        </Button>
      </ModalFooter>
    </Modal>
  );
}

import {
  Button,
  Checkbox,
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Text,
  useForm,
} from "@netapp/bxp-design-system-react";
import {
  BlueXpFormType,
  CutOverConfirmModalPropType,
  CutOverStatus,
  ReportENUM,
} from "@/types/app.type";
import { useConfirmCutOverMutation } from "@api/jobsApi";
import { useDownloadReportsMutation } from "@api/reportApi";
import { notify } from "../notification/NotificationWrapper";
import { handleDownloadReport } from "@modules/jobs/jobs.utils";
import { Box } from "../container";

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
    action: CutOverStatus
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
          <Text>
            Are you sure you want to Approve the Cutover ?
            <Box>
              <Button
                onClick={() =>
                  handleDownloadReport(
                    downloadReportApi,
                    jobRunId,
                    ReportENUM.COC,
                    "csv"
                  )
                }
                variant="text"
              >
                Download CoC Report
              </Button>
            </Box>
          </Text>

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
          onClick={() => handleConfirmCutOver(jobRunId, CutOverStatus.REJECTED)}
        >
          Reject
        </Button>
        <Button
          disabled={!confirmCutOverForm?.formState?.confirmCutOver}
          onClick={() => handleConfirmCutOver(jobRunId, CutOverStatus.APPROVED)}
        >
          Confirm
        </Button>
      </ModalFooter>
    </Modal>
  );
}

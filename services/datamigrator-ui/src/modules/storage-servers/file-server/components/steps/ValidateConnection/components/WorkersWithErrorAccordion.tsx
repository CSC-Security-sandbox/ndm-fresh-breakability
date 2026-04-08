import React, { useContext } from "react";
import {
  AccordionController,
  AccordionCard,
  AccordionCardContent,
  Text,
  Button,
} from "@netapp/bxp-design-system-react";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";

const WARNING_MESSAGES: Record<string, string> = {
  BACKUP_OPERATORS_CHECK_SKIPPED:
    'This worker is not domain-joined. Cannot verify Backup Operators membership. ' +
    'Ensure the SMB credential is a member of the Backup Operators group in Active Directory before running jobs.',
  BACKUP_OPERATORS_NOT_MEMBER:
    'The SMB credential is not a member of the Backup Operators group in this domain. ' +
    'Add it to Backup Operators in Active Directory before running jobs.',
};

const WorkersWithErrorAccordion = () => {
  const { errorMessageList, setSelectedWorkerIds } = useContext(
    CommonFileServerContext
  );

  const removeWorker = (workerId: string) => {
    setSelectedWorkerIds((prevIds: string[]) => {
      return prevIds.filter((id: string) => id !== workerId);
    });
  };

  return (
    <Box className="flex flex-col gap-3">
      {errorMessageList.map((workerWithError) => {
        const isWarningOnly =
          (workerWithError.warnings?.length ?? 0) > 0 &&
          !workerWithError.errorMessage;

        if (isWarningOnly) {
          return (
            <AccordionController key={workerWithError.workerId}>
              <AccordionCard
                title={workerWithError.workerName}
                value={<Box className="text-yellow-600 text-lg">Warning</Box>}
              >
                <AccordionCardContent>
                  <Box className="flex flex-col gap-2">
                    {workerWithError.warnings.map((code) => (
                      <Text key={code}>
                        {WARNING_MESSAGES[code] ?? code}
                      </Text>
                    ))}
                  </Box>
                </AccordionCardContent>
              </AccordionCard>
            </AccordionController>
          );
        }

        return (
          <AccordionController key={workerWithError.workerId}>
            <AccordionCard
              title={workerWithError.workerName}
              value={<Box className="text-red-500 text-lg">Error</Box>}
            >
              <AccordionCardContent>
                <Box className="flex justify-between">
                  <Text>{workerWithError.errorMessage}</Text>

                  <Button
                    variant="text"
                    onClick={() => removeWorker(workerWithError?.workerId)}
                  >
                    Remove worker
                  </Button>
                </Box>
              </AccordionCardContent>
            </AccordionCard>
          </AccordionController>
        );
      })}
    </Box>
  );
};

export default WorkersWithErrorAccordion;

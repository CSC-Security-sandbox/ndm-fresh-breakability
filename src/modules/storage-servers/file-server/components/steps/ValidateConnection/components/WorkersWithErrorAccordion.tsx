import React, { useContext } from "react";
import {
  AccordionController,
  AccordionCard,
  AccordionCardContent,
  Text,
  Button,
} from "@netapp/bxp-design-system-react";
import { CommonFileServerContext } from "@modules/storage-servers/file-server//context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";
import { nanoid } from "@reduxjs/toolkit";

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
        return (
          <AccordionController key={nanoid()}>
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

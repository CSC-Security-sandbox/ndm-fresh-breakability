import { Box } from "@components/container/index";
import {
  AccordionCard,
  AccordionCardContent,
  AccordionController,
  InlineNotification,
} from "@netapp/bxp-design-system-react";
import { ReactNode } from "react";
import { CommonFileServerContext } from "@modules/storage-servers/file-server//context/CommonFileServerContextProvider";
import { useContext } from "react";

interface ProtocolAccordion {
  children: ReactNode;
  title: ReactNode;
}

const ProtocolAccordion = ({ children, title }: ProtocolAccordion) => {
  const { isJobRunning } = useContext(CommonFileServerContext);
  return (
    <Box className="mt-8">
      <Box className="flex gap-3 -my-3">
        <AccordionController>
          <AccordionCard title={title} className="w-full">
            <AccordionCardContent className="w-full">
              <Box className="flex gap-4">{children}</Box>
              {isJobRunning && (
                <InlineNotification type="warning">
                  Credentials cannot be edited as there are ongoing jobs in the
                  file server.
                </InlineNotification>
              )}
            </AccordionCardContent>
          </AccordionCard>
        </AccordionController>
      </Box>
    </Box>
  );
};

export default ProtocolAccordion;

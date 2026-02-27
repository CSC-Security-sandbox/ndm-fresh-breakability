import { Box } from "@components/container/index";
import {
  AccordionCard,
  AccordionCardContent,
  AccordionController,
  InlineNotification,
} from "@netapp/bxp-design-system-react";
import { ReactNode } from "react";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { useContext } from "react";
import ExportPathSource from "@modules/storage-servers/file-server/components/steps/Credentials/components/ExportPathSource";
import { PROTOCOLS } from "@modules/storage-servers/file-server/components/steps/Credentials/export-path-source.constants";

interface ProtocolAccordion {
  children: ReactNode;
  title: ReactNode;
}

const ProtocolAccordion = ({ children, title }: ProtocolAccordion) => {
  const { isJobRunning, selectedProtocol } = useContext(CommonFileServerContext);

  const isProtocolDisabled = selectedProtocol !== title;
  const accordionClassName = `w-full ${isProtocolDisabled ? "opacity-50" : ""}`;

  return (
    <Box className="mt-8">
      <Box className="flex gap-3 -my-3">
        <AccordionController>
          <AccordionCard title={title} className={accordionClassName}>
            <AccordionCardContent className="w-full">
              <Box className="flex flex-col gap-4">
                <Box className="gap-4 inline-flex">{children}</Box>
                {title === PROTOCOLS.NFS && <ExportPathSource />}
              </Box>
              {isJobRunning && (
                <InlineNotification type="warning">
                  Credentials cannot be edited as there are ongoing jobs in the
                  file server.
                </InlineNotification>
              )}
              {isProtocolDisabled && !isJobRunning && (
                <InlineNotification type="info">
                  This protocol is not selected. Switch to {title} protocol to
                  edit these credentials.
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

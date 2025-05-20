import { Box } from "@components/container";
import {
  AccordionCard,
  AccordionCardContent,
  AccordionController,
} from "@netapp/bxp-design-system-react";
import { ReactNode } from "react";

const SpeedTestAccordion = ({ children }: { children: ReactNode }) => {
  return (
    <AccordionController>
      <AccordionCard
        title={
          <Box className="text-primary font-semibold text-base">
            Add File Servers
          </Box>
        }
      >
        <AccordionCardContent>{children}</AccordionCardContent>
      </AccordionCard>
    </AccordionController>
  );
};

export default SpeedTestAccordion;

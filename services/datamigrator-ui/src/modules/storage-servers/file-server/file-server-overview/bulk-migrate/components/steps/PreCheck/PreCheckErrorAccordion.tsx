import {
  AccordionCard,
  AccordionCardContent,
  AccordionController,
} from "@netapp/bxp-design-system-react";
import PreCheckErrorDetails from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/PreCheckErrorDetails";
import {
  getDestinationPaths,
  getSourcePaths,
} from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/pre-check.utils";
import { PreCheckErrorAccordionPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/pre-check.types";
import { memo, useMemo } from "react";
import PreCheckAccordionTitle from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/PreCheckAccordionTitle";

const PreCheckErrorAccordion = ({
  errorData,
  preCheckError,
}: PreCheckErrorAccordionPropsType) => {
  const { sourcePath, truncateSourcePath } = useMemo(
    () => getSourcePaths(errorData, preCheckError?.sourcePathId),
    [errorData, preCheckError?.sourcePathId]
  );

  const { destination, destinationPath, truncateDestinationPath } = useMemo(
    () => getDestinationPaths(errorData, preCheckError?.destinationPathId),
    [errorData, preCheckError?.destinationPathId]
  );

  const errorCount = preCheckError?.errors?.length || 0;
  const errorLabel = `${errorCount === 1 ? "Error" : "Errors"}: ${errorCount}`;

  return (
    <AccordionController>
      <AccordionCard
        className="py-3"
        title={
          <PreCheckAccordionTitle
            truncateSourcePath={truncateSourcePath}
            sourcePath={sourcePath}
            truncateDestinationPath={truncateDestinationPath}
            destination={destination}
            destinationPath={destinationPath}
            errorLabel={errorLabel}
          />
        }
      >
        <AccordionCardContent className="mt-2">
          {preCheckError?.errors?.map((key: string, index: number) => (
            <PreCheckErrorDetails key={index} index={index} errorKey={key} />
          ))}
        </AccordionCardContent>
      </AccordionCard>
    </AccordionController>
  );
};

export default memo(PreCheckErrorAccordion);

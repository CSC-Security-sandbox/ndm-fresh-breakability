import { Box } from "@components/container/index";
import { nanoid } from "@reduxjs/toolkit";
import { memo } from "react";
import PreCheckErrorAccordion from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/PreCheckErrorAccordion";
import MigrationConflictErrors from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/MigrationConflictErrors";
import { PreCheckStatusPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/pre-check.types";
import { Show } from "@components/show/Show";
import RenderEach from "@components/render-each/RenderEach";

const PreCheckErrors = ({ errorData }: PreCheckStatusPropsType) => {
  const preCheckErrorData = errorData?.[0]?.status?.errors ?? [];
  const migrationConflicts = errorData?.[0]?.status?.migrationConflicts ?? [];

  return (
    <Box className="flex flex-col gap-3">
      {/* THIS WILL SHOW MIGRATION CONFLICT ERRORS IF THEY EXIST */}
      <Show>
        <Show.When isTrue={migrationConflicts.length > 0}>
          <MigrationConflictErrors conflictData={migrationConflicts} />
        </Show.When>
      </Show>

      <RenderEach
        renderList={preCheckErrorData}
        renderItem={(preCheckError: any) => (
          <PreCheckErrorAccordion
            key={nanoid()}
            errorData={errorData}
            preCheckError={preCheckError}
          />
        )}
      />
    </Box>
  );
};

export default memo(PreCheckErrors);

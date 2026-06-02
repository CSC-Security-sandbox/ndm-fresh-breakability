import { Box } from "@components/container/index";
import {
  convertInheritedPermissionsEnabledFromMode,
  formatSmbPermissionInheritanceMode,
  SMB_CONVERT_INHERITED_PERMISSIONS_LABEL,
} from "@/utils/smb-inheritance.utils";
import { Popover, Text, Toggle } from "@netapp/bxp-design-system-react";

const READ_ONLY_POPOVER =
  "This option is set when the job is created and cannot be changed from job configuration.";

type ConvertInheritedPermissionsReadOnlyProps = {
  mode?: string | null;
  displayLabel?: string | null;
  /** `form` — disabled toggle in editable job config; `details` — read-only details modal */
  variant?: "details" | "form";
};

export const ConvertInheritedPermissionsReadOnly = ({
  mode,
  displayLabel,
  variant = "details",
}: ConvertInheritedPermissionsReadOnlyProps) => {
  if (variant === "form") {
    const enabled = convertInheritedPermissionsEnabledFromMode(mode, displayLabel);

    return (
      <Box className="flex gap-2 items-center opacity-60">
        <Toggle value={enabled} disabled>
          {SMB_CONVERT_INHERITED_PERMISSIONS_LABEL}
        </Toggle>
        <Popover placement="right" verticalPlacement="center">
          {READ_ONLY_POPOVER}
        </Popover>
      </Box>
    );
  }

  const status =
    displayLabel ?? formatSmbPermissionInheritanceMode(mode) ?? "Disabled";

  return (
    <Box>
      <Text className="!mb-0 font-semibold">
        {SMB_CONVERT_INHERITED_PERMISSIONS_LABEL}:
      </Text>
      <Text>{status}</Text>
    </Box>
  );
};

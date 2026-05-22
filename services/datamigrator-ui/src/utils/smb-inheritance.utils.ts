export enum SMB_PERMISSION_INHERITANCE_MODE {
  INHERIT_PERMS_AS_IS = "INHERIT_PERMS_AS_IS",
  INHERIT_PERMS_AS_EXPLICIT = "INHERIT_PERMS_AS_EXPLICIT",
}

/** Job configuration display key (matches jobs-service JobConfigurationEnum). */
export const SMB_CONVERT_INHERITED_PERMISSIONS_LABEL =
  "Convert inherited permissions into explicit";

export const isConvertInheritedPermissionsEnabled = (
  mode?: string | null
): boolean => {
  if (mode == null) {
    return true;
  }
  return mode === SMB_PERMISSION_INHERITANCE_MODE.INHERIT_PERMS_AS_EXPLICIT;
};

export const toConvertInheritedPermissionsMode = (
  enabled: boolean
): SMB_PERMISSION_INHERITANCE_MODE =>
  enabled
    ? SMB_PERMISSION_INHERITANCE_MODE.INHERIT_PERMS_AS_EXPLICIT
    : SMB_PERMISSION_INHERITANCE_MODE.INHERIT_PERMS_AS_IS;

export const formatSmbPermissionInheritanceMode = (
  mode?: string | null
): "Enabled" | "Disabled" | null => {
  if (mode == null) {
    return "Enabled";
  }
  return isConvertInheritedPermissionsEnabled(mode) ? "Enabled" : "Disabled";
};

export const isSmbInheritanceDisplayEnabled = (
  display?: string | null
): boolean => display === "Enabled";

export const convertInheritedPermissionsEnabledFromMode = (
  mode?: string | null,
  displayLabel?: string | null
): boolean => {
  if (displayLabel != null) {
    return isSmbInheritanceDisplayEnabled(displayLabel);
  }
  return isConvertInheritedPermissionsEnabled(mode);
};

/**
 * Enum for string comparison patterns used in regex matching
 */
export enum StringComparisonPattern {
  // Size extraction patterns
  SIZE_EXTRACTION = "size\\((\\d+)\\)",

  // File and directory name/size extraction patterns
  FILE_NAME_SIZE = "(.+?) \\((\\d+)\\)",
  DIRECTORY_NAME_SIZE = "\\/([^/]+) \\((\\d+)\\)$",

  // Number extraction patterns
  NUMBER_IN_PARENTHESES = "\\((\\d+)\\)",

  // Summary extraction patterns
  TOTAL_LENGTH = "Total Length: (\\d+)",
  TOTAL_PATH = "Total Path: (\\d+)",
}

/**
 * Helper function to get RegExp object from StringComparisonPattern
 */
export function getRegExp(pattern: StringComparisonPattern): RegExp {
  return new RegExp(pattern);
}

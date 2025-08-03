import {
    convertBytes,
    formatNumbersWithSuffix,
    formatSeconds,
    formatSizeAndCount
} from "./mapper";
import { ReportValueType } from "../constants/enums";
import {
  formatStringTypeCategories,
  PDFReportHeaders,
  ReportEntry,
  ReportSubCategoriesHeader,
} from "../constants/report";
import { BadRequestException, Logger } from "@nestjs/common";

export const logger = new Logger("groupAndOrder");

// Helper to format value if needed
export const formatValue = (entry: ReportEntry): string | number => {
  const value = Number(entry.value) || 0;

  switch (entry.valueType) {
    case ReportValueType.SIZE:
      return value > 0 ? convertBytes(value) : "0 B";
    case ReportValueType.TIME:
      return value > 0 ? formatSeconds(value) : "0 s";
    case ReportValueType.COUNT:
      return value > 0 ? formatNumbersWithSuffix(value) : "0";
    case ReportValueType.STRING:
      if (
        formatStringTypeCategories &&
        entry.category === formatStringTypeCategories.Top_File_Extension
      ) {
        return formatSizeAndCount(entry.value as string);
      }
    // format as a number with commas 2000 to 2k
    default:
      return entry.value;
  }
};

export const groupAndOrder = (
  data: any[],
  reportType: string,
): Record<string, any[]> | null => {
  try {
    if (!Array.isArray(data)) {
      logger.error("Invalid input: 'data' must be an array.");
      throw new BadRequestException("Invalid input: 'data' must be an array.");
    }
    if (typeof reportType !== "string") {
      logger.error("\"Invalid input: 'reportType' must be a string.");
      throw new BadRequestException(
        "Invalid input: 'reportType' must be a string.",
      );
    }
    if (data.length === 0) {
      logger.warn('Empty data array provided, returning null');
      return null;
    }
    // Group entries by category
    const grouped = data.reduce(
      (acc, entry) => {
        const category = entry.category;

        if (!category) {
          logger.warn(`Missing 'category' in entry :`, entry);
          return acc;
        }
        if (!acc[category]) acc[category] = [];
        acc[category].push(entry);
        return acc;
      },
      {} as Record<string, any[]>,
    );

    return Object.fromEntries(
      PDFReportHeaders[reportType].map((key) => {
        const entries = grouped[key] || [];
        if (ReportSubCategoriesHeader[key]) {
          // Group by subcategory for ordering
          const subGrouped = entries.reduce(
            (acc, entry) => {
              const subCategory = entry.sub_category;
              if (!subCategory) {
                logger.warn("Missing 'sub_category' in entry:", entry);
                return acc;
              }
              acc[subCategory] = acc[subCategory] || [];
              acc[subCategory].push({
                ...entry,
                value: formatValue(entry),
              });
              return acc;
            },
            {} as Record<string, any[]>,
          );
          // Order and format by subcategory
          const ordered = ReportSubCategoriesHeader[key].flatMap(
            (subCategory) => subGrouped[subCategory] || [],
          );
          return [key, ordered];
        } else {
          // Format values for categories without subcategories
          const formatted = entries.map((entry) => ({
            ...entry,
            value: formatValue(entry),
          }));
          return [key, formatted];
        }
      }),
    );
  } catch (error) {
    logger.warn("Error in groupAndOrder function:", error);
    return null;
  }
};

import { covertBytes, formatNumbersWithSuffix, formatSeconds } from "./mapper";
import { ReportValueType } from "../constants/enums";
import {
  formatStringTypeCategories,
  PDFReportHeaders,
  ReportEntry,
  ReportSubCategoriesHeader,
  CategoriesWithSimilarSubCategories
} from "../constants/report";
import { BadRequestException } from "@nestjs/common";

// Helper to format value if needed
export const formatValue = (entry: ReportEntry): string | number => {
  const value = Number(entry.value) || 0;

  switch (entry.valueType) {
    case ReportValueType.SIZE:
      return value > 0 ? covertBytes(value) : "0 B";
    case ReportValueType.TIME:
      return value > 0 ? formatSeconds(value) : "0 s";
    case ReportValueType.COUNT:
      return value > 0 ? formatNumbersWithSuffix(value) : "0" ;
    case ReportValueType.STRING:
      if(formatStringTypeCategories && entry.category === formatStringTypeCategories.Top_File_Extension){
        return formatSizeAndCount(entry.value as string);
      }
    // format as a number with commas 2000 to 2k
    default:
      return entry.value;
  }
};

function formatSizeAndCount(input: string): string {
  console.log('call inside the formatSizeAndCount function with input:', input);
  // Extract size value using regex
  const sizeMatch = input.match(/size\((\d+)\)/);
  const sizeValue = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;

  // Extract count value using regex
  const countMatch = input.match(/count\((\d+)\)/);
  const countValue = countMatch ? parseInt(countMatch[1], 10) : 0;

  // Format size using the formatBytes function (already in your codebase)
  const formattedSize = covertBytes(sizeValue);

  // Format count using the formatLargeNumber function (already in your codebase)
  const formattedCount = formatNumbersWithSuffix(countValue);

  // Combine into the desired output format
  return `size: (${formattedSize}); count: (${formattedCount})`;
}

export const groupAndOrder = (
  data: any[],
  reportType: string
): Record<string, any[]> | null => {
  try {
      if (!Array.isArray(data)) {
        throw new BadRequestException("Invalid input: 'data' must be an array.");
      }
      if (typeof reportType !== "string") {
        throw new BadRequestException("Invalid input: 'reportType' must be a string.");
      }
      if (data.length === 0) return null;

      // Group entries by category, remapping categories if needed
      const grouped = data.reduce(
        (acc, entry) => {
          const originalCategory = entry.category;
          if (!originalCategory) {
            console.error("Missing 'category' in entry:", entry);
            return acc;
          }

          // Remap category if it's in the CategoriesWithSimilarSubCategories mapping
          const category = CategoriesWithSimilarSubCategories[originalCategory] || originalCategory;

          if (!acc[category]) acc[category] = [];

          // If the category was remapped, update the entry's category
          if (category !== originalCategory) {
            entry = { ...entry, category };
          }

          acc[category].push(entry);
          return acc;
        },
        {} as Record<string, any[]>
      );
      // Filter out categories that should be remapped
      const remappedCategories = Object.keys(CategoriesWithSimilarSubCategories)
        .filter(key => CategoriesWithSimilarSubCategories[key] !== key);

      const filteredHeaders = PDFReportHeaders[reportType].filter(key => 
        !remappedCategories.includes(key)
      );

      // Map all categories first
      const mappedEntries = filteredHeaders.map((key) => {
        let entries = grouped[key] || [];

        if (ReportSubCategoriesHeader[key]) {
          // Group by subcategory for ordering
          const subGrouped = entries.reduce(
            (acc, entry) => {
              const subCategory = entry.sub_category;
              console.log('subCategory:', subCategory,key);

              // If subcategory is missing, we'll still process the entry
              if (!subCategory) {
                console.error("Missing 'sub_category' in entry:", entry);
                // Use a default subcategory key for entries without subcategory
                const defaultKey = '_default';
                acc[defaultKey] = acc[defaultKey] || [];
                acc[defaultKey].push({
                  ...entry,
                  value: formatValue(entry),
                });
                return acc;
              }

              acc[subCategory] = acc[subCategory] || [];
              acc[subCategory].push({
                ...entry,
                value: formatValue(entry),
              });
              return acc;
            },
            {} as Record<string, any[]>
          );
          // Order and format by subcategory
          const ordered = ReportSubCategoriesHeader[key].flatMap(
            (subCategory) => subGrouped[subCategory] || []
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
      });
      // Filter out categories with empty arrays
      const nonEmptyEntries = mappedEntries.filter(([_, entries]) => 
        Array.isArray(entries) && entries.length > 0
      );

      // Create the final object
      const result = Object.fromEntries(nonEmptyEntries);

      // Remove any remapped categories that might still be in the result
      remappedCategories.forEach(category => {
        delete result[category];
      });

      return result;
  } catch (error) {
    console.error("Error in groupAndOrder function:", error);
    return null;
  }
};

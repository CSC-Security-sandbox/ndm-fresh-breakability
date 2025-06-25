import { covertBytes } from "./mapper";

export const ReportHeaders = {
  DISCOVER: [
    "File Server Info",
    "Number of Files",
    "Modified",
    "Created",
    "Access Time",
    "Depth",
    "Space Used",
    "File System Stats",
    "Maximum Values",
    "Job Run Stats",
    "Biggest",
  ],
};
export const ReportSubCategoriesHeader = {
  "Number of Files": [
    "File Count with File Size: 0B",
    "File Count with File Size: <8KiB",
    "File Count with File Size: 8-64KiB",
    "File Count with File Size: 64KiB-1MiB",
    "File Count with File Size: 1-10MiB",
    "File Count with File Size: 10-100MiB",
    "File Size: 100 MiB - 1 GiB",
    "File Size: 1+ GiB",
  ],
  "Space Used": [
    "Capacity with File Size: 0B",
    "Capacity with File Size: <8KiB",
    "Capacity with File Size: 8-64KiB",
    "Capacity with File Size: 64KiB-1MiB",
    "Capacity with File Size: 1-10MiB",
    "Capacity with File Size: 10-100MiB",
    "Capacity with File Size: 100 MiB - 1 GiB",
    "Capacity with File Size: 1+ GiB",
  ],
};
export const SubCategorySize = [
  "Total Space for Regular Files",
  "Total Space for Directories",
  "Total Space Used",
  "max_file_size",
];
export const CategoryTime = ["Created", "Modified", "Access Time"];
export const CategorySubCategorySize = [
  "Space Used",
  "Capacity with Access Time future",
  "Capacity with Access Time 10+ yr",
  "Capacity with Creation Time future",
  "Capacity with Creation Time 10+ yr",
  "Capacity With Modification Time: future",
  "Capacity With Modification Time: 10+ yr",
  "Total Space for Regular Files",
  "Total Space for Directories",
  "Total Space Used",
  "max_file_size",
];

export const groupAndOrder = (
  data: any[],
  reportType: string,
): Record<string, any[]> | null => {
  if (!data || data.length === 0) return null;

  // Group entries by category
  const grouped = data.reduce(
    (acc, entry) => {
      const category = entry.category;
      if (!acc[category]) acc[category] = [];
      acc[category].push(entry);
      return acc;
    },
    {} as Record<string, any[]>,
  );

  // Helper to format value if needed
  const formatValue = (
    key: string,
    subCategory: string | undefined,
    value: number,
  ) => {
    if (
      CategorySubCategorySize.includes(key) ||
      (subCategory && CategorySubCategorySize.includes(subCategory))
    ) {
      return value > 0 ? covertBytes(value) : "0 B";
    }
    return value;
  };

  return Object.fromEntries(
    ReportHeaders[reportType].map((key) => {
      const entries = grouped[key] || [];
      if (ReportSubCategoriesHeader[key]) {
        // Group by subcategory for ordering
        const subGrouped = entries.reduce(
          (acc, entry) => {
            acc[entry.sub_category] = acc[entry.sub_category] || [];
            acc[entry.sub_category].push(entry);
            return acc;
          },
          {} as Record<string, any[]>,
        );

        // Order and format by subcategory
        const ordered = ReportSubCategoriesHeader[key].flatMap((subCategory) =>
          (subGrouped[subCategory] || []).map((entry) => ({
            ...entry,
            value: formatValue(key, subCategory, entry.value),
          })),
        );
        return [key, ordered];
      } else {
        // Format values for categories without subcategories
        const formatted = entries.map((entry) => ({
          ...entry,
          value: formatValue(key, entry.sub_category, entry.value),
        }));
        return [key, formatted];
      }
    }),
  );
};
/*export const groupAndOrder = (
  data: any[],
  reportType: string,
  //order: string[],
): Record<string, any[]> => {
  if (data && data.length > 0) {
    const grouped = data?.reduce(
      (acc, entry) => {
        const category = entry.category;
        if (!acc[category]) acc[category] = [];
        acc[category].push(entry);
        return acc;
      },
      {} as Record<string, any[]>,
    );
    return Object.fromEntries(
      ReportHeaders[reportType].map((key) => {
        const entries = grouped[key] || [];
        console.log(`Processing category: ${key}, Entries: ${entries.length}`);
        if (ReportSubCategoriesHeader[key]) {
          let sortedCategories = [];
          const order = ReportSubCategoriesHeader[key];
          order.forEach((subCategory) => {
            entries.forEach((entry) => {
              if (entry.sub_category === subCategory) {
                console.log(
                  "CategorySize[key]>>>>>>>",
                  CategorySubCategorySize.indexOf(key) !== -1,
                  +"subCategory" +
                    subCategory +
                    CategorySubCategorySize.indexOf(subCategory) !==
                    -1,
                );
                if (
                  CategorySubCategorySize.indexOf(key) !== -1 ||
                  CategorySubCategorySize.indexOf(subCategory) !== -1
                ) {
                  entry.value =
                    entry.value > 0 ? covertBytes(entry.value) : "0 B";
                }
                sortedCategories.push(entry);
              }
            });
          });
          return [key, sortedCategories];
        } else {
          console.log(
            `Processing category2222: ${key}, Entries: ${entries.length}`,
          );
          entries.forEach((entry) => {
            if (
              CategorySubCategorySize.indexOf(key) !== -1 ||
              CategorySubCategorySize.indexOf(entry.sub_category) !== -1
            ) {
              entry.value = entry.value > 0 ? covertBytes(entry.value) : "0 B";
            }
          });
          return [key, entries];
        }
      }),
    );
  } else {
    return null;
  }
};*/

//export const FormatToSizeAndTime =

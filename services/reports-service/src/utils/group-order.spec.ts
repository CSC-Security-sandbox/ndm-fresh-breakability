import { formatValue, groupAndOrder } from "./group-order";
import { ReportValueType } from "../constants/enums";
import { PDFReportHeaders } from "../constants/report";
// Mock the report constants to avoid dependencies
jest.mock("../constants/report", () => ({
  PDFReportHeaders: {
    DISCOVER: [
      "Number of Files",
      "Modified",
      "Created",
      "Access Time",
      "Job Run Stats"
    ]
  },
  ReportSubCategoriesHeader: {
    "Number of Files": [
      "File Count with File Size: 0B",
      "File Count with File Size: <8KiB"
    ],
    "Modified": [
      "File Count With Modification Time 0-1 wk",
      "Capacity With Modification Time 0-1 wk"
    ]
  },
  CategoriesWithSimilarSubCategories: {
    Modified: "Modified",
    Created: "Modified",
    "Access Time": "Modified"
  }
}));

describe("formatValue", () => {
  it("should format size values correctly", () => {
    const entry = {
      category: "Space Used",
      sub_category: "Capacity with File Size: 0B",
      value: 1024,
      valueType: ReportValueType.SIZE
    };
    expect(formatValue(entry)).toBe("1.02 KB");
  });

  it("should format time values correctly", () => {
    const entry = {
      category: "Job Run Stats",
      sub_category: "Total Time",
      value: 3600,
      valueType: ReportValueType.TIME
    };
    expect(formatValue(entry)).toBe("1h 0m 0s");
  });

  it("should format count values correctly", () => {
    const entry = {
      category: "Number of Files",
      sub_category: "File Count with File Size: 0B",
      value: 1024,
      valueType: ReportValueType.COUNT
    };
    expect(formatValue(entry)).toBe("1.02 K");
  });

  it("should return original value for unknown value types", () => {
    const entry = {
      category: "Custom",
      sub_category: "Custom Sub",
      value: "custom value",
      valueType: ReportValueType.STRING
    };
    expect(formatValue(entry)).toBe("custom value");
  });

  it("should handle zero values correctly", () => {
    expect(formatValue({
      category: "Space Used",
      value: 0,
      valueType: ReportValueType.SIZE
    })).toBe("0 B");

    expect(formatValue({
      category: "Job Run Stats",
      value: 0,
      valueType: ReportValueType.TIME
    })).toBe("0 s");

    expect(formatValue({
      category: "Number of Files",
      value: 0,
      valueType: ReportValueType.COUNT
    })).toBe("0");
  });
});

describe("groupAndOrder", () => {
  const mockReportType = "DISCOVER";

  it("should return null for empty data array", () => {
    const result = groupAndOrder([], mockReportType);
    expect(result).toBeNull();
  });

  it("should throw BadRequestException for invalid inputs", () => {
    // @ts-ignore - Testing invalid input
    const result1 = groupAndOrder("not an array", mockReportType);
    expect(result1).toBeNull();

    // @ts-ignore - Testing invalid input
    const result2 = groupAndOrder([{ category: "test" }], 123);
    expect(result2).toBeNull();
  });

  it("should group and order data correctly with subcategories", () => {
    const mockData = [
      {
        category: "Number of Files",
        sub_category: "File Count with File Size: 0B",
        value: 1024,
        valueType: ReportValueType.COUNT
      },
      {
        category: "Number of Files",
        sub_category: "File Count with File Size: <8KiB",
        value: 60,
        valueType: ReportValueType.COUNT
      },
      {
        category: "Job Run Stats",
        sub_category: "Total Time",
        value: 453,
        valueType: ReportValueType.TIME
      }
    ];

    const result = groupAndOrder(mockData, mockReportType);

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("Number of Files");
    expect(result).toHaveProperty("Job Run Stats");

    expect(result["Number of Files"]).toHaveLength(2);
    expect(result["Job Run Stats"]).toHaveLength(1);

    expect(result["Number of Files"][0].value).toBe("1.02 K");
    expect(result["Number of Files"][1].value).toBe("60");
    expect(result["Job Run Stats"][0].value).toBe("7m 33s");
  });

  it("should handle entries without subcategories", () => {
    const mockData = [
      {
        category: "Custom Category",
        value: "Custom Value",
        valueType: ReportValueType.STRING
      }
    ];

    // Add the custom category to the mock
    PDFReportHeaders[mockReportType].push("Custom Category");

    const result = groupAndOrder(mockData, mockReportType);

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("Custom Category");
    expect(result["Custom Category"]).toHaveLength(1);
    expect(result["Custom Category"][0].value).toBe("Custom Value");

    // Remove the custom category from the mock
    PDFReportHeaders[mockReportType].pop();
  });

  it("should remap Created and Access Time categories to Modified", () => {
    const mockData = [
      {
        category: "Modified",
        sub_category: "File Count With Modification Time 0-1 wk",
        value: 100,
        valueType: ReportValueType.COUNT
      },
      {
        category: "Created",
        sub_category: "File Count with Creation Time 10+ yr",
        value: 200,
        valueType: ReportValueType.COUNT
      },
      {
        category: "Access Time",
        sub_category: "File Count with Access Time 5-6 yr",
        value: 300,
        valueType: ReportValueType.COUNT
      }
    ];

    const result = groupAndOrder(mockData, mockReportType);

    expect(result).toHaveProperty("Modified");

    const modifiedEntries = result["Modified"];
    expect(modifiedEntries.length).toBe(1);

    expect(modifiedEntries.some(entry => entry.category === "Modified")).toBe(true);
    expect(modifiedEntries.some(entry => entry.category === "Created")).toBe(false);
    expect(modifiedEntries.some(entry => entry.category === "Access Time")).toBe(false);

    expect(result).not.toHaveProperty("Created");
    expect(result).not.toHaveProperty("Access Time");
  });

  it("should handle missing categories gracefully", () => {
    const mockData = [
      {
        category: "Number of Files",
        sub_category: "File Count with File Size: 0B",
        value: 1024,
        valueType: ReportValueType.COUNT
      }
    ];

    const result = groupAndOrder(mockData, mockReportType);

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("Number of Files");
    expect(result).not.toHaveProperty("Modified");
    expect(result).not.toHaveProperty("Created");
    expect(result).not.toHaveProperty("Access Time");
    expect(result).not.toHaveProperty("Job Run Stats");
  });

  it("should log errors for entries missing required properties", () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    const mockData = [
      {
        // Missing category
        sub_category: "File Count with File Size: 0B",
        value: 1024,
        valueType: ReportValueType.COUNT
      },
      {
        category: "Number of Files",
        // Missing sub_category
        value: 60,
        valueType: ReportValueType.COUNT
      }
    ];

    const result = groupAndOrder(mockData, mockReportType);

    expect(consoleSpy).toHaveBeenCalledWith(
      "Missing 'category' in entry:",
      expect.anything()
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      "Missing 'sub_category' in entry:",
      expect.anything()
    );

    consoleSpy.mockRestore();
  });
});

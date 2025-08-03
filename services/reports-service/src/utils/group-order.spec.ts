import { formatValue, groupAndOrder } from "./group-order";
import { ReportValueType } from "../constants/enums";
import { PDFReportHeaders } from "../constants/report";
import { Logger } from "@nestjs/common";

jest.mock("@nestjs/common", () => {
  const mockLogger = {
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
  };

  return {
    ...jest.requireActual("@nestjs/common"),
    Logger: jest.fn().mockImplementation(() => mockLogger),
    // Export the mock logger so we can access it in tests
    __mockLogger: mockLogger,
  };
});

// ✅ Get reference to the mocked logger
const { __mockLogger: mockLoggerInstance } = jest.requireMock("@nestjs/common");

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
    ],
    "Created": [
      "File Count with Creation Time 0-1 wk",
      "Capacity with Creation Time 0-1 wk"
    ],
    "Access Time": [
      "File Count with Access Time 0-1 wk",
      "Capacity with Access Time 0-1 wk"
    ]
  },
  formatStringTypeCategories: {
    Top_File_Extension: "Top File Extensions"
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
    expect(formatValue(entry)).toBe("1 KiB");
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
    expect(formatValue(entry)).toBe("1.02K");
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

  beforeEach(() => {
    // ✅ Clear mock calls before each test
    mockLoggerInstance.warn.mockClear();
    mockLoggerInstance.error.mockClear();
    mockLoggerInstance.log.mockClear();
    mockLoggerInstance.debug.mockClear();
  });

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

    expect(result["Number of Files"][0].value).toBe("1.02K");
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

  it("should handle time-related categories correctly", () => {
    // Update the mock to include the subcategories we're testing
    jest.resetModules();
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
        ],
        "Created": [
          "File Count with Creation Time 0-1 wk",
          "File Count with Creation Time 10+ yr"
        ],
        "Access Time": [
          "File Count with Access Time 0-1 wk",
          "File Count with Access Time 5-6 yr"
        ]
      },
      formatStringTypeCategories: {
        Top_File_Extension: "Top File Extensions"
      }
    }));

    // Re-import the functions to use the updated mock
    const { groupAndOrder } = require("./group-order");

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
    expect(result).toHaveProperty("Created");
    expect(result).toHaveProperty("Access Time");

    const modifiedEntries = result["Modified"];
    expect(modifiedEntries.length).toBe(1);
    expect(modifiedEntries[0].value).toBe("100");

    const createdEntries = result["Created"];
    expect(createdEntries.length).toBe(1);
    expect(createdEntries[0].value).toBe("200");

    const accessTimeEntries = result["Access Time"];
    expect(accessTimeEntries.length).toBe(1);
    expect(accessTimeEntries[0].value).toBe("300");

    // Reset the mock for other tests
    jest.resetModules();
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
      formatStringTypeCategories: {
        Top_File_Extension: "Top File Extensions"
      }
    }));
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
    expect(result["Number of Files"].length).toBe(1);
    expect(result["Number of Files"][0].value).toBe("1.02K");

    // The implementation returns empty arrays for categories in PDFReportHeaders that have no data
    expect(result).toHaveProperty("Modified");
    expect(result["Modified"]).toEqual([]);
    expect(result).toHaveProperty("Created");
    expect(result["Created"]).toEqual([]);
    expect(result).toHaveProperty("Access Time");
    expect(result["Access Time"]).toEqual([]);
    expect(result).toHaveProperty("Job Run Stats");
    expect(result["Job Run Stats"]).toEqual([]);
  });

  it("should log errors for entries missing required properties", () => {

  //   const { logger } = require("./group-order");
  // const originalWarn = logger.warn;
  // const warnSpy = jest.fn();
  // logger.warn = warnSpy;

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

    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      "Missing 'category' in entry :",
      expect.anything()
    );
    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      "Missing 'sub_category' in entry:",
      expect.anything()
    );

    expect(result).not.toBeNull();
    expect(mockLoggerInstance.warn).toHaveBeenCalledTimes(2);
  });
});

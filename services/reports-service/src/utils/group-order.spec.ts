import { ReportType, ReportValueType } from "../constants/enums";
import {
  PDFReportHeaders,
  ReportSubCategoriesHeader,
} from "../constants/report";
import { groupAndOrder } from "./group-order";

jest.mock("./mapper", () => ({
  covertBytes: jest.fn((val) => `${val} B`),
  formatSeconds: jest.fn((val) => `${val} s`),
}));

describe("groupAndOrder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockReportType = ReportType.DISCOVERY;
  const mockData = [
    {
      category: "Number of Files",
      sub_category: "File Count with File Size: 0B",
      value: 1024,
      valueType: ReportValueType.COUNT,
    },
    {
      category: "Number of Files",
      sub_category: "File Count with File Size: <8KiB",
      value: 60,
      valueType: ReportValueType.COUNT,
    },
    {
      category: "Created",
      sub_category: "Capacity with Creation Time 10+ yr",
      value: 409873,
      valueType: ReportValueType.SIZE,
    },
    {
      category: "Created",
      sub_category: "File Count with Creation Time 10+ yr",
      value: 42,
      valueType: ReportValueType.SIZE,
    },
    {
      category: "Job Run Stats",
      sub_category: "Total Time",
      value: 453,
      valueType: ReportValueType.TIME,
    },
  ];

  beforeAll(() => {
    PDFReportHeaders[mockReportType] = [
      "Number of Files",
      "Created",
      "Job Run Stats",
    ];
    ReportSubCategoriesHeader["Number of Files"] = [
      "File Count with File Size: 0B",
      "File Count with File Size: <8KiB",
    ];
  });

  it("should group and order data correctly with subcategories", () => {
    const result = groupAndOrder(mockData, mockReportType);

    expect(result).toHaveProperty("Number of Files");
    expect(result).toHaveProperty("Created");
    expect(result).toHaveProperty("Job Run Stats");
    // @ts-ignore
    expect(result).toEqual({
      "Number of Files": [
        {
          category: "Number of Files",
          sub_category: "File Count with File Size: 0B",
          value: "1,024 Counts",
          valueType: ReportValueType.COUNT,
        },
        {
          category: "Number of Files",
          sub_category: "File Count with File Size: <8KiB",
          value: "60 Counts",
          valueType: ReportValueType.COUNT,
        },
      ],
      Created: [
        {
          category: "Created",
          sub_category: "Capacity with Creation Time 10+ yr",
          value: "409873 B",
          valueType: ReportValueType.SIZE,
        },
        {
          category: "Created",
          sub_category: "File Count with Creation Time 10+ yr",
          value: "42 B",
          valueType: ReportValueType.SIZE,
        },
      ],
      "Job Run Stats": [
        {
          category: "Job Run Stats",
          sub_category: "Total Time",
          value: "453 s",
          valueType: ReportValueType.TIME,
        },
      ],
    });
  });
  it("should return Array of object which doesn't have the category", () => {
    const mockData1 = [
      {
        sub_category: "File Count with File Size: 0B",
        value: 1024,
        valueType: ReportValueType.COUNT,
      },
    ];
    const result = groupAndOrder(mockData1, mockReportType);
    expect(result).toEqual({
      Created: [],
      "Job Run Stats": [],
      "Number of Files": [],
    });
  });
  it("should return Array of object which doesn't have the sub_category", () => {
    const mockData2 = [
      {
        category: "Created",
        value: 1024,
        valueType: ReportValueType.COUNT,
      },
    ];
    const result = groupAndOrder(mockData2, mockReportType);
    expect(result).toEqual({
      Created: [
        {
          category: "Created",
          value: "1,024 Counts",
          valueType: "count",
        },
      ],
      "Job Run Stats": [],
      "Number of Files": [],
    });
  });

  it("should return null for data is not an Array", () => {
    const result = groupAndOrder(undefined, mockReportType);
    expect(result).toEqual(null);
  });
  it("should return null for empty data", () => {
    const result = groupAndOrder([], mockReportType);
    expect(result).toEqual(null);
  });
  it("should throw error for non-string reportType", () => {
    const result = groupAndOrder(mockData, 123 as any);
    expect(result).toBe(null);
  });
});

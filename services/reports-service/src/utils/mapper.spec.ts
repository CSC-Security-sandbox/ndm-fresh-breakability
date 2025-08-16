import {
  convertBytes,
  capitalize,
  formatNumbersWithSuffix,
  formatSeconds,
  formatSizeAndCount,
} from "./mapper";

describe("convertBytes", () => {
  it("should return '0 B' for 0 bytes", () => {
    expect(convertBytes(0)).toBe("0 B");
  });

  it("should return the correct size in B for values less than 1024", () => {
    expect(convertBytes(512)).toBe("512 B");
  });

  it("should return the correct size in KiB", () => {
    expect(convertBytes(1024)).toBe("1 KiB");
    expect(convertBytes(1536)).toBe("1.50 KiB");
  });

  it("should return the correct size in MiB", () => {
    expect(convertBytes(1048576)).toBe("1 MiB");
    expect(convertBytes(1572864)).toBe("1.50 MiB");
  });

  it("should return the correct size in GiB", () => {
    expect(convertBytes(1073741824)).toBe("1 GiB");
    expect(convertBytes(1610612736)).toBe("1.50 GiB");
  });

  it("should return the correct size in TiB", () => {
    expect(convertBytes(1099511627776)).toBe("1 TiB");
    expect(convertBytes(1649267441664)).toBe("1.50 TiB");
  });

  it("should return the correct size in PiB", () => {
    expect(convertBytes(1125899906842624)).toBe("1 PiB");
    expect(convertBytes(1688849860263936)).toBe("1.50 PiB");
  });
});

describe("capitalize", () => {
  it("should capitalize the first letter and lowercase the rest", () => {
    expect(capitalize("hello")).toBe("Hello");
    expect(capitalize("HELLO")).toBe("Hello");
    expect(capitalize("hElLo")).toBe("Hello");
  });

  it("should handle single-character strings", () => {
    expect(capitalize("a")).toBe("A");
    expect(capitalize("A")).toBe("A");
  });

  it("should handle empty strings", () => {
    expect(capitalize("")).toBe("");
  });
});

describe("formatSeconds", () => {
  it("should format seconds only", () => {
    expect(formatSeconds(19)).toBe("19s");
    expect(formatSeconds(59)).toBe("59s");
  });

  it("should format minutes and seconds", () => {
    expect(formatSeconds(125)).toBe("2m 5s");
    expect(formatSeconds(3599)).toBe("59m 59s");
  });

  it("should format hours, minutes, and seconds", () => {
    expect(formatSeconds(3661)).toBe("1h 1m 1s");
    expect(formatSeconds(86399)).toBe("23h 59m 59s");
  });

  it("should format days, hours, minutes, and seconds", () => {
    expect(formatSeconds(90061)).toBe("1d 1h 1m 1s");
    expect(formatSeconds(172800)).toBe("2d 0h 0m 0s");
  });

  it("should handle zero seconds", () => {
    expect(formatSeconds(0)).toBe("0s");
  });
});

describe("formatNumbersWithSuffix", () => {
  it("should return value in 'Cr' for numbers >= 1,00,00,000", () => {
    expect(formatNumbersWithSuffix(1_00_00_000)).toBe("10M");
    expect(formatNumbersWithSuffix(2_50_00_000)).toBe("25M");
  });

  it("should return value in 'L' for numbers >= 1,00,000 and < 1,00,00,000", () => {
    expect(formatNumbersWithSuffix(1_00_000)).toBe("100K");
    expect(formatNumbersWithSuffix(5_50_000)).toBe("550K");
  });

  it("should return value in 'K' for numbers >= 1,000 and < 1,00,000", () => {
    expect(formatNumbersWithSuffix(1_000)).toBe("1K");
    expect(formatNumbersWithSuffix(12_500)).toBe("12.5K");
  });

  it("should return the number as string for numbers < 1,000", () => {
    expect(formatNumbersWithSuffix(999)).toBe("999");
    expect(formatNumbersWithSuffix(0)).toBe("0");
  });
});

describe("formatSizeAndCount", () => {
  it("should format size and count correctly", () => {
    expect(formatSizeAndCount("size(1024)count(1000)")).toBe(
      "size: (1 KiB); count: (1K)",
    );
    expect(formatSizeAndCount("size(1048576)count(100000)")).toBe(
      "size: (1 MiB); count: (100K)",
    );
  });

  it("should handle zero values", () => {
    expect(formatSizeAndCount("size(0)count(0)")).toBe("size: (0 B); count: (0)");
  });

  it("should handle missing values", () => {
    expect(formatSizeAndCount("size()count()")).toBe("size: (0 B); count: (0)");
    expect(formatSizeAndCount("")).toBe("size: (0 B); count: (0)");
  });

  it("should handle only size or only count", () => {
    expect(formatSizeAndCount("size(1024)")).toBe(
      "size: (1 KiB); count: (0)",
    );
    expect(formatSizeAndCount("count(1000)")).toBe(
      "size: (0 B); count: (1K)",
    );
  });
});

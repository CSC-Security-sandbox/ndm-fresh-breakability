import {
  covertBytes,
  capitalize,
  formatSeconds,
  formatNumbersWithSuffix,
} from "./mapper";

describe("covertBytes", () => {
  it("should return '0 B' for 0 bytes", () => {
    expect(covertBytes(0)).toBe("0 B");
  });

  it("should return the correct size in B for values less than 1024", () => {
    expect(covertBytes(512)).toBe("512 B");
  });

  it("should return the correct size in KB", () => {
    expect(covertBytes(1024)).toBe("1.02 KB");
    expect(covertBytes(1536)).toBe("1.54 KB");
  });

  it("should return the correct size in MB", () => {
    expect(covertBytes(1048576)).toBe("1.05 MB");
    expect(covertBytes(1572864)).toBe("1.57 MB");
  });

  it("should return the correct size in GB", () => {
    expect(covertBytes(1073741824)).toBe("1.07 GB");
    expect(covertBytes(1610612736)).toBe("1.61 GB");
  });

  it("should return the correct size in TB", () => {
    expect(covertBytes(1099511627776)).toBe("1.10 TB");
    expect(covertBytes(1649267441664)).toBe("1.65 TB");
  });

  it("should return the correct size in PB", () => {
    expect(covertBytes(1125899906842624)).toBe("1.13 PB");
    expect(covertBytes(1688849860263936)).toBe("1.69 PB");
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
    expect(formatNumbersWithSuffix(1_00_00_000)).toBe("1.00 Cr");
    expect(formatNumbersWithSuffix(2_50_00_000)).toBe("2.50 Cr");
  });

  it("should return value in 'L' for numbers >= 1,00,000 and < 1,00,00,000", () => {
    expect(formatNumbersWithSuffix(1_00_000)).toBe("1.00 L");
    expect(formatNumbersWithSuffix(5_50_000)).toBe("5.50 L");
  });

  it("should return value in 'K' for numbers >= 1,000 and < 1,00,000", () => {
    expect(formatNumbersWithSuffix(1_000)).toBe("1.00 K");
    expect(formatNumbersWithSuffix(12_500)).toBe("12.50 K");
  });

  it("should return the number as string for numbers < 1,000", () => {
    expect(formatNumbersWithSuffix(999)).toBe("999");
    expect(formatNumbersWithSuffix(0)).toBe("0");
  });
});

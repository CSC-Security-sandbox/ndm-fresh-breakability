import { covertBytes, capitalize } from "./mapper";

describe("covertBytes", () => {
  it("should return '0 B' for 0 bytes", () => {
    expect(covertBytes(0)).toBe("0 B");
  });

  it("should return the correct size in B for values less than 1024", () => {
    expect(covertBytes(512)).toBe("512 B");
  });

  it("should return the correct size in KB", () => {
    expect(covertBytes(1024)).toBe("1 KB");
    expect(covertBytes(1536)).toBe("1.50 KB");
  });

  it("should return the correct size in MB", () => {
    expect(covertBytes(1048576)).toBe("1 MB");
    expect(covertBytes(1572864)).toBe("1.50 MB");
  });

  it("should return the correct size in GB", () => {
    expect(covertBytes(1073741824)).toBe("1 GB");
    expect(covertBytes(1610612736)).toBe("1.50 GB");
  });

  it("should return the correct size in TB", () => {
    expect(covertBytes(1099511627776)).toBe("1 TB");
    expect(covertBytes(1649267441664)).toBe("1.50 TB");
  });

  it("should return the correct size in PB", () => {
    expect(covertBytes(1125899906842624)).toBe("1 PB");
    expect(covertBytes(1688849860263936)).toBe("1.50 PB");
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

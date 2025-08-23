import { SIMPLIFIED_BYTE_UNITS } from "@modules/jobs/discovery-preview/constants/preview.constants";

const convertToBytes = (value: number, unit: string): number => {
  const unitIndex = SIMPLIFIED_BYTE_UNITS.indexOf(unit);
  return unitIndex === -1 ? value : value * Math.pow(1024, unitIndex);
};

const parseValueWithUnit = (
  text: string
): { value: number; unit: string } | null => {
  const match = text.match(/(\d+(?:\.\d+)?)\s*([A-Za-z]+)/);
  return match ? { value: parseFloat(match[1]), unit: match[2] } : null;
};

const extractUnitFromParts = (parts: string[]): string | null => {
  const partWithUnit = parts.find((part) => /[A-Za-z]/.test(part));
  const unitMatch = partWithUnit?.match(/([A-Za-z]+)/);
  return unitMatch?.[1] || null;
};

const processRangePart = (part: string, inheritedUnit?: string): number => {
  const trimmedPart = part.trim();
  const parsed = parseValueWithUnit(trimmedPart);

  if (parsed) {
    return convertToBytes(parsed.value, parsed.unit);
  }

  if (inheritedUnit && /^\d+(?:\.\d+)?$/.test(trimmedPart)) {
    return convertToBytes(parseFloat(trimmedPart), inheritedUnit);
  }

  return Infinity;
};

const getSortValue = (category: string): number => {
  if (category.startsWith("<")) return 0;

  if (category.includes("-")) {
    const parts = category.split("-");
    const inheritedUnit = extractUnitFromParts(parts);

    const byteValues = parts.map((part) =>
      processRangePart(part, inheritedUnit || undefined)
    );
    const minBytes = Math.min(...byteValues);

    return minBytes === Infinity ? 0 : minBytes;
  }

  const parsed = parseValueWithUnit(category);
  return parsed ? convertToBytes(parsed.value, parsed.unit) : 0;
};

export const sortByUnitAndValue = (data: number[], categories: string[]) => {
  const sortedItems = categories
    .map((category, index) => ({
      category,
      data: data[index],
      sortValue: getSortValue(category),
    }))
    .sort((a, b) => a.sortValue - b.sortValue);

  return {
    data: sortedItems.map((item) => item.data),
    categories: sortedItems.map((item) => item.category),
  };
};

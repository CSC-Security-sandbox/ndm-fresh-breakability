export const calculateTotal = (values: number[]): string => {
  return tooltipFormatter(
    values.reduce((acc, value) => acc + (parseFloat(value.toString()) || 0), 0)
  );
};

export const formatTotal = (
  total: number,
  unit: string
): { value: string; unit: string } => {
  const [value] = truncateLargeNumber(total).toString().split(" ");
  return {
    value,
    unit,
  };
};

export const truncateLargeNumber = (value: number): string => {
  const [integerPart, decimalPart] = value.toString().split(".");

  if (integerPart.length > 4) {
    return `${integerPart.slice(0, 4)}..`;
  }
  return decimalPart
    ? `${integerPart}.${decimalPart.slice(0, 2)}`
    : integerPart;
};

export const tooltipFormatter = (value: number): string => {
  const [integerPart, decimalPart] = value.toString().split(".");

  return decimalPart
    ? `${integerPart}.${decimalPart.slice(0, 2)}`
    : integerPart;
};

export const legendWrapperTooltipFormatter = (
  value: number,
  unit: string
): string => {
  if (!value || value.toString().length <= 4) {
    return "";
  }

  const formattedValue = `${tooltipFormatter(value)} ${unit || ""}`;
  return formattedValue.trim();
};

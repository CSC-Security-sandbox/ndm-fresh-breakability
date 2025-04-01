export const calculateTotal = (values: number[]): number => {
  return values.reduce(
    (acc, value) => acc + (parseFloat(value.toString()) || 0),
    0
  );
};

export const formatTotal = (
  total: number,
  unit: string
): { value: string; unit: string } => {
  const formattedTotal = parseFloat(total.toString().slice(0, 4));
  const [value] = formattedTotal.toString().split(" ");
  return {
    value,
    unit,
  };
};

export const formattedValue = (value) => {
  const strValue = value.toString();
  const [integerPart, decimalPart] = strValue.split(".");

  if (integerPart.length >= 3) return integerPart.slice(0, 3);

  return decimalPart
    ? `${integerPart}.${decimalPart.slice(0, 2)}`
    : integerPart;
};

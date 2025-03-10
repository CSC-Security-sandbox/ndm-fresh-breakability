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

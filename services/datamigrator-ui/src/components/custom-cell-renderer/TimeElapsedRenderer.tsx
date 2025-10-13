import Box from "@/components/container/Box";

const TimeElapsedRenderer = ({ value: milliseconds }: { value: number }) => {
  if (!milliseconds) {
    return <Box>--</Box>;
  }

  //Get days from milliseconds
  const days = milliseconds / (1000 * 60 * 60 * 24);
  const absoluteDays = Math.floor(days);
  const d = absoluteDays > 9 ? absoluteDays : "0" + absoluteDays;

  //Get remainder from days and convert to hours
  const hours = (days - absoluteDays) * 24;
  const absoluteHours = Math.floor(hours);
  const h = absoluteHours > 9 ? absoluteHours : "0" + absoluteHours;

  //Get remainder from hours and convert to minutes
  const minutes = (hours - absoluteHours) * 60;
  const absoluteMinutes = Math.floor(minutes);
  const m = absoluteMinutes > 9 ? absoluteMinutes : "0" + absoluteMinutes;

  return (
    <Box className="flex gap-2">
      {milliseconds < 1000 * 60 ? (
        <Box>&lt; 1 Min</Box>
      ) : (
        <>
          {absoluteDays !== 0 && <Box>{d} {absoluteDays === 1 ? 'day' : 'days'}</Box>}
          {absoluteHours !== 0 && <Box>{h} {absoluteHours === 1 ? 'hr' : 'hrs'}</Box>}
          {absoluteDays === 0 && absoluteMinutes !== 0 && <Box>{m} {absoluteMinutes === 1 ? 'Min' : 'Mins'}</Box>}
        </>
      )}
    </Box>
  );
};

export default TimeElapsedRenderer;

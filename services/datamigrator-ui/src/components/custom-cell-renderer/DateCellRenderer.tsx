import { format } from "date-fns";
import { Box } from "@/components/container/index";
import { Show } from "@components/show/Show";
import React from "react";

const DateCellRenderer = React.memo(
  ({
    value,
    showSmallerDateFormat = true,
    oneLineDate,
  }: {
    value: any;
    showSmallerDateFormat?: boolean;
    oneLineDate?: boolean;
  }) => {
    return (
      <Show>
        <Show.When isTrue={Boolean(value)}>
          {(() => {
            const trimmedValue = value ? value.slice(0, -1) : undefined;
            if (!trimmedValue) {
              return <Box>-</Box>;
            }
            const dateObj = new Date(trimmedValue);
            if (isNaN(dateObj.getTime())) {
              return <Box>-</Box>;
            }
            const date = format(dateObj, "dd MMM yyyy");
            const time = format(dateObj, "hh:mm:ss aa");
            const timeSmall = format(dateObj, "hh:mm aa");
            return (
              <>
                <Show>
                  <Show.When isTrue={showSmallerDateFormat}>
                    <Box className="flex flex-col">
                      <Box>{date}</Box>
                      <Box>{timeSmall}</Box>
                    </Box>
                  </Show.When>
                  <Show.When isTrue={oneLineDate}>
                    {` ${date} ${timeSmall} UTC`}
                  </Show.When>
                  <Show.When isTrue={!showSmallerDateFormat && !oneLineDate}>
                    <Box className="flex flex-col">
                      <Box>{date}</Box>
                      <Box>{time} UTC</Box>
                    </Box>
                  </Show.When>
                </Show>
              </>
            );
          })()}
        </Show.When>
        <Show.Else>-</Show.Else>
      </Show>
    );
  }
);

export default DateCellRenderer;

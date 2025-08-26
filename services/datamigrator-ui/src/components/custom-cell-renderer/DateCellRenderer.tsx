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
    value: string;
    showSmallerDateFormat?: boolean;
    oneLineDate?: boolean;
  }) => {
    return (
      <Show>
        <Show.When isTrue={Boolean(value)}>
          {(() => {
            const trimmedValue = value.slice(0, -1);
            const date = format(trimmedValue, "dd MMM yyyy");
            const time = format(trimmedValue, "hh:mm:ss aa");
            const timeSmall = format(trimmedValue, "hh:mm aa");
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
                    <Box className="flex">
                      {` ${date}`} {timeSmall}
                    </Box>
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

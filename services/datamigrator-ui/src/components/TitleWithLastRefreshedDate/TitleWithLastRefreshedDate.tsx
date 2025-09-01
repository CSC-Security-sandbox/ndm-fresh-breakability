import React from "react";
import { Box } from "../container";
import DateCellRenderer from "../custom-cell-renderer/DateCellRenderer";
import { Show } from "../show/Show";

const TitleWithLastRefreshedDate = ({
  title = <></>,
  date,
}: {
  title?: React.ReactElement | string;
  date?: Date | string;
}) => {
  return (
    <Box className="flex items-center gap-2">
      <Box>{title}</Box>
      <Show>
        <Show.When isTrue={!!date}>
          <Box className="text-gray-500">
            <Box className="flex gap-2">
              Last Refreshed:{" "}
              <DateCellRenderer
                value={date}
                oneLineDate={true}
                showSmallerDateFormat={false}
              />
            </Box>
          </Box>
        </Show.When>
      </Show>
    </Box>
  );
};

export default TitleWithLastRefreshedDate;

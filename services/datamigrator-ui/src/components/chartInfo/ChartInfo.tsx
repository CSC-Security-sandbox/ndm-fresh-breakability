import { ChartInfoPropsType } from "@/types/app.type";
import ChartError from "@components/chartInfo/ChartError";
import { Box } from "@components/container/index";
import { Show } from "@components/show/Show";
import {
  Card,
  CardContent,
  CardContentLoading,
  CardHeader,
  CardTitle,
} from "@netapp/bxp-design-system-react";
import React from "react";
import { Form } from "react-router-dom";
import DateCellRenderer from "../custom-cell-renderer/DateCellRenderer";

const ChartInfo = React.memo(
  ({
    title,
    Icon,
    children,
    isLoading,
    isError,
    lastRefreshed,
  }: ChartInfoPropsType) => {
    return (
      <Box className="w-full grow">
        <Card className="h-full">
          <CardHeader type="small">
            <ChartTitle
              title={title}
              Icon={Icon}
              lastRefreshed={lastRefreshed}
            />
          </CardHeader>
          <CardContent>
            <Box className="flex gap-8">
              <Show>
                <Show.When isTrue={isLoading}>
                  <CardContentLoading className="h-40" />
                </Show.When>
                <Show.When isTrue={isError}>
                  <ChartError>Failed to load data!</ChartError>
                </Show.When>
                <Show.Else>{children}</Show.Else>
              </Show>
            </Box>
          </CardContent>
        </Card>
      </Box>
    );
  }
);

const ChartTitle = ({
  title,
  Icon,
  lastRefreshed,
}: {
  title: React.ReactNode;
  Icon: React.ElementType;
  lastRefreshed: string | undefined;
}) => {
  return (
    <CardTitle className="flex gap-3 items-center">
      <Icon size="30" />
      <Show>
        <Show.When isTrue={Boolean(lastRefreshed)}>
          <Box className="text-gray-500 flex gap-2">
            <Box className="text-black">{title}</Box>
            <Box className="flex">
              <Box>Last refreshed:</Box>
              <DateCellRenderer
                value={lastRefreshed}
                oneLineDate={true}
                showSmallerDateFormat={false}
              />
            </Box>
          </Box>
        </Show.When>

        <Show.Else>{title}</Show.Else>
      </Show>
    </CardTitle>
  );
};

export default ChartInfo;

import {
  Card,
  CardContent,
  InlineLoader,
  Text,
} from "@netapp/bxp-design-system-react";
import { Box } from "@components/container/index";
import { GraphLoaderType } from "@/types/app.type";

const GraphLoader = ({ label, isLoading, children }: GraphLoaderType) => {
  if (isLoading) {
    return (
      <Box className="m-8">
        <Card>
          <CardContent>
            <Text>Loading {label}.. </Text>
            <InlineLoader className="m-auto" />
          </CardContent>
        </Card>
      </Box>
    );
  }

  return <>{children}</>;
};

export default GraphLoader;

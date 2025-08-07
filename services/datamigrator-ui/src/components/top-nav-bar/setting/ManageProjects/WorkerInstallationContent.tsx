import React from "react";
import {
  Layout,
  Card,
  Text,
  CardContent,
  NumberedList,
  CodeSnippet,
  InlineLoader,
} from "@netapp/bxp-design-system-react";
import { WORKER_SCRIPT_PATH } from "@/constant/app.constants";
import Box from "@/components/container/Box";

const WorkerInstallationContent = ({
  workerSecret,
  projectId,
  controlPlaneIp,
  workerId,
  isLoading,
  isError,
}: {
  controlPlaneIp?: string;
  projectId?: string;
  workerId?: string;
  workerSecret?: string;
  isLoading?: boolean;
  isError?: boolean;
}) => (
  <Layout.Content>
    <Layout.Grid rowGap="md" style={{ margin: "10px" }}>
      <Layout.GridItem lg={12}>
        <Layout.Content>
          <Layout.Container>
            <Layout.Grid>
              <Layout.GridItem lg={12}>
                <NumberedList includeTitles={true}>
                  <>
                    <Text bold>Download Image</Text>
                    <Text>
                      Download worker virtual machine image from{" "}
                      <a href="#">here</a>
                    </Text>
                  </>
                  <>
                    <Text bold>Setup VM</Text>
                    <Text>
                      Create a new virtual machine following{" "}
                      <a href="#">these pre-requisites</a>
                    </Text>
                  </>
                  <>
                    <Text bold>Register</Text>
                    <Text>
                      Login to the VM as root and run command mentioned below
                    </Text>
                  </>
                </NumberedList>
              </Layout.GridItem>
            </Layout.Grid>
          </Layout.Container>
        </Layout.Content>
      </Layout.GridItem>
      <Layout.GridItem lg={12}>
        <Card>
          <CardContent>
            {isLoading ? (
              <InlineLoader />
            ) : isError ? (
              <Box>Failed to generate worker secrets</Box>
            ) : (
              <CodeSnippet
                highLightLanguage={"bash"}
                text={`export WORKER_ID=${workerId}
export WORKER_SECRET=${workerSecret}
export PROJECT_ID=${projectId}
export CONTROL_PLANE_IP=${controlPlaneIp}
sh ${WORKER_SCRIPT_PATH}`}
              />
            )}
          </CardContent>
        </Card>
      </Layout.GridItem>
    </Layout.Grid>
  </Layout.Content>
);

export default WorkerInstallationContent;

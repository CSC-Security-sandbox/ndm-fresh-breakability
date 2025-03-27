import { Box } from "@components/container/index";
import { Card, Text } from "@netapp/bxp-design-system-react";
import Icon from "/laptop-icon.svg";
import CreateProjectButton from "@modules/create-first-project/components/CreateProjectButton";

interface DefaultProjectScreenPropsType {
  showCreateProject: boolean;
  setShowCreateProject: (arg: boolean) => void;
}

const DefaultProjectScreen = ({
  showCreateProject,
  setShowCreateProject,
}: DefaultProjectScreenPropsType) => {
  return (
    <Box className="flex items-center justify-center h-screen">
      <Box className="w-3/6">
        <img
          src={Icon}
          height={265}
          width={371}
          alt="laptop-icon"
          className="m-auto"
        />
        <Card className="flex flex-col gap-5 items-center p-8">
          <Box className="font-semibold text-xl">Create A New Project</Box>
          <Text>
            Create first project for you. You can add more projects from project
            listing screen.
          </Text>
          <CreateProjectButton
            showCreateProject={showCreateProject}
            setShowCreateProject={setShowCreateProject}
          />
        </Card>
      </Box>
    </Box>
  );
};

export default DefaultProjectScreen;

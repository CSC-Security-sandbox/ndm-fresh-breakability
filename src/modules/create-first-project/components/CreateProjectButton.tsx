import { Button } from "@netapp/bxp-design-system-react";

interface CreateProjectButtonPropsType {
  showCreateProject: boolean;
  setShowCreateProject: (arg: boolean) => void;
}

const CreateProjectButton = ({
  showCreateProject,
  setShowCreateProject,
}: CreateProjectButtonPropsType) => {
  return (
    <Button onClick={() => setShowCreateProject(true)}>Create Project</Button>
  );
};

export default CreateProjectButton;

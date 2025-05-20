import { useEffect, useState } from "react";
import Collapse from "@mui/material/Collapse";
import DefaultProjectScreen from "@modules/create-first-project/components/DefaultProjectScreen";
import EmptyNavBar from "@modules/create-first-project/components/EmptyNavBar";
import DefaultCreateProjectForm from "@modules/create-first-project/components/DefaultCreateProjectForm";
import { useDispatch } from "react-redux";
import { setProject } from "@store/reducer/appSlice";

const CreateFirstProject = () => {
  const dispatch = useDispatch();
  const [showCreateProject, setShowCreateProject] = useState<boolean>(false);
  useEffect(() => {
    dispatch(setProject(""));
  }, []);

  return (
    <>
      <EmptyNavBar />
      <Collapse in={showCreateProject}>
        <DefaultCreateProjectForm />
      </Collapse>
      <Collapse in={!showCreateProject}>
        <DefaultProjectScreen
          showCreateProject={showCreateProject}
          setShowCreateProject={setShowCreateProject}
        />
      </Collapse>
    </>
  );
};

export default CreateFirstProject;

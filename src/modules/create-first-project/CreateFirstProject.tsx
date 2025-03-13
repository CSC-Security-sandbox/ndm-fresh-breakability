import { useEffect, useState } from "react";
import Collapse from "@mui/material/Collapse";
import DefaultProjectScreen from "./components/DefaultProjectScreen";
import EmptyNavBar from "./components/EmptyNavBar";
import DefaultCreateProjectForm from "./components/DefaultCreateProjectForm";
import { useDispatch } from "react-redux";
import { setProject } from "@store/reducer/appSlice";
import { Box } from "@components/container";

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
      <Box id="step-footer-first-project" className="fixed bottom-0"></Box>
    </>
  );
};

export default CreateFirstProject;

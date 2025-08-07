/* eslint-disable */
import Box from "@/components/container/Box";
import { copyToClipboard } from "@/utils/copyToClipboard";
import FormControl from "@mui/material/FormControl";
import {
  ActionMenu,
  Button,
  Layout,
  RadioButton,
  SearchWidget,
  Text,
  useForm,
  WizardFooter,
  WizardHeader,
} from "@netapp/bxp-design-system-react";
import { CopyIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { nanoid } from "@reduxjs/toolkit";
import { setProject } from "@store/reducer/appSlice";
import { setDrawerClose } from "@store/reducer/commonComponentSlice";
import React, { useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  setModalClose,
  setModalProps,
} from "@store/reducer/commonComponentSlice";
import { FILE_SERVER_BULK_OPERATION_PATHS } from "@components/top-nav-bar/switch-project/SwitchProject.constant";

const DetailButton = ({ projectId }: { projectId: string }) => (
  <ActionMenu
    horizontalPlacement="end"
    verticalPlacement="bottom"
    Trigger="oval-hidden"
  >
    <ActionMenu.CopyButton
      label="Project ID"
      value={projectId}
      tooltip={projectId}
    ></ActionMenu.CopyButton>
  </ActionMenu>
);

const SwitchProjectContent = ({ projectList, selectedProjectId }: any) => {
  const [search, setSearch] = useState<string>("");
  const dispatch = useDispatch();
  const switchProjectForm = useForm({ selectedProjectId: selectedProjectId });
  const navigate = useNavigate();
  const currentPath = window.location.pathname;

  const checkFileServerBulkOperationPaths = () => {
    return FILE_SERVER_BULK_OPERATION_PATHS.some((path) =>
      currentPath.includes(path)
    );
  };

  const submitProject = () => {
    const isPathIncluded = checkFileServerBulkOperationPaths();
    if (isPathIncluded) {
      dispatch(
        setModalProps({
          isOpen: true,
          modalHeader: "Switch Project Confirmation",
          modalContent:
            "Are you sure you want to switch projects? You may lose unsaved data.",
          modalFooter: (
            <>
              <Button
                color="secondary"
                onClick={() => dispatch(setModalClose())}
              >
                Cancel
              </Button>
              <Button onClick={switchProject}>Proceed</Button>
            </>
          ),
        })
      );
    } else {
      closeDrawer();
    }
  };

  const switchProject = () => {
    dispatch(setModalClose());
    closeDrawer();
  };

  const closeDrawer = () => {
    dispatch(setProject(switchProjectForm.formState.selectedProjectId));
    dispatch(setDrawerClose());
    navigate("/home");
  };

  return (
    <Layout.Page>
      <WizardHeader label="Project" />
      <Layout.Content style={{ padding: 40 }}>
        <SearchWidget
          placeholder={`Search Projects`}
          alwaysOpen
          setFilter={(value: string) => {
            setSearch(value);
          }}
        />
        <FormControl className="w-full">
          {projectList
            ?.filter((item: any) =>
              item["project_name"]
                .toLowerCase()
                .includes(search.toLowerCase().trim())
            )
            ?.map((item: any) => (
              <Box
                className="flex flex-row justify-between items-center py-3 border-b"
                key={nanoid()}
              >
                <RadioButton
                  form={switchProjectForm}
                  name="selectedProjectId"
                  value={item.id}
                  className="w-full"
                >
                  {item?.["project_name"]}
                </RadioButton>
                <DetailButton projectId={item.id} />
              </Box>
            ))}
        </FormControl>
      </Layout.Content>
      <WizardFooter>
        <Box className="flex w-full justify-around px-8 pt-1">
          <Button className="w-56" onClick={submitProject}>
            Switch
          </Button>
          <Button
            className="w-56"
            color="secondary"
            onClick={() => dispatch(setDrawerClose())}
          >
            Cancel
          </Button>
        </Box>
      </WizardFooter>
    </Layout.Page>
  );
};

export default React.memo(SwitchProjectContent);

import { Box } from "@components/container/index";
import { Button } from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import { useCreateFileServerForSpeedTestMutation } from "@api/jobsApi";
import { SpeedTestConfigurationContext } from "@modules/speed-test/context/SpeedTestConfigurationContext";
import { notify } from "@components/notification/NotificationWrapper";
import { useSelector } from "react-redux";
import { RootStateType } from "@store/store";
import { transformData } from "@modules/speed-test/utils/SpeedTestFormFooter.utils";
import {
  SPEED_TEST_ERROR,
  SPEED_TEST_SUCCESS,
} from "@modules/speed-test/constants/speed-test.constants";
import { useNavigate } from "react-router-dom";

const SpeedTestFormFooter = () => {
  const navigate = useNavigate();
  const [createFileServer] = useCreateFileServerForSpeedTestMutation();
  const { speedTestConfiguration } = useContext(SpeedTestConfigurationContext);
  const projectId = useSelector(
    (state: RootStateType) => state.appSlice.project
  );

  const handleCancel = () => {
    navigate("/speed-test");
  };

  const handleSubmit = () => {
    const transformedData = transformData({
      speedTestConfigurationData: speedTestConfiguration,
      projectId,
    });
    (async () => {
      try {
        await createFileServer(transformedData).unwrap();
        notify.success(SPEED_TEST_SUCCESS);
      } catch {
        notify.error(SPEED_TEST_ERROR);
      }
    })();
    navigate("/speed-test");
  };

  return (
    <Box className="flex gap-3">
      <Button color="secondary" className="w-[152px]" onClick={handleCancel}>
        Cancel
      </Button>
      <Button
        className="w-[152px]"
        onClick={handleSubmit}
        disabled={speedTestConfiguration.length == 0}
      >
        Submit
      </Button>
    </Box>
  );
};

export default SpeedTestFormFooter;

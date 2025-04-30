import { useJobAdhocRunMutation } from "@api/jobsApi";
import { notify } from "@components/notification/NotificationWrapper";
import { Box } from "@components/container";
import { Text } from "@netapp/bxp-design-system-react";

const useAdhocRun = () => {
  const [adhocRunApi] = useJobAdhocRunMutation();

  const jobAdhocRun = async (jobConfigId: string, isAdhocRun?: boolean) => {
    const successMessage = isAdhocRun
      ? "Successfully initiated an ad-hoc run"
      : "Successfully initiated the job run.";
    const errorMessage = isAdhocRun
      ? "Fail to initiate the ad-hoc run."
      : "Fail to initiate the job run.";

    try {
      await adhocRunApi({ jobConfigId }).unwrap();
      notify.success(successMessage);
    } catch (err) {
      console.error(err);
      notify.error(
        <Box className="flex flex-col">
          <Text>{errorMessage}</Text>
          <Text className="italic">
            {err?.message || err?.data?.message || "Unknown error."}
          </Text>
        </Box>
      );
    }
  };

  return jobAdhocRun;
};

export default useAdhocRun;

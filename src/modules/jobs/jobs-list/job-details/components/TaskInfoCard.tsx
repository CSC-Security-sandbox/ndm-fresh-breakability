import { Box } from "@components/container/index";
import { TaskInfoCardPropType } from "@/types/app.type";
import { Button, Text } from "@netapp/bxp-design-system-react";
import { useNavigate } from "react-router-dom";

const TaskInfoCard = ({ label, value, url }: TaskInfoCardPropType) => {
  const navigate = useNavigate();

  return (
    <Box className="flex flex-col grow">
      <Button variant="text" onClick={() => navigate(url)}>
        {value}
      </Button>
      <Text>{label}</Text>
    </Box>
  );
};

export default TaskInfoCard;

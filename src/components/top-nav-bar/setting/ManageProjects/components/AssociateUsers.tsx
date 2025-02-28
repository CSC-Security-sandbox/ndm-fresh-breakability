import Box from "@/components/container/Box";
import AssociatedUsers from "./AssociatedUserList";
import { FormFieldSelect, Button, Text } from "@netapp/bxp-design-system-react";
import { AddIcon } from "@netapp/bxp-style/react-icons/Action";
import { AssociatedUsersPropsType } from "@/types/app.type";

const AssociateUsers = ({
  associateUserForm,
  associatedUsers,
  userOptions,
  roleOptions,
  submitUserAction,
  removeUserAction,
}: AssociatedUsersPropsType) => {
  return (
    <>
      <Box className="w-full flex flex-col gap-1">
        <Text bold>Associate Users</Text>

        <Box className="flex pt-4 flex-row gap-4 w-full">
          <FormFieldSelect
            label="User"
            name="user"
            isSearchable={true}
            form={associateUserForm}
            options={userOptions?.filter(
              (row: any) =>
                !associatedUsers?.find((row2) => row2.user.value === row.value)
            )}
          />
          <FormFieldSelect
            label="Role"
            name="role"
            form={associateUserForm}
            options={roleOptions}
          />
        </Box>
      </Box>
      <Box className="flex justify-end">
        <Button
          onClick={submitUserAction}
          disabled={!(associateUserForm.isValid && associateUserForm.dirty)}
        >
          <Box className="flex">
            <AddIcon style={{ width: 18, height: 18 }} />
            <Box>Add</Box>
          </Box>
        </Button>
      </Box>
      <Box className="flex pt-4 flex-col gap-2 w-full">
        <AssociatedUsers
          tableRows={associatedUsers}
          removeUserAction={removeUserAction}
        />
      </Box>
    </>
  );
};

export default AssociateUsers;

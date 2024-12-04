export enum ProjectDescriptions {
  CreateProjectsDescription = 'This endpoint is used to create a new project with the provided details. ' +
    'You need to include the project details in the request body, and the API will return the created project object. \n\n' +
    '**Request Body Parameters**:\n' +
    '- **project_name** (required): The name of the project.\n' +
    '- **start_date** (required): The start date of the project in ISO 8601 format.\n' +
    '- **created_by** (required): The UUID of the user creating the project.\n' +
    '- **account** (required): The ID of the account associated with the project.\n\n' +
    '**How to Use**:\n' +
    '- Send a POST request to the `/api/v1/projects` endpoint with the project details as a JSON object in the request body.\n' +
    '- Ensure all required fields are included and correctly formatted.\n\n' +
    '**Response Details**:\n' +
    '- On successful creation, the API returns the newly created project object with its generated ID.\n' +
    '- If any required field is missing or the provided data is invalid, the API responds with a 400 Bad Request error.\n' +
    '- Server errors or permission issues will result in a 500 Internal Server Error.\n\n' +
    'This endpoint allows adding new projects to the system and associating them with accounts while tracking their start dates.',

  GetAllProjects = 'This endpoint retrieves a paginated list of all projects stored in the system. ' +
    'You can filter the results based on various parameters, allowing you to manage and view projects effectively.\n\n' +
    '**Query Parameters**:\n' +
    '- **page** (optional): The page number of the results to retrieve (default is 1).\n' +
    '- **limit** (optional): The number of projects per page (default is 10).\n' +
    '- **sort** (optional): The field by which to sort the projects (e.g., project_name).\n' +
    '- **order** (optional): The sorting order, either ascending or descending.\n' +
    '- **account** (optional): Filter projects by a specific account ID.\n\n' +
    '**How to Use**:\n' +
    '- Send a GET request to the `/api/v1/projects` endpoint with the desired query parameters.\n' +
    '- Ensure parameters are correctly formatted for filtering and sorting.\n\n' +
    '**Response Details**:\n' +
    '- The API returns a JSON object containing a list of projects along with pagination metadata (total count, current page, etc.).\n' +
    '- If no projects match the criteria, an empty list is returned.\n\n' +
    'This endpoint is useful for retrieving and displaying all projects for better project management.',

  GetProjectById = 'This endpoint fetches the details of a specific project identified by its unique ID. ' +
    'It allows users to view project information in detail.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the project to retrieve.\n\n' +
    '**How to Use**:\n' +
    '- Send a GET request to the `/api/v1/projects/{id}` endpoint, replacing `{id}` with the actual project ID.\n' +
    '- Ensure the ID is correctly formatted.\n\n' +
    '**Response Details**:\n' +
    '- On success, the API returns a JSON object with the project’s details.\n' +
    '- If the project with the specified ID is not found, a 404 Not Found error is returned.\n\n' +
    'This endpoint is essential for accessing detailed information about specific projects.',

  GetProjectsByAccountId = 'This endpoint retrieves a paginated list of projects associated with a specific account. ' +
    'You can filter and sort the projects to manage and view them effectively based on the account.\n\n' +
    '**Path Parameters**:\n' +
    '- **account_id** (required): The unique identifier of the account whose projects you want to retrieve.\n\n' +
    '**Query Parameters**:\n' +
    '- **page** (optional): The page number of the results to retrieve (default is 1).\n' +
    '- **limit** (optional): The number of projects per page (default is 10).\n' +
    '- **sortField** (optional): The field by which to sort the projects (e.g., project_name).\n' +
    '- **sortOrder** (optional): The sorting order, either ascending or descending.\n' +
    '- **filter** (optional): Filter conditions to apply when retrieving projects.\n\n' +
    '**How to Use**:\n' +
    '- Send a GET request to the `/api/v1/projects/accounts/{account_id}/projects` endpoint, replacing `{account_id}` with the actual account ID.\n' +
    '- Ensure the parameters are correctly formatted for filtering and sorting.\n\n' +
    '**Response Details**:\n' +
    '- The API returns a JSON object containing a list of projects associated with the specified account, along with pagination metadata (total count, current page, etc.).\n' +
    '- If no projects are found for the account, an empty list is returned.\n\n' +
    'This endpoint is essential for managing projects within specific accounts, allowing for effective project tracking and oversight.',

  UpdateProjectById = 'This endpoint updates the details of an existing project identified by its unique ID. ' +
    'You need to provide the updated project details in the request body.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the project to update.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **project_name** (optional): The updated name of the project.\n' +
    '- **start_date** (optional): The updated start date of the project in ISO 8601 format.\n' +
    '- **account** (optional): The updated account ID associated with the project.\n\n' +
    '**How to Use**:\n' +
    '- Send a PUT request to the `/api/v1/projects/{id}` endpoint with the updated project details as a JSON object in the request body.\n' +
    '- Ensure that the project ID is in the URL and the request body includes valid fields.\n\n' +
    '**Response Details**:\n' +
    '- On successful update, the API returns the updated project object.\n' +
    '- If the project is not found, a 404 Not Found error is returned.\n' +
    '- Validation errors will result in a 400 Bad Request error.\n\n' +
    'This endpoint is crucial for maintaining accurate and up-to-date project information.',

  DeleteProjectById = 'This endpoint deletes an existing project from the system using its unique ID. ' +
    'It is a destructive operation that permanently removes the project.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the project to delete.\n\n' +
    '**How to Use**:\n' +
    '- Send a DELETE request to the `/api/v1/projects/{id}` endpoint, replacing `{id}` with the actual project ID.\n' +
    '- Ensure that you have the necessary permissions to perform this operation.\n\n' +
    '**Response Details**:\n' +
    '- On successful deletion, the API returns a confirmation message indicating the project has been deleted.\n' +
    '- If the project is not found, a 404 Not Found error is returned.\n' +
    '- Permission errors will result in a 403 Forbidden error.\n\n' +
    'This endpoint is essential for managing project lifecycles by allowing deletions of obsolete or incorrect projects.',

  InactivateProjectById = 'This endpoint allows you to mark an existing project as inactive using its unique ID. ' +
    'This does not delete the project but rather updates its status to indicate it is no longer active.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the project to inactivate.\n\n' +
    '**How to Use**:\n' +
    '- Send a PATCH request to the `/api/v1/projects/{id}/inactive` endpoint, replacing `{id}` with the actual project ID.\n' +
    '- Ensure that you have the necessary permissions to perform this operation.\n\n' +
    '**Response Details**:\n' +
    '- On successful inactivation, the API returns the updated project object with its status set to inactive.\n' +
    '- If the project with the specified ID is not found, a 404 Not Found error is returned.\n' +
    '- If the project is already inactive, the API may return a 400 Bad Request error.\n\n' +
    'This endpoint is useful for managing project lifecycles by allowing the system to track inactive projects without deleting them.',
}

export enum UserDescriptions {
  CreateUsersDescription = 'This endpoint is used to create a new user with the provided details. ' +
    'You need to include user details in the request body, and the API will return the created user object.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **email** (required): The email address of the user.\n' +
    '- **user_status** (optional, default: "active"): The current status of the user account (e.g., active, inactive).\n' +
    '- **role** (required): The ID of the role assigned to the user. This establishes a relation in the user-role table.\n' +
    '- **project** (required): The ID of the project the user is associated with. This helps in project management.\n' +
    '- **account** (required): The ID of the account associated with the new user.\n\n' +
    '**How to Use**:\n' +
    '- Send a POST request to the `/api/v1/users` endpoint with the user details as a JSON object in the request body.\n' +
    '- Ensure all required fields are included and correctly formatted.\n\n' +
    '**Response Details**:\n' +
    '- On successful creation, the API returns the newly created user object with its generated ID.\n' +
    '- If any required field is missing or the provided data is invalid, the API responds with a 400 Bad Request error.\n' +
    '- Server errors or permission issues will result in a 500 Internal Server Error.\n\n' +
    'This endpoint allows adding new users to the system with specified roles and project associations.',

  GetAllUsers = 'This endpoint retrieves a paginated list of all users stored in the system. ' +
    'You can filter the results based on various parameters, allowing you to manage and view users effectively.\n\n' +
    '**Query Parameters**:\n' +
    '- **page** (optional): The page number of the results to retrieve (default is 1).\n' +
    '- **limit** (optional): The number of users per page (default is 10).\n' +
    '- **sort** (optional): The field by which to sort the users (e.g., userName).\n' +
    '- **order** (optional): The sorting order, either ascending or descending.\n\n' +
    '**How to Use**:\n' +
    '- Send a GET request to the `/api/v1/users` endpoint with the desired query parameters.\n' +
    '- Ensure parameters are correctly formatted for filtering and sorting.\n\n' +
    '**Response Details**:\n' +
    '- The API returns a JSON object containing a list of users along with pagination metadata (total count, current page, etc.).\n' +
    '- If no users match the criteria, an empty list is returned.\n\n' +
    'This endpoint is useful for retrieving and displaying all users for better user management.',

  GetUserById = 'This endpoint fetches the details of a specific user identified by their unique ID. ' +
    'It allows users to view user information in detail.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the user to retrieve.\n\n' +
    '**How to Use**:\n' +
    '- Send a GET request to the `/api/v1/users/{id}` endpoint, replacing `{id}` with the actual user ID.\n' +
    '- Ensure the ID is correctly formatted.\n\n' +
    '**Response Details**:\n' +
    '- On success, the API returns a JSON object with the user’s details.\n' +
    '- If the user with the specified ID is not found, a 404 Not Found error is returned.\n\n' +
    'This endpoint is essential for accessing detailed information about specific users.',

  UpdateUserById = 'This endpoint updates the details of an existing user identified by their unique ID. ' +
    'You need to provide the updated user details in the request body.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the user to update.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **email** (optional): The updated email address of the user.\n' +
    '- **user_status** (optional): The updated status of the user account.\n' +
    '- **roleId** (optional): The updated role ID associated with the user, establishing a relationship in the user-role table.\n' +
    '- **projectId** (optional): The updated project ID the user is associated with.\n' +
    '- **accountId** (optional): The updated account ID associated with the user.\n\n' +
    '**How to Use**:\n' +
    '- Send a PUT request to the `/api/v1/users/{id}` endpoint with the updated user details as a JSON object in the request body.\n' +
    '- Ensure that the user ID is in the URL and the request body includes valid fields.\n\n' +
    '**Response Details**:\n' +
    '- On successful update, the API returns the updated user object.\n' +
    '- If the user is not found, a 404 Not Found error is returned.\n' +
    '- Validation errors will result in a 400 Bad Request error.\n\n' +
    'This endpoint is crucial for maintaining accurate and up-to-date user information.',

  DeleteUserById = 'This endpoint deletes an existing user from the system using their unique ID. ' +
    'It is a destructive operation that permanently removes the user.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the user to delete.\n\n' +
    '**How to Use**:\n' +
    '- Send a DELETE request to the `/api/v1/users/{id}` endpoint, replacing `{id}` with the actual user ID.\n' +
    '- Ensure that you have the necessary permissions to perform this operation.\n\n' +
    '**Response Details**:\n' +
    '- On successful deletion, the API returns a confirmation message indicating the user has been deleted.\n' +
    '- If the user is not found, a 404 Not Found error is returned.\n' +
    '- Permission errors will result in a 403 Forbidden error.\n\n' +
    'This endpoint is essential for managing user lifecycles by allowing deletions of obsolete or incorrect users.',

  InactivateUserById = 'This endpoint inactivates an existing user by setting their status to inactive. ' +
    'This operation does not delete the user from the system but rather marks them as inactive, allowing for potential reactivation in the future.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the user to be inactivated.\n\n' +
    '**How to Use**:\n' +
    '- Send a PATCH request to the `/api/v1/users/{id}/inactivate` endpoint, replacing `{id}` with the actual user ID.\n' +
    '- Ensure that the request is authenticated and that the user has the necessary permissions to inactivate another user.\n\n' +
    '**Response Details**:\n' +
    '- On successful inactivation, the API returns a confirmation message indicating that the user has been successfully inactivated.\n' +
    '- If the user with the specified ID does not exist, a 404 Not Found error is returned.\n' +
    '- Permission errors will result in a 403 Forbidden error.\n\n' +
    'This endpoint is crucial for managing user accounts, especially in cases where users should no longer have access but are not to be permanently deleted.',

  GetUserPermissionsDescription = 'This endpoint retrieves the permissions of a user based on the provided email and optional project ID. ' +
    'If a project ID is provided, the API will return the user’s role and permissions specifically for that project. ' +
    'If no project ID is provided, the API will return all projects associated with the user and their corresponding permissions.\n\n' +
    '**Query Parameters**:\n' +
    '- **email** (required): The email address of the user. This is used to identify the user whose permissions you wish to retrieve.\n' +
    '- **projectId** (optional): The ID of a specific project. If provided, the response will include the user’s permissions for that project only.\n\n' +
    '**How to Use**:\n' +
    '- Send a GET request to the `/api/v1/users/permissions` endpoint with the required `email` parameter and an optional `projectId` parameter.\n' +
    '- If `projectId` is omitted, the API returns a list of projects associated with the user along with their respective permissions.\n\n' +
    '**Response Details**:\n' +
    '- If a `projectId` is provided, the API returns the user’s role and permissions for the specified project.\n' +
    '- If no `projectId` is provided, the API returns all associated projects along with the roles and permissions for each project.\n' +
    '- If the user is not found, or if there are any issues with the provided data, a 400 Bad Request error is returned.\n' +
    '- In case of any internal errors, the API responds with a 500 Internal Server Error.\n\n' +
    'This endpoint allows retrieval of user permissions for specific projects or across all projects they are associated with.'

}

export enum AccountDescription {
  CreateAccountDescription = 'This endpoint is used to create a new account with the provided details. ' +
    'You need to include the account details in the request body, and the API will return the created account object.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **account_name** (required): The name of the account to be created.\n\n' +
    '**How to Use**:\n' +
    '- Send a POST request to the `/api/v1/accounts` endpoint with the account details as a JSON object in the request body.\n' +
    '- Ensure all required fields are included and correctly formatted.\n\n' +
    '**Response Details**:\n' +
    '- On successful creation, the API returns the newly created account object with its generated ID.\n' +
    '- If any required field is missing or the provided data is invalid, the API responds with a 400 Bad Request error.\n' +
    '- Server errors or permission issues will result in a 500 Internal Server Error.\n\n' +
    'This endpoint allows adding new accounts to the system, enabling organizational management.',

  GetAllAccountsDescription = 'This endpoint retrieves a paginated list of all accounts stored in the system. ' +
    'You can filter the results based on various parameters, allowing you to manage and view accounts effectively.\n\n' +
    '**Query Parameters**:\n' +
    '- **page** (optional): The page number of the results to retrieve (default is 1).\n' +
    '- **limit** (optional): The number of accounts per page (default is 10).\n' +
    '- **sort** (optional): The field by which to sort the accounts (e.g., account_name).\n' +
    '- **order** (optional): The sorting order, either ascending or descending.\n\n' +
    '**How to Use**:\n' +
    '- Send a GET request to the `/api/v1/accounts` endpoint with the desired query parameters.\n' +
    '- Ensure parameters are correctly formatted for filtering and sorting.\n\n' +
    '**Response Details**:\n' +
    '- The API returns a JSON object containing a list of accounts along with pagination metadata (total count, current page, etc.).\n' +
    '- If no accounts match the criteria, an empty list is returned.\n\n' +
    'This endpoint is useful for retrieving and displaying all accounts for better organizational management.',

  UpdateAccountDescription = 'This endpoint updates the details of an existing account identified by its unique ID. ' +
    'You need to provide the updated account details in the request body.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the account to update.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **account_name** (optional): The updated name of the account.\n\n' +
    '**How to Use**:\n' +
    '- Send a PUT request to the `/api/v1/accounts/{id}` endpoint with the updated account details as a JSON object in the request body.\n' +
    '- Ensure that the account ID is in the URL and the request body includes valid fields.\n\n' +
    '**Response Details**:\n' +
    '- On successful update, the API returns the updated account object.\n' +
    '- If the account is not found, a 404 Not Found error is returned.\n' +
    '- Validation errors will result in a 400 Bad Request error.\n\n' +
    'This endpoint is crucial for maintaining accurate and up-to-date account information.',

  getAccountByIdDescription = 'This endpoint retrieves the details of a specific account identified by its unique ID. ' +
    'It allows users to view account information in detail.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the account to retrieve.\n\n' +
    '**How to Use**:\n' +
    '- Send a GET request to the `/api/v1/accounts/{id}` endpoint, replacing `{id}` with the actual account ID.\n' +
    '- Ensure the ID is correctly formatted.\n\n' +
    '**Response Details**:\n' +
    '- On success, the API returns a JSON object with the account’s details.\n' +
    '- If the account with the specified ID is not found, a 404 Not Found error is returned.\n\n' +
    'This endpoint is essential for accessing detailed information about specific accounts.',

  DeleteAccountDescription = 'This endpoint deletes an existing account from the system using its unique ID. ' +
    'It is a destructive operation that permanently removes the account.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the account to delete.\n\n' +
    '**How to Use**:\n' +
    '- Send a DELETE request to the `/api/v1/accounts/{id}` endpoint, replacing `{id}` with the actual account ID.\n' +
    '- Ensure that you have the necessary permissions to perform this operation.\n\n' +
    '**Response Details**:\n' +
    '- On successful deletion, the API returns a confirmation message indicating the account has been deleted.\n' +
    '- If the account is not found, a 404 Not Found error is returned.\n' +
    '- Permission errors will result in a 403 Forbidden error.\n\n' +
    'This endpoint is essential for managing account lifecycles by allowing deletions of obsolete or incorrect accounts.',
}

export enum PermissionDescription {
  CreatePermissionDescription = 'This endpoint is used to create a new permission with the provided details. ' +
    'You need to include the permission details in the request body, and the API will return the created permission object.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **permission_name** (required): The name of the permission (max length: 80 characters).\n' +
    '- **permission_status** (optional): The status of the permission (default is "active").\n\n' +
    '**How to Use**:\n' +
    '- Send a POST request to the `/api/v1/permission` endpoint with the permission details as a JSON object in the request body.\n' +
    '- Ensure all required fields are included and correctly formatted.\n\n' +
    '**Response Details**:\n' +
    '- On successful creation, the API returns the newly created permission object with its generated ID.\n' +
    '- If any required field is missing or the provided data is invalid, the API responds with a 400 Bad Request error.\n' +
    '- Server errors or permission issues will result in a 500 Internal Server Error.\n\n' +
    'This endpoint allows adding new permissions to the system.',

  GetAllPermissionsDescription = 'This endpoint retrieves a list of all active permissions stored in the system. ' +
    'You can filter the results based on various parameters for better management.\n\n' +
    '**How to Use**:\n' +
    '- Send a GET request to the `/api/v1/permission` endpoint.\n' +
    '- Ensure that any filtering parameters are correctly formatted, if applicable.\n\n' +
    '**Response Details**:\n' +
    '- The API returns a JSON object containing a list of permissions.\n' +
    '- If no permissions are found, an empty list is returned.\n\n' +
    'This endpoint is useful for retrieving all permissions for better access control management.',

  GetPermissionByIdDescription = 'This endpoint retrieves the details of a specific permission identified by its unique ID. ' +
    'It allows users to view permission information in detail.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the permission to retrieve.\n\n' +
    '**How to Use**:\n' +
    '- Send a GET request to the `/api/v1/permission/{id}` endpoint, replacing `{id}` with the actual permission ID.\n' +
    '- Ensure the ID is correctly formatted.\n\n' +
    '**Response Details**:\n' +
    '- On success, the API returns a JSON object with the permission’s details.\n' +
    '- If the permission with the specified ID is not found, a 404 Not Found error is returned.\n\n' +
    'This endpoint is essential for accessing detailed information about specific permissions.',

  UpdatePermissionDescription = 'This endpoint updates the details of an existing permission identified by its unique ID. ' +
    'You need to provide the updated permission details in the request body.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the permission to update.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **permission_name** (optional): The updated name of the permission (max length: 80 characters).\n' +
    '- **permission_status** (optional): The updated status of the permission.\n\n' +
    '**How to Use**:\n' +
    '- Send a PUT request to the `/api/v1/permission/{id}` endpoint with the updated permission details as a JSON object in the request body.\n' +
    '- Ensure that the permission ID is in the URL and the request body includes valid fields.\n\n' +
    '**Response Details**:\n' +
    '- On successful update, the API returns a confirmation message indicating the permission has been updated.\n' +
    '- If the permission is not found, a 404 Not Found error is returned.\n' +
    '- Validation errors will result in a 400 Bad Request error.\n\n' +
    'This endpoint is crucial for maintaining accurate and up-to-date permission information.',

  DeletePermissionDescription = 'This endpoint deletes an existing permission from the system using its unique ID. ' +
    'It is a destructive operation that permanently removes the permission.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the permission to delete.\n\n' +
    '**How to Use**:\n' +
    '- Send a DELETE request to the `/api/v1/permission/{id}` endpoint, replacing `{id}` with the actual permission ID.\n' +
    '- Ensure that you have the necessary permissions to perform this operation.\n\n' +
    '**Response Details**:\n' +
    '- On successful deletion, the API returns a confirmation message indicating the permission has been deleted.\n' +
    '- If the permission is not found, a 404 Not Found error is returned.\n' +
    '- Permission errors will result in a 403 Forbidden error.\n\n' +
    'This endpoint is essential for managing permission lifecycles by allowing deletions of obsolete or incorrect permissions.',

  InactivatePermissionDescription = 'This endpoint inactivates an existing permission identified by its unique ID. ' +
    'It updates the status of the permission to inactive without deleting it.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the permission to inactivate.\n\n' +
    '**How to Use**:\n' +
    '- Send a PATCH request to the `/api/v1/permission/{id}/inactivate` endpoint, replacing `{id}` with the actual permission ID.\n' +
    '- Ensure that you have the necessary permissions to perform this operation.\n\n' +
    '**Response Details**:\n' +
    '- On successful inactivation, the API returns a confirmation message indicating the permission has been inactivated.\n' +
    '- If the permission is not found, a 404 Not Found error is returned.\n' +
    '- Permission errors will result in a 403 Forbidden error.\n\n' +
    'This endpoint allows for the temporary disabling of permissions without deletion.',
}

export enum RoleDescription {
  CreateRoleDescription = 'This endpoint is used to create a new role with the provided details. ' +
    'You need to include the role details in the request body, and the API will return the created role object.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **role_name** (required): The name of the role to be created.\n\n' +
    '**How to Use**:\n' +
    '- Send a POST request to the `/api/v1/roles` endpoint with the role details as a JSON object in the request body.\n' +
    '- Ensure all required fields are included and correctly formatted.\n\n' +
    '**Response Details**:\n' +
    '- On successful creation, the API returns the newly created role object with its generated ID.\n' +
    '- If any required field is missing or the provided data is invalid, the API responds with a 400 Bad Request error.\n' +
    '- Server errors or permission issues will result in a 500 Internal Server Error.\n\n' +
    'This endpoint allows adding new roles to the system, enabling role management.',

  GetAllRolesDescription = 'This endpoint retrieves a paginated list of all roles stored in the system. ' +
    'You can filter the results based on various parameters, allowing you to manage and view roles effectively.\n\n' +
    '**Response Details**:\n' +
    '- The API returns a JSON object containing a list of roles along with pagination metadata (total count, current page, etc.).\n' +
    '- If no roles match the criteria, an empty list is returned.\n\n' +
    'This endpoint is useful for retrieving and displaying all roles for better role management.',

  GetRoleByIdDescription = 'This endpoint retrieves the details of a specific role identified by its unique ID. ' +
    'It allows users to view role information in detail.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the role to retrieve.\n\n' +
    '**Response Details**:\n' +
    '- On success, the API returns a JSON object with the role’s details.\n' +
    '- If the role with the specified ID is not found, a 404 Not Found error is returned.\n\n' +
    'This endpoint is essential for accessing detailed information about specific roles.',

  UpdateRoleDescription = 'This endpoint updates the details of an existing role identified by its unique ID. ' +
    'You need to provide the updated role details in the request body.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the role to update.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **role_name** (optional): The updated name of the role.\n\n' +
    '**Response Details**:\n' +
    '- On successful update, the API returns the updated role object.\n' +
    '- If the role is not found, a 404 Not Found error is returned.\n' +
    '- Validation errors will result in a 400 Bad Request error.\n\n' +
    'This endpoint is crucial for maintaining accurate and up-to-date role information.',

  DeleteRoleDescription = 'This endpoint deletes an existing role from the system using its unique ID. ' +
    'It is a destructive operation that permanently removes the role.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the role to delete.\n\n' +
    '**Response Details**:\n' +
    '- On successful deletion, the API returns a confirmation message indicating the role has been deleted.\n' +
    '- If the role is not found, a 404 Not Found error is returned.\n' +
    '- Permission errors will result in a 403 Forbidden error.\n\n' +
    'This endpoint is essential for managing role lifecycles by allowing deletions of obsolete or incorrect roles.',

  InactivateRoleDescription = 'This endpoint inactivates an existing role identified by its unique ID. ' +
    'It updates the role status to inactive.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the role to inactivate.\n\n' +
    '**Response Details**:\n' +
    '- On successful inactivation, the API returns a confirmation message indicating the role has been inactivated.\n' +
    '- If the role is not found, a 404 Not Found error is returned.\n\n' +
    'This endpoint is crucial for managing role statuses effectively.',
}

export enum UserRoleDescription {
  CreateUserRoleDescription = 'This endpoint is used to create a new user-role association. ' +
    'You need to include the user ID, role ID, project ID, and account ID in the request body. ' +
    'The API will return the created user-role object.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **user_id** (required): The ID of the user to associate with a role.\n' +
    '- **role_id** (required): The ID of the role to be assigned to the user.\n' +
    '- **project_id** (required): The ID of the project for which the role is assigned.\n' +
    '- **account_id** (required): The ID of the account under which the role is assigned.\n\n' +
    '**How to Use**:\n' +
    '- Send a POST request to the `/api/v1/user-roles` endpoint with the user-role details as a JSON object in the request body.\n' +
    '- Ensure all required fields are included and correctly formatted.\n\n' +
    '**Response Details**:\n' +
    '- On successful creation, the API returns the newly created user-role object with its generated ID.\n' +
    '- If any required field is missing or the provided data is invalid, the API responds with a 400 Bad Request error.\n' +
    '- Server errors or permission issues will result in a 500 Internal Server Error.\n\n' +
    'This endpoint allows associating users with specific roles, enabling effective role management.',

  GetAllUserRolesDescription = 'This endpoint retrieves a paginated list of all user-role associations stored in the system. ' +
    'You can filter the results based on various parameters, allowing you to manage and view user roles effectively.\n\n' +
    '**Response Details**:\n' +
    '- The API returns a JSON object containing a list of user-role associations along with pagination metadata (total count, current page, etc.).\n' +
    '- If no user-roles match the criteria, an empty list is returned.\n\n' +
    'This endpoint is useful for retrieving and displaying all user-role associations for better management.',

  GetUserRoleByIdDescription = 'This endpoint retrieves the details of a specific user-role association identified by its unique ID. ' +
    'It allows users to view user-role information in detail.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the user-role association to retrieve.\n\n' +
    '**Response Details**:\n' +
    '- On success, the API returns a JSON object with the user-role’s details.\n' +
    '- If the user-role with the specified ID is not found, a 404 Not Found error is returned.\n\n' +
    'This endpoint is essential for accessing detailed information about specific user-role associations.',

  UpdateUserRoleDescription = 'This endpoint updates the details of an existing user-role association identified by its unique ID. ' +
    'You need to provide the updated user-role details in the request body.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the user-role association to update.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **user_id** (optional): The updated ID of the user.\n' +
    '- **role_id** (optional): The updated ID of the role.\n' +
    '- **project_id** (optional): The updated ID of the project.\n' +
    '- **account_id** (optional): The updated ID of the account.\n\n' +
    '**Response Details**:\n' +
    '- On successful update, the API returns the updated user-role object.\n' +
    '- If the user-role association is not found, a 404 Not Found error is returned.\n' +
    '- Validation errors will result in a 400 Bad Request error.\n\n' +
    'This endpoint is crucial for maintaining accurate and up-to-date user-role associations.',

  DeleteUserRoleDescription = 'This endpoint deletes an existing user-role association from the system using its unique ID. ' +
    'It is a destructive operation that permanently removes the user-role association.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the user-role association to delete.\n\n' +
    '**Response Details**:\n' +
    '- On successful deletion, the API returns a confirmation message indicating the user-role has been deleted.\n' +
    '- If the user-role association is not found, a 404 Not Found error is returned.\n' +
    '- Permission errors will result in a 403 Forbidden error.\n\n' +
    'This endpoint is essential for managing user-role lifecycles by allowing deletions of obsolete or incorrect associations.',

  FindUserRoleByIdDescription = 'This endpoint retrieves a specific user-role association by its unique ID. ' +
    'It allows you to check the user, role, project, and account associated with that user-role.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the user-role association to retrieve.\n\n' +
    '**Response Details**:\n' +
    '- On success, the API returns a JSON object with detailed information about the user-role association.\n' +
    '- If the association is not found, a 404 Not Found error is returned.\n\n' +
    'This endpoint is crucial for auditing and verifying user-role associations within the system.',
}

export enum RolePermissionDescription {
  CreateRolePermissionDescription = 'This endpoint creates a new association between a role and a permission. ' +
    'You need to include the role ID and permission ID in the request body. ' +
    'The API will return the created role-permission object.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **role_id** (required): The ID of the role for which the permission is assigned.\n' +
    '- **permission_id** (required): The ID of the permission being assigned to the role.\n\n' +
    '**How to Use**:\n' +
    '- Send a POST request to the `/api/v1/role-permissions` endpoint with the role-permission details as a JSON object in the request body.\n' +
    '- Ensure all required fields are included and correctly formatted.\n\n' +
    '**Response Details**:\n' +
    '- On successful creation, the API returns the newly created role-permission object with its generated ID.\n' +
    '- If any required field is missing or the provided data is invalid, the API responds with a 400 Bad Request error.\n' +
    '- Server errors or permission issues will result in a 500 Internal Server Error.\n\n' +
    'This endpoint allows you to associate roles with specific permissions, enabling effective permission management.',

  GetAllRolePermissionsDescription = 'This endpoint retrieves a paginated list of all role-permission associations stored in the system. ' +
    'You can filter the results based on various parameters, allowing you to manage and view role permissions effectively.\n\n' +
    '**Response Details**:\n' +
    '- The API returns a JSON object containing a list of role-permission associations along with pagination metadata (total count, current page, etc.).\n' +
    '- If no role-permissions match the criteria, an empty list is returned.\n\n' +
    'This endpoint is useful for retrieving and displaying all role-permission associations for better management.',

  GetRolePermissionByIdDescription = 'This endpoint retrieves the details of a specific role-permission association identified by its unique ID. ' +
    'It allows users to view role-permission information in detail.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the role-permission association to retrieve.\n\n' +
    '**Response Details**:\n' +
    '- On success, the API returns a JSON object with the role-permission’s details.\n' +
    '- If the role-permission with the specified ID is not found, a 404 Not Found error is returned.\n\n' +
    'This endpoint is essential for accessing detailed information about specific role-permission associations.',

  UpdateRolePermissionDescription = 'This endpoint updates the details of an existing role-permission association identified by its unique ID. ' +
    'You need to provide the updated role ID and permission ID in the request body.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the role-permission association to update.\n\n' +
    '**Request Body Parameters**:\n' +
    '- **role_id** (optional): The updated ID of the role.\n' +
    '- **permission_id** (optional): The updated ID of the permission.\n\n' +
    '**Response Details**:\n' +
    '- On successful update, the API returns the updated role-permission object.\n' +
    '- If the role-permission association is not found, a 404 Not Found error is returned.\n' +
    '- Validation errors will result in a 400 Bad Request error.\n\n' +
    'This endpoint is crucial for maintaining accurate and up-to-date role-permission associations.',

  DeleteRolePermissionDescription = 'This endpoint deletes an existing role-permission association from the system using its unique ID. ' +
    'It is a destructive operation that permanently removes the role-permission association.\n\n' +
    '**Path Parameters**:\n' +
    '- **id** (required): The unique identifier of the role-permission association to delete.\n\n' +
    '**Response Details**:\n' +
    '- On successful deletion, the API returns a confirmation message indicating the role-permission has been deleted.\n' +
    '- If the role-permission association is not found, a 404 Not Found error is returned.\n' +
    '- Permission errors will result in a 403 Forbidden error.\n\n' +
    'This endpoint is essential for managing role-permission lifecycles by allowing deletions of obsolete or incorrect associations.',
}

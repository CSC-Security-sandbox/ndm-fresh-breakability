export enum ConfigApiDoc{
    CREATE_CONFIG = 'This endpoint creates a new configuration in the system with detailed configuration options for file servers and working directories. ' +
    'It accepts configuration data structured as a nested object and stores the configuration for future use.\n\n' +
    '**Request Body**:\n' +
    '- **projectId** (required): UUID representing the project this configuration is associated with. Example: `36bfd77f-1d7c-47a3-8c62-3c8739e2f88f`.\n' +
    '- **configName** (required): A descriptive name for the configuration. Example: `Config 1`.\n' +
    '- **workingDirectory** (required): Object containing working directory details:\n' +
    '  - **pathName** (optional): Path name. Example: `/temp`.\n' +
    '  - **workingDirectory** (optional): Path of the working directory. Example: `/working-directory`.\n' +
    '  - **pathId** (optional): UUID representing the path ID. Example: `36bfd77f-1d7c-47a3-8c62-3c8739e2f88f`.\n' +
    '- **configType** (required): Enum specifying the type of configuration. Possible values: `file`, `database`, etc.\n' +
    '- **fileServers** (required): Array of objects representing file servers. Each object contains:\n' +
    '  - **id** (optional): UUID of the file server. Example: `36bfd77f-1d7c-47a3-8c62-3c8739e2f88f`.\n' +
    '  - **serverType** (optional): Enum specifying the server type. Default: `other`.\n' +
    '  - **protocol** (required): Enum specifying the protocol. Example: `NFS`.\n' +
    '  - **protocolVersion** (optional): Enum specifying the protocol version. Example: `NFSv4_0`.\n' +
    '  - **userName** (required): Username for the server. Example: `admin`.\n' +
    '  - **host** (required): Host address. Example: `127.0.0.1:2049`.\n' +
    '  - **password** (optional): Password for the server. Example: `***`.\n' +
    '  - **workers** (required): Array of UUIDs representing worker IDs. Example: `["4160b89b-bb37-48e0-81bb-16a027622d2e"]`.\n' +
    '  - **createdBy** (optional): UUID of the user who created the server configuration.\n' +
    '- **createdBy** (optional): UUID of the user who created the configuration. Example: `36bfd77f-1d7c-47a3-8c62-3c8739e2f88f`.\n\n' +
    '**How to Use**:\n' +
    '- Send a POST request to the `/api/configuration` endpoint with the configuration data in the request body.\n' +
    '- Include a valid Bearer Token in the `Authorization` header for authentication.\n' +
    '- Ensure that the request payload adheres to the `ConfigDTO` structure.\n\n' +
    '**Response Details**:\n' +
    '- On successful creation, the API returns a JSON object containing the details of the created configuration, including its ID, timestamp, and provided data.\n' +
    '- If the input data is invalid or the user lacks permissions, an error response is returned with the appropriate status code.\n\n' +
    'This endpoint is designed to allow administrators to define and manage configurations for projects efficiently, including file server and working directory details.',

    GET_ALL_CONFIG = 'This endpoint retrieves a paginated list of configurations based on the provided query parameters. ' +
    'You can filter, sort, and paginate the configurations, making it easier to retrieve the data you need.\n\n' +
    '**Query Parameters**:\n' +
    '- **page** (optional): The page number of the results to retrieve (default is `1`).\n' +
    '- **limit** (optional): The number of configurations per page (default is `10`).\n' +
    '- **sort** (optional): The field to sort the configurations by (e.g., `createdAt`, `createdBy`, `updatedAt`, `updatedBy`).\n' +
    '- **order** (optional): The sorting order, either `asc` (ascending) or `desc` (descending).\n' +
    '- **projectId** (optional): Filter configurations by a specific project ID (ObjectId). Example: `36bfd77f-1d7c-47a3-8c62-3c8739e2f88f`.\n' +
    '- **configName** (optional): Filter configurations by the name. Example: `Config 1`.\n' +
    '- **stage** (optional): Filter configurations by the stage. Example: `development`.\n\n' +
    '**How to Use**:\n' +
    '- Send a GET request to the `/api/configuration` endpoint with the desired query parameters.\n' +
    '- Ensure parameters are correctly formatted for filtering, sorting, and pagination.\n\n' +
    '**Response Details**:\n' +
    '- The API returns a JSON object containing:\n' +
    '  - **total**: Total number of configurations matching the query.\n' +
    '  - **data**: An array of configuration entities based on the specified filters, sorted order, and pagination.\n' +
    '- If the pagination or filter parameters are invalid, a `400 Bad Request` response is returned.\n\n' +
    'This endpoint is useful for retrieving and managing configurations, especially when dealing with large datasets that require pagination.',

    GET_CONFIG_BY_ID = 'This endpoint retrieves a specific configuration based on the provided ID. ' +
    'You can use this endpoint to fetch the details of a configuration when you have its unique identifier.\n\n' +
    '**Path Parameter**:\n' +
    '- **id** (required): The unique identifier (UUID) of the configuration to retrieve. Example: `36bfd77f-1d7c-47a3-8c62-3c8739e2f88f`.\n\n' +
    '**How to Use**:\n' +
    '- Send a GET request to the `/api/configuration/:id` endpoint with the `id` parameter set to the configuration’s UUID.\n' +
    '- Include a valid Bearer Token in the `Authorization` header for authentication.\n\n' +
    '**Response Details**:\n' +
    '- On success, the API returns a JSON object containing the configuration data (of type `ConfigDTO`).\n' +
    '- If no configuration is found with the provided ID, a `404 Not Found` response is returned.\n\n' +
    '**Error Responses**:\n' +
    '- **404 Not Found**: If the configuration with the specified ID does not exist.\n\n' +
    'This endpoint is useful for retrieving the details of a single configuration based on its unique identifier.',

    UPDATE_CONFIG_ID = 'This endpoint updates an existing configuration based on the provided ID and new configuration data. ' +
    'It allows you to modify a configuration by providing the updated details.\n\n' +
    '**Path Parameter**:\n' +
    '- **id** (required): The unique identifier (UUID) of the configuration to update. Example: `36bfd77f-1d7c-47a3-8c62-3c8739e2f88f`.\n\n' +
    '**Request Body**:\n' +
    '- **configName** (optional): New name for the configuration. Example: `Updated Config`.\n' +
    '- **projectId** (optional): The UUID of the project associated with the configuration.\n' +
    '- **workingDirectory** (optional): The updated working directory details, structured as an object.\n' +
    '- **configType** (optional): Enum representing the updated configuration type.\n' +
    '- **fileServers** (optional): Array of updated file server configurations.\n' +
    '- **createdBy** (optional): UUID of the user who created the updated configuration (if applicable).\n\n' +
    '**How to Use**:\n' +
    '- Send a PUT request to the `/api/configuration/:id` endpoint with the `id` parameter set to the configuration’s UUID.\n' +
    '- Include the updated configuration data in the request body in the format defined by the `ConfigDTO`.\n' +
    '- Include a valid Bearer Token in the `Authorization` header for authentication.\n\n' +
    '**Response Details**:\n' +
    '- On successful update, the API returns a `200 OK` response indicating that the configuration has been updated successfully.\n' +
    '- If the configuration with the specified ID does not exist, a `404 Not Found` response is returned.\n\n' +
    '**Error Responses**:\n' +
    '- **404 Not Found**: If the configuration with the specified ID does not exist.\n\n' +
    'This endpoint is useful for updating an existing configuration’s details, allowing administrators to modify configuration settings for a project.',
    
    DELETE_CONFIG_ID = 'This endpoint deletes a specific configuration based on the provided ID. ' +
    'You can use this endpoint to permanently remove a configuration from the system using its unique identifier.\n\n' +
    '**Path Parameter**:\n' +
    '- **id** (required): The unique identifier (UUID) of the configuration to delete. Example: `36bfd77f-1d7c-47a3-8c62-3c8739e2f88f`.\n\n' +
    '**How to Use**:\n' +
    '- Send a DELETE request to the `/api/configuration/:id` endpoint with the `id` parameter set to the configuration’s UUID.\n' +
    '- Include a valid Bearer Token in the `Authorization` header for authentication.\n\n' +
    '**Response Details**:\n' +
    '- On success, the API returns a `200 OK` response indicating that the configuration has been deleted successfully.\n' +
    '- If no configuration is found with the provided ID, a `404 Not Found` response is returned.\n\n' +
    '**Error Responses**:\n' +
    '- **404 Not Found**: If the configuration with the specified ID does not exist.\n\n' +
    'This endpoint is useful for permanently removing a configuration from the system when it is no longer needed or valid.'
    
    
}
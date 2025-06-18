CREATE TYPE path_upload_action_enum AS ENUM ('CREATE', 'DUPLICATE', 'DELETE');

CREATE TABLE
    IF NOT EXISTS path_uploads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
        upload_id UUID NOT NULL,
        volume_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        action path_upload_action_enum NOT NULL,
        file_server_id UUID NOT NULL REFERENCES file_server (id),
        created_at timestamp DEFAULT now () NOT NULL,
        created_by uuid NULL,
        updated_at timestamp DEFAULT now () NOT NULL,
        updated_by uuid NULL
    );

-- create a trigger to call the function before update
CREATE TRIGGER update_path_uploads_updated_at BEFORE
UPDATE ON path_uploads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column ();
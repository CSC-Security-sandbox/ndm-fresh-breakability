CREATE TABLE error_remedies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    error_code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT NOT NULL,
    resolution_steps TEXT NOT NULL,
    reference_commands TEXT
);
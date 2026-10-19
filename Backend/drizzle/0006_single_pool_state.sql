ALTER TABLE pool_states
ADD CONSTRAINT pool_states_single_row
CHECK (id = '9fe4cd03-79a5-421d-8670-ab1bd152b2c5'::uuid);
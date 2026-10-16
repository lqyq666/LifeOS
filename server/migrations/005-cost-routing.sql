ALTER TABLE user_memory_settings
  ADD COLUMN pattern_reflection_count integer NOT NULL DEFAULT 0 CHECK (pattern_reflection_count >= 0);

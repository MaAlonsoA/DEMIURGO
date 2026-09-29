-- The answer a side conversation about a question (Go deeper) led to, worded by the agent as one
-- more option: { answer, implies }, or null while there is none. Kept apart from the predefined
-- options, which an agent may replace whole.
alter table questions add column conversation_option jsonb;

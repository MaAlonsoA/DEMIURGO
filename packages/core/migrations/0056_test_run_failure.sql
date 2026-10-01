-- The failure message and text of a failing test (capped), so the next build attempt and the person see why CI was red.
alter table test_runs add column failure text;

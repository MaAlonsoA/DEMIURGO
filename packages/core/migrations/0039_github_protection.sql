-- Who enforces the merge rule (ci + demiurgo/review + demiurgo/design all green): GitHub, with branch
-- protection and auto-merge, or DEMIURGO itself when the plan does not offer them (private repos on Free).

alter table project_github add column protection text not null default 'github' check (protection in ('github', 'demiurgo'));

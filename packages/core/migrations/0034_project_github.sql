-- The project's private GitHub repository (github/client.ts): where its code lives and where pull
-- requests are opened. Written once by github-setup; the database keeps only the link, never a token.

create table project_github (
  id uuid primary key default uuidv7(),
  project_id uuid not null unique references projects (id),
  owner text not null,
  repo text not null,
  created_at timestamptz not null default now()
);

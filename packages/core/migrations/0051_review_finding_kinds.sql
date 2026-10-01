-- Jev's opinion on each comment of a pull request review (classifier/review-findings.ts): which kind of
-- finding it is (category, with its probability) and the probability that a standing instruction to the
-- builder would have avoided it. Derived and append-only: Delivery counts them as «Why pull requests
-- bounce». `comment_index` is the position in `pr_reviews.comments`. The latest row of a
-- (pr_review_id, comment_index) is the active one. It never changes the review.
create table review_finding_kinds (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  pr_review_id uuid not null references pr_reviews (id),
  comment_index integer not null,
  category text not null,
  p double precision not null,
  avoidable_p double precision not null,
  classifier_id text not null,
  input_hash text not null,
  created_at timestamptz not null default now()
);
create index review_finding_kinds_by_project on review_finding_kinds (project_id, created_at desc);
create index review_finding_kinds_by_review on review_finding_kinds (pr_review_id, comment_index, created_at desc, id desc);
create trigger review_finding_kinds_append_only before update or delete on review_finding_kinds
  for each row execute function append_only();

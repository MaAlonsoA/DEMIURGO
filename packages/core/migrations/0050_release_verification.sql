-- A third verification kind for acceptance criteria: `release`. It is checked automatically against the
-- deployed release candidate (real hosting, network, provider behaviour, cold starts, capacity), not in CI.
-- Source: Humble & Farley, "Continuous Delivery" (deployment pipeline: capacity and acceptance stages run
-- against a deployed environment).
alter table criteria drop constraint if exists criteria_verification_check;
alter table criteria add constraint criteria_verification_check
  check (verification in ('automatic', 'manual', 'release'));

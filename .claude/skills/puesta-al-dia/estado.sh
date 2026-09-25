#!/usr/bin/env bash
# Read-only snapshot of the V2.1 work: patches in git and what the person did inside DEMIURGO.
# Usage: bash .claude/skills/puesta-al-dia/estado.sh [days]   (default: 7 days of DEMIURGO activity)
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
DAYS="${1:-7}"

echo "## Patches (git log v2..v2.1, newest first)"
git log v2..v2.1 --date=format:'%Y-%m-%d %H:%M' --format='--- %h %ad %s%n%b' --stat=100 | sed '/^$/d'

q() {
  docker exec -e PGOPTIONS='-c default_transaction_read_only=on' demiurgo-v2-postgres-1 \
    psql -U demiurgo -d demiurgo_v2 -P pager=off -P footer=off -c "$1" 2>&1
}

echo
echo "## DEMIURGO instance (read-only), last $DAYS days"
echo "### Projects"
q "select name, state, id, created_at::timestamp(0) from projects order by created_at desc"
echo "### Threads"
q "select p.name as project, e.purpose, e.state, e.origin_type, e.created_at::timestamp(0) as opened,
          (select count(*) from messages m where m.exploration_id = e.id) as msgs, e.id
     from explorations e join projects p on p.id = e.project_id
    where e.created_at > now() - interval '$DAYS days'
       or exists (select 1 from messages m where m.exploration_id = e.id and m.created_at > now() - interval '$DAYS days')
    order by opened desc limit 40"
echo "### Latest messages"
q "select m.created_at::timestamp(0) as at, left(e.purpose, 40) as thread, m.author, m.kind,
          left(regexp_replace(m.body, '\s+', ' ', 'g'), 220) as body
     from messages m join explorations e on e.id = m.exploration_id
    where m.created_at > now() - interval '$DAYS days' order by m.created_at desc limit 30"
echo "### Drafts and proposals still pending"
q "select b.created_at::timestamp(0) as at, b.kind, b.producer, left(b.summary, 120) as summary, pr.type,
          left(coalesce(pr.payload->>'title', pr.payload->>'code', pr.payload::text), 120) as proposal, pr.state
     from proposals pr join proposal_batches b on b.id = pr.batch_id
    where pr.resolved_at is null
    order by b.created_at desc, pr.position limit 40"
echo "### Records (latest version)"
q "select distinct on (r.id) r.code, r.type, r.state, v.n, left(v.title, 80) as title, v.state as version_state,
          v.created_at::timestamp(0) as at
     from records r join record_versions v on v.record_id = r.id
    order by r.id, v.n desc"

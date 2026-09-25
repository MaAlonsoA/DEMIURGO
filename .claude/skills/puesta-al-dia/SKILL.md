---
name: puesta-al-dia
description: Read-only catch-up on the V2.1 work, so the person does not have to retell it. Lists the patches made on branch v2.1 (what was asked and where it shows) and what the person did inside DEMIURGO on the 8100 instance (projects, threads, messages, pending drafts and proposals, records). It also marks which patches are not yet defined as a feature inside DEMIURGO. Use it at the start of a companion conversation, or when asked "¿qué hay?" or "ponte al día".
---

# Puesta al día (V2.1)

Everything here is read-only. Never write to the database or to git.

1. Run `bash .claude/skills/puesta-al-dia/estado.sh` (optional argument: days of DEMIURGO activity,
   default 7).
   - The script reads `git log v2..v2.1`. Each `patch:` commit carries `Pedido:` (the person's
     words) and `Dónde:` (screen or action) in its body.
   - It then queries the `demiurgo_v2` database of the instance through
     `docker exec demiurgo-v2-postgres-1 psql` with `default_transaction_read_only=on`.
   - If the container is down, say so and continue with the git part.
2. Match each patch against DEMIURGO: look for a thread, message, draft or record that talks about
   the same intent. If you need more detail, use your own read-only `SELECT`s with the same
   `docker exec -e PGOPTIONS='-c default_transaction_read_only=on' …` pattern.
3. Answer in Spanish, briefly:
   - **Parches**: a table with sha, what was asked, where it shows, and its state:
     - **definido en DEMIURGO** (name the thread or record);
     - **en conversación** (a thread mentions it);
     - **sin definir aún**.
   - **Lo nuevo en DEMIURGO**: threads, messages, pending drafts and records since the last look, in
     a few lines.
   - **Siguiente paso sugerido**: one or two options. Examples: define a patch that is working well,
     answer a pending draft, try out the latest patch.

Do not paste raw SQL output at the person. Do not repeat secrets.

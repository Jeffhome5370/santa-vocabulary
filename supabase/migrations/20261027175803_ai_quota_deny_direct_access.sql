-- Explicitly document that clients cannot read or modify quota counters.
create policy deny_direct_client_access on santa_ai_private.usage
  for all to public using (false) with check (false);

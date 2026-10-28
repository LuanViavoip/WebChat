DROP FUNCTION IF EXISTS staff_sessions_alive(uuid[]);

CREATE FUNCTION staff_sessions_alive(p_ids uuid[])
RETURNS TABLE (session_id uuid, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT session.id, agent.role
  FROM auth_sessions AS session
  JOIN agents AS agent
    ON agent.id = session.agent_id
   AND agent.tenant_id = session.tenant_id
  WHERE session.id = ANY (p_ids)
    AND session.expires_at > now()
    AND agent.membership_status = 'active'
    AND session.auth_epoch = agent.auth_epoch
    AND agent.role IN ('agent', 'supervisor', 'admin')
$$;

GRANT EXECUTE ON FUNCTION staff_sessions_alive(uuid[]) TO webchat_app;

import {
  internalListAckSchema,
  presenceAckSchema,
  presenceUpdatedSchema,
  type AuthMe,
  type DesiredPresence,
  type PresenceStatus,
} from '@viavoip/protocol';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { CompanyPanel } from '../admin/CompanyPanel.js';
import { ActivityPanel } from '../activity/ActivityPanel.js';
import { AnnouncementsPanel } from '../announcements/AnnouncementsPanel.js';
import { Desk, type LinkState } from '../desk/Desk.js';
import { presenceLabel } from '../desk/format.js';
import { InternalChat } from '../internal/InternalChat.js';
import { ackMessage, emitAck } from '../realtime.js';
import { SectorsPanel } from '../sectors/SectorsPanel.js';
import { OverviewPanel } from '../supervisor/OverviewPanel.js';
import { isStaffRole, roleLabel, sectionsFor, staffNamespace, type Section } from './roles.js';

const heartbeatMs = 15_000;

export function Shell({ token, profile, onLogout }: { token: string; profile: AuthMe; onLogout: () => void }) {
  const sections = sectionsFor(profile.role);
  const [section, setSection] = useState<Section>(sections[0]?.id ?? 'desk');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [link, setLink] = useState<LinkState>('disconnected');
  const [selfStatus, setSelfStatus] = useState<PresenceStatus>('offline');
  const [notice, setNotice] = useState('');
  const [internalUnread, setInternalUnread] = useState(0);
  const staff = isStaffRole(profile.role);

  useEffect(() => {
    const next = io(staffNamespace(profile.role), {
      auth: { token },
      transports: ['websocket'],
      withCredentials: false,
    });
    setSocket(next);
    const onConnect = () => {
      setLink('connected');
      void emitAck(next, 'internal.list', {}).then((ack) => {
        const parsed = internalListAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        setInternalUnread(parsed.data.conversations.reduce((sum, item) => sum + item.unread, 0));
      });
    };
    const onDisconnect = () => {
      setLink(next.active ? 'reconnecting' : 'disconnected');
      setSelfStatus('offline');
    };
    const onPresence = (payload: unknown) => {
      const parsed = presenceUpdatedSchema.safeParse(payload);
      if (!parsed.success || parsed.data.agentId !== profile.selfId) return;
      setSelfStatus(parsed.data.status);
    };
    next.on('connect', onConnect);
    next.on('disconnect', onDisconnect);
    next.on('connect_error', () => setLink('disconnected'));
    next.on('presence.updated', onPresence);
    const heartbeat = setInterval(() => {
      if (next.connected) next.emit('presence.heartbeat', {});
    }, heartbeatMs);
    return () => {
      clearInterval(heartbeat);
      next.off('connect', onConnect);
      next.off('disconnect', onDisconnect);
      next.off('presence.updated', onPresence);
      next.disconnect();
    };
  }, [profile.role, profile.selfId, token]);

  async function changePresence(status: DesiredPresence) {
    if (!socket || profile.role !== 'agent') return;
    const parsed = presenceAckSchema.safeParse(await emitAck(socket, 'presence.set', { status }));
    if (!parsed.success || !parsed.data.ok) {
      setNotice(ackMessage(parsed, 'Presença recusada'));
      return;
    }
    setSelfStatus(parsed.data.status);
    setNotice(`Presença: ${presenceLabel(parsed.data.status)}`);
  }

  return (
    <main className="desk">
      <header>
        <div>
          <p className="eyebrow">ViaVoip</p>
          <h1>{profile.name}</h1>
          <p className="muted">{roleLabel(profile.role)} · {link === 'connected' ? 'Conectado' : 'Reconectando'}</p>
        </div>
        <div className="actions">
          {profile.role === 'agent' ? (
            <label>
              Presença
              <select
                data-testid="presence"
                value={selfStatus === 'offline' ? 'available' : selfStatus}
                disabled={selfStatus === 'offline' || link !== 'connected'}
                onChange={(event) => {
                  const status = event.target.value;
                  if (status === 'available' || status === 'busy' || status === 'away') void changePresence(status);
                }}
              >
                <option value="available">Disponível</option>
                <option value="busy">Ocupado</option>
                <option value="away">Ausente</option>
              </select>
            </label>
          ) : (
            <p className="muted">{presenceLabel(selfStatus)}</p>
          )}
          <button type="button" onClick={onLogout}>Sair</button>
        </div>
      </header>
      <nav className="section-nav" aria-label="Central">
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={section === item.id}
            onClick={() => {
              setSection(item.id);
              if (item.id === 'internal') setInternalUnread(0);
            }}
          >
            {item.label}
            {item.id === 'internal' && internalUnread > 0 ? <em>{internalUnread}</em> : null}
          </button>
        ))}
      </nav>
      {notice ? <p className="ok">{notice}</p> : null}
      <div className={section === 'desk' ? 'desk-view' : 'desk-view is-hidden'}>
        <Desk profile={profile} socket={socket} link={link} selfStatus={selfStatus} />
      </div>
      {section === 'internal' ? <InternalChat socket={socket} selfId={profile.selfId} link={link} /> : null}
      {section === 'sectors' ? <SectorsPanel socket={socket} canManage={staff} /> : null}
      {section === 'announcements' ? (
        <AnnouncementsPanel socket={socket} canPublish={staff} isAdmin={profile.role === 'admin'} />
      ) : null}
      {section === 'activity' ? <ActivityPanel socket={socket} selfId={profile.selfId} canAssign={staff} isAdmin={profile.role === 'admin'} /> : null}
      {section === 'company' && profile.role === 'admin' ? <CompanyPanel token={token} role={profile.role} mode="company" /> : null}
      {section === 'quality' ? <CompanyPanel token={token} role={profile.role} mode="quality" /> : null}
      {section === 'overview' ? <OverviewPanel socket={socket} mode="overview" /> : null}
      {section === 'agents' ? <OverviewPanel socket={socket} mode="agents" /> : null}
    </main>
  );
}

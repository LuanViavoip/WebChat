import {
  internalListAckSchema,
  presenceAckSchema,
  presenceUpdatedSchema,
  type AuthMe,
  type DesiredPresence,
  type PresenceStatus,
} from '@viavoip/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AdminPanel } from '../admin/AdminPanel.js';
import { ActivityPanel } from '../activity/ActivityPanel.js';
import { AnnouncementsPanel } from '../announcements/AnnouncementsPanel.js';
import { Desk } from '../desk/Desk.js';
import { presenceLabel } from '../desk/format.js';
import { InternalChat } from '../internal/InternalChat.js';
import { ackMessage, emitAck, type LinkState } from '../realtime.js';
import { SectorsPanel } from '../sectors/SectorsPanel.js';
import { QualityPanel } from '../quality/QualityPanel.js';
import { OverviewPanel } from '../supervisor/OverviewPanel.js';
import { AppShell } from '../ui/AppShell.js';
import { useHashRoute, useStoredFlag } from '../ui/hooks.js';
import { Sidebar } from '../ui/Sidebar.js';
import { useToast } from '../ui/Toast.js';
import { Topbar } from '../ui/Topbar.js';
import { AccountMenu } from './AccountMenu.js';
import { ConnectionChip } from './ConnectionChip.js';
import { navGroups, sectionSlugs, sectionTitle } from './nav.js';
import { PresenceControl } from './PresenceControl.js';
import { isStaffRole, roleLabel, sectionsFor, staffNamespace, type Section } from './roles.js';

const heartbeatMs = 15_000;

export function Shell({ token, profile, onLogout }: { token: string; profile: AuthMe; onLogout: () => void }) {
  const sectionIds = useMemo(() => sectionsFor(profile.role).map((item) => item.id), [profile.role]);
  const [section, navigate] = useHashRoute<Section>(sectionSlugs, sectionIds, sectionIds[0] ?? 'desk');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [link, setLink] = useState<LinkState>('disconnected');
  const [selfStatus, setSelfStatus] = useState<PresenceStatus | null>(null);
  const [internalUnread, setInternalUnread] = useState(0);
  const [collapsed, setCollapsed] = useStoredFlag('viavoip.sidebarCollapsed', false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toast = useToast();
  const sectionRef = useRef<Section>(section);
  sectionRef.current = section;
  const refreshUnread = useRef<() => void>(() => undefined);
  const staff = isStaffRole(profile.role);
  // Presença só vale com o socket conectado. O valor guardado não é sobrescrito ao desconectar.
  const presence = link === 'connected' ? selfStatus : null;

  useEffect(() => {
    const next = io(staffNamespace(profile.role), {
      auth: { token },
      transports: ['websocket'],
      withCredentials: false,
    });
    setSocket(next);
    // Total de não lidas do chat interno, direto do servidor. Dentro do próprio chat, a leitura é
    // marcada ali, então o selo fica zerado.
    const refresh = () => {
      if (sectionRef.current === 'internal') {
        setInternalUnread(0);
        return;
      }
      void emitAck(next, 'internal.list', {}).then((ack) => {
        const parsed = internalListAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        setInternalUnread(parsed.data.conversations.reduce((sum, item) => sum + item.unread, 0));
      }).catch(() => undefined);
    };
    refreshUnread.current = refresh;
    const onConnect = () => {
      setLink('connected');
      refresh();
    };
    const onDisconnect = () => {
      setLink(next.active ? 'reconnecting' : 'disconnected');
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
    next.on('internal.message.new', refresh);
    next.on('internal.conversation.updated', refresh);
    const heartbeat = setInterval(() => {
      if (next.connected) next.emit('presence.heartbeat', {});
    }, heartbeatMs);
    return () => {
      clearInterval(heartbeat);
      next.off('connect', onConnect);
      next.off('disconnect', onDisconnect);
      next.off('presence.updated', onPresence);
      next.off('internal.message.new', refresh);
      next.off('internal.conversation.updated', refresh);
      next.disconnect();
    };
  }, [profile.role, profile.selfId, token]);

  useEffect(() => {
    refreshUnread.current();
  }, [section]);

  async function changePresence(status: DesiredPresence) {
    if (!socket || profile.role !== 'agent') return;
    const parsed = presenceAckSchema.safeParse(await emitAck(socket, 'presence.set', { status }));
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Presença recusada'));
      return;
    }
    setSelfStatus(parsed.data.status);
    toast.notify('ok', `Presença: ${presenceLabel(parsed.data.status)}`);
  }

  const groups = navGroups(profile.role, { internal: internalUnread });

  return (
    <AppShell
      collapsed={collapsed}
      sidebar={
        <Sidebar
          groups={groups}
          activeId={section}
          onSelect={(id) => {
            const next = sectionIds.find((candidate) => candidate === id);
            if (next) navigate(next);
          }}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed(!collapsed)}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
        />
      }
      topbar={
        <Topbar title={sectionTitle(profile.role, section)} onOpenMenu={() => setMenuOpen(true)}>
          <ConnectionChip link={link} />
          <PresenceControl role={profile.role} status={presence} link={link} onChange={(status) => void changePresence(status)} />
          <AccountMenu name={profile.name} roleLabel={roleLabel(profile.role)} onLogout={onLogout} />
        </Topbar>
      }
    >
      <div className="desk-slot" hidden={section !== 'desk'}>
        <Desk profile={profile} socket={socket} link={link} selfStatus={presence} />
      </div>
      {section === 'internal' ? <InternalChat socket={socket} selfId={profile.selfId} link={link} /> : null}
      {section === 'sectors' ? <SectorsPanel socket={socket} canManage={staff} /> : null}
      {section === 'announcements' ? (
        <AnnouncementsPanel socket={socket} canPublish={staff} isAdmin={profile.role === 'admin'} />
      ) : null}
      {section === 'activity' ? (
        <ActivityPanel socket={socket} selfId={profile.selfId} canAssign={staff} canChangeOwn={profile.canChangeOwnActivity} isAdmin={profile.role === 'admin'} />
      ) : null}
      {section === 'company' && profile.role === 'admin' ? <AdminPanel token={token} /> : null}
      {section === 'quality' ? (
        <QualityPanel token={token} role={profile.role} selfId={profile.selfId} socket={socket} queues={profile.queues} />
      ) : null}
      {section === 'overview' ? <OverviewPanel socket={socket} mode="overview" /> : null}
      {section === 'agents' ? <OverviewPanel socket={socket} mode="agents" /> : null}
    </AppShell>
  );
}

import {
  announcementAckSchema,
  announcementListAckSchema,
  sectorListAckSchema,
  type Announcement,
} from '@viavoip/protocol';
import { useEffect, useState, type FormEvent } from 'react';
import type { Socket } from 'socket.io-client';
import { formatClock } from '../desk/format.js';
import { ackMessage, emitAck } from '../realtime.js';

export function AnnouncementsPanel({
  socket,
  canPublish,
  isAdmin,
}: {
  socket: Socket | null;
  canPublish: boolean;
  isAdmin: boolean;
}) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [sectors, setSectors] = useState<{ id: string; name: string }[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'tenant' | 'sectors'>(isAdmin ? 'tenant' : 'sectors');
  const [sectorId, setSectorId] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!socket) return;
    const reload = () => {
      void emitAck(socket, 'announcement.list', {}).then((ack) => {
        const parsed = announcementListAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        setItems(parsed.data.announcements);
      });
      void emitAck(socket, 'sector.list', {}).then((ack) => {
        const parsed = sectorListAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        setSectors(parsed.data.sectors.filter((sector) => sector.canManage || !canPublish).map((sector) => ({
          id: sector.id,
          name: sector.name,
        })));
      });
    };
    const onPublished = () => reload();
    socket.on('announcement.published', onPublished);
    socket.on('announcement.updated', onPublished);
    socket.on('connect', reload);
    if (socket.connected) reload();
    return () => {
      socket.off('announcement.published', onPublished);
      socket.off('announcement.updated', onPublished);
      socket.off('connect', reload);
    };
  }, [canPublish, socket]);

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!socket) return;
    const parsed = announcementAckSchema.safeParse(
      await emitAck(socket, 'announcement.publish', {
        title,
        body,
        audience,
        pinned: false,
        ...(audience === 'sectors' && sectorId ? { sectorIds: [sectorId] } : {}),
      }),
    );
    if (!parsed.success || !parsed.data.ok) {
      setNotice(ackMessage(parsed, 'Publicação recusada'));
      return;
    }
    const announcement = parsed.data.announcement;
    setTitle('');
    setBody('');
    setNotice('Anúncio publicado');
    setItems((current) => [announcement, ...current.filter((item) => item.id !== announcement.id)]);
  }

  async function markRead(announcementId: string) {
    if (!socket) return;
    const parsed = announcementAckSchema.safeParse(await emitAck(socket, 'announcement.read', { announcementId }));
    if (!parsed.success || !parsed.data.ok) return;
    const announcement = parsed.data.announcement;
    setItems((current) => current.map((item) => (item.id === announcementId ? announcement : item)));
  }

  const unread = items.filter((item) => item.unread).length;

  return (
    <section className="panel">
      <h2>Anúncios {unread > 0 ? <em>{unread}</em> : null}</h2>
      {notice ? <p className="ok">{notice}</p> : null}
      {canPublish ? (
        <form onSubmit={(event) => void publish(event)}>
          <label>
            Título
            <input data-testid="announcement-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            Conteúdo
            <input data-testid="announcement-body" value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <label>
            Público
            <select value={audience} onChange={(event) => setAudience(event.target.value === 'tenant' ? 'tenant' : 'sectors')}>
              {isAdmin ? <option value="tenant">Toda a empresa</option> : null}
              <option value="sectors">Setores</option>
            </select>
          </label>
          {audience === 'sectors' ? (
            <label>
              Setor
              <select value={sectorId} onChange={(event) => setSectorId(event.target.value)}>
                <option value="">Escolha</option>
                {sectors.map((sector) => (
                  <option key={sector.id} value={sector.id}>{sector.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="submit">Publicar</button>
        </form>
      ) : null}
      {items.map((item) => (
        <article key={item.id} className="pane">
          <h3>{item.pinned ? 'Fixado · ' : ''}{item.title}</h3>
          <p>{item.body}</p>
          <p className="muted">{item.authorName} · {formatClock(item.publishedAt)} · {item.unread ? 'Não lido' : 'Lido'}</p>
          {item.unread ? (
            <button type="button" onClick={() => void markRead(item.id)}>Marcar como lido</button>
          ) : null}
        </article>
      ))}
    </section>
  );
}

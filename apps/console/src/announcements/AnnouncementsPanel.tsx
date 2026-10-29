import {
  announcementAckSchema,
  announcementListAckSchema,
  sectorListAckSchema,
  type Announcement,
} from '@viavoip/protocol';
import { Archive, CheckCheck, Megaphone, Pencil, Pin, Plus } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Socket } from 'socket.io-client';
import { formatDateTime } from '../desk/format.js';
import { isoToLocalInput } from '../quality/period.js';
import { ackMessage, emitAck } from '../realtime.js';
import { Button } from '../ui/Button.js';
import { Card } from '../ui/Card.js';
import { ConfirmDialog, Modal } from '../ui/Dialog.js';
import { Field, Input, Select, Textarea } from '../ui/Field.js';
import { EmptyState, LoadingState } from '../ui/states.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { useToast } from '../ui/Toast.js';
import { orderAnnouncements } from './order.js';

export function AnnouncementsPanel({
  socket,
  canPublish,
  isAdmin,
}: {
  socket: Socket | null;
  canPublish: boolean;
  isAdmin: boolean;
}) {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [sectors, setSectors] = useState<{ id: string; name: string }[]>([]);
  const [editor, setEditor] = useState<{ item: Announcement | null } | null>(null);
  const [archiving, setArchiving] = useState<Announcement | null>(null);
  const toast = useToast();

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

  function upsert(announcement: Announcement) {
    setItems((current) => [announcement, ...(current ?? []).filter((item) => item.id !== announcement.id)]);
  }

  async function archive(item: Announcement) {
    if (!socket) return;
    const parsed = announcementAckSchema.safeParse(await emitAck(socket, 'announcement.archive', { announcementId: item.id }));
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Arquivamento recusado'));
      return;
    }
    const archived = parsed.data.announcement;
    setItems((current) => (current ?? []).map((entry) => (entry.id === item.id ? archived : entry)));
    toast.notify('ok', 'Anúncio arquivado');
  }

  async function markRead(announcementId: string) {
    if (!socket) return;
    const parsed = announcementAckSchema.safeParse(await emitAck(socket, 'announcement.read', { announcementId }));
    if (!parsed.success || !parsed.data.ok) return;
    const announcement = parsed.data.announcement;
    setItems((current) => (current ?? []).map((item) => (item.id === announcementId ? announcement : item)));
  }

  const ordered = useMemo(() => orderAnnouncements(items ?? []), [items]);
  if (!items) return <LoadingState label="Carregando anúncios…" />;
  const unread = items.filter((item) => item.unread && !item.archivedAt).length;
  const canEdit = (item: Announcement) =>
    !item.archivedAt && (isAdmin || (item.audience === 'sectors' && item.sectorIds.every((id) => sectors.some((sector) => sector.id === id))));

  return (
    <div className="page">
      <Card
        title="Anúncios"
        actions={
          <>
            {unread > 0 ? <StatusBadge tone="info" dot>{unread} não lido(s)</StatusBadge> : null}
            {canPublish ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setEditor({ item: null })}>Novo anúncio</Button> : null}
          </>
        }
      >
        {ordered.length === 0 ? (
          <EmptyState icon={Megaphone} title="Nenhum anúncio" description="Os comunicados da empresa e dos seus setores aparecem aqui." />
        ) : (
          <div className="card-grid">
            {ordered.map((item) => (
              <article
                key={item.id}
                className={['item-card', item.pinned && !item.archivedAt ? 'item-card--pinned' : '', item.unread && !item.archivedAt ? 'item-card--unread' : ''].join(' ').trim()}
                style={item.archivedAt ? { opacity: 0.65 } : undefined}
              >
                <header className="item-card__head">
                  <h3>{item.title}</h3>
                  <span className="chip-list">
                    {item.pinned ? <StatusBadge tone="info"><Pin size={12} aria-hidden="true" />Fixado</StatusBadge> : null}
                    {item.archivedAt ? <StatusBadge>Arquivado</StatusBadge> : item.unread ? <StatusBadge tone="warning" dot>Não lido</StatusBadge> : <StatusBadge tone="neutral">Lido</StatusBadge>}
                  </span>
                </header>
                <p className="item-card__body">{item.body}</p>
                <footer className="item-card__foot">
                  <span>{item.authorName} · {formatDateTime(item.publishedAt)}{item.expiresAt ? ` · expira ${formatDateTime(item.expiresAt)}` : ''}</span>
                  <span className="row-actions">
                    {item.unread && !item.archivedAt ? (
                      <Button size="sm" variant="secondary" icon={<CheckCheck size={14} />} onClick={() => void markRead(item.id)}>Marcar como lido</Button>
                    ) : null}
                    {canEdit(item) ? (
                      <>
                        <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setEditor({ item })}>Editar</Button>
                        <Button size="sm" variant="ghost" icon={<Archive size={14} />} onClick={() => setArchiving(item)}>Arquivar</Button>
                      </>
                    ) : null}
                  </span>
                </footer>
              </article>
            ))}
          </div>
        )}
      </Card>
      <Modal open={editor !== null} onClose={() => setEditor(null)} title={editor?.item ? 'Editar anúncio' : 'Novo anúncio'} size="lg">
        {editor ? (
          <AnnouncementForm
            socket={socket}
            item={editor.item}
            sectors={sectors}
            isAdmin={isAdmin}
            onClose={() => setEditor(null)}
            onSaved={(announcement) => {
              upsert(announcement);
              toast.notify('ok', editor.item ? 'Anúncio atualizado' : 'Anúncio publicado');
            }}
          />
        ) : null}
      </Modal>
      <ConfirmDialog
        open={archiving !== null}
        title="Arquivar anúncio?"
        description={`“${archiving?.title ?? ''}” deixa de aparecer para a equipe. Essa ação não pode ser desfeita.`}
        confirmLabel="Arquivar"
        danger
        onCancel={() => setArchiving(null)}
        onConfirm={() => {
          const item = archiving;
          setArchiving(null);
          if (item) void archive(item);
        }}
      />
    </div>
  );
}

function AnnouncementForm({
  socket,
  item,
  sectors,
  isAdmin,
  onClose,
  onSaved,
}: {
  socket: Socket | null;
  item: Announcement | null;
  sectors: { id: string; name: string }[];
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (announcement: Announcement) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [audience, setAudience] = useState<'tenant' | 'sectors'>(isAdmin ? 'tenant' : 'sectors');
  const [sectorId, setSectorId] = useState('');
  const [pinned, setPinned] = useState(item?.pinned ?? false);
  const [expiresAt, setExpiresAt] = useState(item?.expiresAt ? isoToLocalInput(item.expiresAt) : '');
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!socket || pending) return;
    const expiry = expiresAt ? new Date(expiresAt).toISOString() : null;
    setPending(true);
    const parsed = announcementAckSchema.safeParse(await emitAck(
      socket,
      item ? 'announcement.update' : 'announcement.publish',
      item
        ? { announcementId: item.id, title, body, pinned, expiresAt: expiry }
        : {
            title,
            body,
            audience,
            pinned,
            ...(audience === 'sectors' && sectorId ? { sectorIds: [sectorId] } : {}),
            ...(expiry ? { expiresAt: expiry } : {}),
          },
    ));
    setPending(false);
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Publicação recusada'));
      return;
    }
    onSaved(parsed.data.announcement);
    onClose();
  }

  return (
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <Field label="Título">
        <Input data-testid="announcement-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} autoFocus />
      </Field>
      <Field label="Conteúdo">
        <Textarea data-testid="announcement-body" rows={5} value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} />
      </Field>
      {!item ? (
        <div className="form-grid">
          <Field label="Público">
            <Select value={audience} onChange={(event) => setAudience(event.target.value === 'tenant' ? 'tenant' : 'sectors')}>
              {isAdmin ? <option value="tenant">Toda a empresa</option> : null}
              <option value="sectors">Setores</option>
            </Select>
          </Field>
          {audience === 'sectors' ? (
            <Field label="Setor">
              <Select value={sectorId} onChange={(event) => setSectorId(event.target.value)}>
                <option value="">Escolha</option>
                {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
              </Select>
            </Field>
          ) : null}
        </div>
      ) : null}
      <div className="form-grid">
        <Field label="Expira em (opcional)">
          <Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
        </Field>
        <label className="check" style={{ alignSelf: 'end', minHeight: 44 }}>
          <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
          Fixar no topo
        </label>
      </div>
      <div className="form-actions">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={pending || !title.trim() || !body.trim() || (!item && audience === 'sectors' && !sectorId)}>{item ? 'Salvar anúncio' : 'Publicar'}</Button>
      </div>
    </form>
  );
}

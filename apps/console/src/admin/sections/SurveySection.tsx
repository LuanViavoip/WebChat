import { useState, type FormEvent } from 'react';
import { Button } from '../../ui/Button.js';
import { Card } from '../../ui/Card.js';
import { Field, Select, Textarea } from '../../ui/Field.js';
import { StatusBadge } from '../../ui/StatusBadge.js';
import { useAdminCommand, type AdminContext } from '../AdminContext.js';

export function SurveySection({ ctx }: { ctx: AdminContext }) {
  const survey = ctx.desk.survey;
  const [prompt, setPrompt] = useState(survey.status === 'active' ? survey.prompt : 'Como foi o seu atendimento?');
  const [scale, setScale] = useState(String(survey.status === 'active' ? survey.scale : 5));
  const [comment, setComment] = useState<'enabled' | 'disabled'>(survey.status === 'active' ? survey.comment : 'enabled');
  const action = useAdminCommand(ctx);
  function submit(event: FormEvent) {
    event.preventDefault();
    void action.submit({ kind: 'survey.publish', prompt, scale: Number(scale), comment }, 'Pesquisa publicada');
  }
  return (
    <div className="page">
      <Card
        title="Pesquisa de satisfação"
        actions={
          survey.status === 'active' ? <StatusBadge tone="success" dot>Publicada</StatusBadge> : <StatusBadge tone="warning" dot>Não publicada</StatusBadge>
        }
      >
        {survey.status === 'active' ? (
          <p>Vigente: “{survey.prompt}” · nota de 1 a {survey.scale} · comentário {survey.comment === 'enabled' ? 'habilitado' : 'desabilitado'}.</p>
        ) : (
          <p>Nenhuma pesquisa publicada. Visitantes não recebem pesquisa ao final do atendimento.</p>
        )}
        <form className="form-stack" onSubmit={submit}>
          <Field label="Pergunta">
            <Textarea rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={300} />
          </Field>
          <div className="form-grid">
            <Field label="Escala de notas">
              <Select value={scale} onChange={(event) => setScale(event.target.value)}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>1 a {value}</option>
                ))}
              </Select>
            </Field>
            <Field label="Comentário do visitante">
              <Select value={comment} onChange={(event) => setComment(event.target.value === 'disabled' ? 'disabled' : 'enabled')}>
                <option value="enabled">Habilitado</option>
                <option value="disabled">Desabilitado</option>
              </Select>
            </Field>
          </div>
          {action.error ? <p className="form-error" role="alert">{action.error}</p> : null}
          <div className="form-actions">
            <Button type="submit" disabled={action.pending || !prompt.trim()}>{action.pending ? 'Publicando…' : 'Publicar pesquisa'}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

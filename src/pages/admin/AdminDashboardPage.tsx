import { Icon } from "../../components/Icons";
import { Link, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { Card, Spinner, Stat, useAsync } from "../../components/ui";
import { formatDateBr, timeInTz, weekdayLabel, STATUS_LABEL, STATUS_STYLE } from "../../lib/format";

interface Dashboard {
  today: string;
  timezone: string;
  stats: Record<string, number>;
  next: { id: number; code: string; starts_at: string; status: string; patient_name: string; professional_name: string; procedure_name: string | null; kind: string }[];
  pending_confirmation: number;
}

export default function AdminDashboardPage() {
  const { slug = "" } = useParams();
  const { data, loading, error } = useAsync<Dashboard>(() => api.get("/dashboard"), [slug]);

  if (loading) return <Spinner />;
  if (error) return <Card title="Não foi possível carregar">{error}</Card>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Consultas hoje" value={data.stats.total ?? 0} hint={formatDateBr(data.today)} />
        <Stat label="Confirmadas" value={data.stats.confirmados ?? 0} tone="good" />
        <Stat label="Aguardando confirmação" value={data.stats.pendentes ?? 0} tone="warn" hint={`${data.pending_confirmation} futuras`} />
        <Stat label="Concluídas" value={data.stats.concluidos ?? 0} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Na recepção" value={data.stats.na_recepcao ?? 0} />
        <Stat label="Em atendimento" value={data.stats.em_atendimento ?? 0} />
        <Stat label="Faltas hoje" value={data.stats.faltas ?? 0} tone={Number(data.stats.faltas) > 0 ? "bad" : "default"} />
        <Stat label="Semana" value={weekdayLabel(data.today)} hint="Hoje" />
      </div>

      <Card
        title="Próximos atendimentos"
        subtitle="Atualizado agora"
        actions={<Link to={`/c/${slug}/admin/agenda`} className="btn-primary px-3 py-2 text-xs">Abrir agenda</Link>}
      >
        {data.next.length === 0 && <p className="text-sm text-slate-500">Nenhuma consulta futura registrada.</p>}
        <div className="space-y-2">
          {data.next.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">
                  {formatDateBr(a.starts_at.slice(0, 10))} · {timeInTz(a.starts_at, data.timezone)} · {a.patient_name}
                </p>
                <p className="text-xs text-slate-500">
                  {a.professional_name} · {a.procedure_name ?? (a.kind === "retorno" ? "Retorno" : "Consulta")} · {a.code}
                </p>
              </div>
              <span className={`chip ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link to={`/c/${slug}/admin/agenda`} className="card p-4 transition hover:border-brand-300">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon name="calendar" className="h-5 w-5" /></span><p className="mt-1 text-sm font-semibold">Agendar / encaixar</p>
          <p className="text-xs text-slate-500">Agenda diária e semanal</p>
        </Link>
        <Link to={`/c/${slug}/admin/pacientes`} className="card p-4 transition hover:border-brand-300">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon name="patients" className="h-5 w-5" /></span><p className="mt-1 text-sm font-semibold">Pacientes</p>
          <p className="text-xs text-slate-500">Cadastro e prontuário</p>
        </Link>
        <Link to={`/c/${slug}/admin/whatsapp`} className="card p-4 transition hover:border-brand-300">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon name="chat" className="h-5 w-5" /></span><p className="mt-1 text-sm font-semibold">WhatsApp</p>
          <p className="text-xs text-slate-500">Lembretes e confirmações</p>
        </Link>
        <Link to={`/c/${slug}/admin/relatorios`} className="card p-4 transition hover:border-brand-300">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon name="chart" className="h-5 w-5" /></span><p className="mt-1 text-sm font-semibold">Relatórios</p>
          <p className="text-xs text-slate-500">Produção e faltas</p>
        </Link>
      </div>
    </div>
  );
}

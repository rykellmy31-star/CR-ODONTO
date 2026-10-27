import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Card, Spinner, Stat, useAsync } from "../../components/ui";

interface Overview {
  clinics: Record<string, number>;
  users: Record<string, number>;
  appointments: Record<string, number>;
  messages: Record<string, number>;
  plans: number;
  subscriptions: { status: string; n: number }[];
}

export default function SuperOverviewPage() {
  const { data, loading, error } = useAsync<Overview>(() => api.get("/super/overview"), []);
  const trials = useAsync<{ clinics: { id: number; name: string; slug: string; trial_ends_at: string | null; status: string; expired: boolean }[] }>(
    () => api.get("/super/trials/expiring"),
    []
  );

  if (loading) return <Spinner />;
  if (error) return <Card title="Erro">{error}</Card>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Clínicas ativas" value={data.clinics.ativos ?? 0} hint={`${data.clinics.total ?? 0} cadastradas`} tone="good" />
        <Stat label="Suspensas / bloqueadas" value={(data.clinics.suspensos ?? 0) + (data.clinics.bloqueados ?? 0)} hint="Ação manual" tone="warn" />
        <Stat label="Consultas hoje" value={data.appointments.hoje ?? 0} hint={`${data.appointments.total ?? 0} no total`} />
        <Stat label="Mensagens enviadas" value={data.messages.enviados ?? 0} hint={`${data.messages.falhas ?? 0} falhas`} tone={Number(data.messages.falhas) > 0 ? "bad" : "good"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Assinaturas por situação" subtitle="Controle manual, sem gateway de pagamento">
          <ul className="space-y-2 text-sm">
            {(data.subscriptions ?? []).map((s) => (
              <li key={s.status} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="capitalize text-slate-700">{s.status}</span>
                <span className="font-bold tabular-nums text-slate-900">{s.n}</span>
              </li>
            ))}
            {(data.subscriptions ?? []).length === 0 && <p className="text-sm text-slate-500">Nenhuma assinatura registrada.</p>}
          </ul>
        </Card>

        <Card
          title="Avaliações gratuitas"
          subtitle="Clínicas com prazo de teste"
          actions={<Link to="/superadmin/clinicas" className="btn-secondary px-3 py-1.5 text-xs">Gerenciar</Link>}
        >
          {trials.loading && <Spinner label="Carregando..." />}
          <ul className="space-y-2 text-sm">
            {(trials.data?.clinics ?? []).slice(0, 6).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <Link to={`/superadmin/clinicas/${c.id}`} className="truncate font-medium text-slate-700 hover:underline">{c.name}</Link>
                <span className={`chip ${c.expired ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-800"}`}>
                  {c.trial_ends_at ? new Date(c.trial_ends_at).toLocaleDateString("pt-BR") : "sem prazo"}
                </span>
              </li>
            ))}
            {(trials.data?.clinics ?? []).length === 0 && !trials.loading && <p className="text-sm text-slate-500">Nenhuma em avaliação.</p>}
          </ul>
        </Card>
      </div>

      <Card title="Como funciona" subtitle="Responsabilidades da plataforma">
        <ul className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          <li>• Cadastro e ativação de consultórios</li>
          <li>• Planos, limites e prazo de avaliação</li>
          <li>• Bloqueio/reativação administrativa</li>
          <li>• Logs e indicadores operacionais</li>
        </ul>
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>Privacidade:</strong> o superadministrador não acessa prontuários nem dados clínicos dos pacientes. O modo suporte é
          somente leitura e auditado.
        </p>
      </Card>
    </div>
  );
}

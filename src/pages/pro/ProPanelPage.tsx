// Painel do dentista: agenda do dia, próximos dias e atalho para o prontuário.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, clinicBase, errorMessage } from "../../lib/api";
import { Badge, Button, Card, Spinner, Stat, Tabs, useToast } from "../../components/ui";
import { addDaysIso, formatDateBr, formatPhone, STATUS_LABEL, STATUS_STYLE, timeInTz, todayIso } from "../../lib/format";
import type { Appointment } from "../../lib/types";

const ACTIVE = ["agendado", "aguardando_confirmacao", "confirmado", "chegou", "em_atendimento"];

export default function ProPanelPage() {
  const { slug = "" } = useParams();
  const toast = useToast();
  const [tab, setTab] = useState<"hoje" | "proximos">("hoje");
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<Appointment[]>([]);
  const [nextDays, setNextDays] = useState<{ day: string; items: Appointment[] }[]>([]);
  const [timezone, setTimezone] = useState("America/Sao_Paulo");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await api.get<{ today: string; timezone: string; appointments: Appointment[] }>("/today");
      setTimezone(t.timezone || "America/Sao_Paulo");
      setToday(t.appointments ?? []);

      const base = t.today || todayIso();
      const days = [1, 2, 3, 4, 5, 6].map((n) => addDaysIso(base, n));
      const results = await Promise.all(
        days.map((day) =>
          api
            .get<{ appointments: Appointment[] }>(`/agenda?day=${day}`)
            .then((r) => ({ day, items: r.appointments ?? [] }))
            .catch(() => ({ day, items: [] }))
        )
      );
      setNextDays(results.filter((r) => r.items.length > 0));
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const pending = today.filter((a) => ACTIVE.includes(a.status));
  const done = today.filter((a) => a.status === "concluido");

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Painel do dentista</p>
          <h1 className="text-xl font-bold text-slate-900">Minha agenda</h1>
          <p className="text-xs text-slate-500">{formatDateBr(todayIso(timezone))}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}>Atualizar</Button>
          <Link to={`/c/${slug}/admin/agenda`} className="btn-primary px-3 py-1.5 text-xs">Agenda completa</Link>
          <Link to="/trocar-senha" className="btn-ghost px-3 py-1.5 text-xs">Trocar senha</Link>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Hoje" value={today.length} />
        <Stat label="Aguardando" value={pending.length} tone="warn" />
        <Stat label="Concluídos" value={done.length} tone="good" />
      </div>

      <Tabs
        tabs={[{ id: "hoje", label: "Hoje" }, { id: "proximos", label: "Próximos dias" }]}
        value={tab}
        onChange={(t) => setTab(t as never)}
      />

      {loading && <Spinner />}

      {!loading && tab === "hoje" && (
        <Card title="Atendimentos de hoje" subtitle="Toque no paciente para abrir o prontuário">
          {today.length === 0 && <p className="text-sm text-slate-500">Nenhum atendimento hoje.</p>}
          <div className="space-y-1.5">
            {today.map((a) => <AgendaRow key={a.id} item={a} slug={slug} timezone={timezone} />)}
          </div>
        </Card>
      )}

      {!loading && tab === "proximos" && (
        <div className="space-y-3">
          {nextDays.map((d) => (
            <Card key={d.day} title={formatDateBr(d.day)} subtitle={`${d.items.length} atendimento(s)`}>
              <div className="space-y-1.5">
                {d.items.map((a) => <AgendaRow key={a.id} item={a} slug={slug} timezone={timezone} />)}
              </div>
            </Card>
          ))}
          {nextDays.length === 0 && <p className="text-sm text-slate-500">Nenhum atendimento nos próximos dias.</p>}
        </div>
      )}

      <p className="text-center text-[11px] text-slate-400">
        {clinicBase() ? "Acesso clínico registrado na auditoria da clínica." : ""}
      </p>
    </div>
  );
}

function AgendaRow({ item, slug, timezone }: { item: Appointment; slug: string; timezone: string }) {
  return (
    <Link
      to={`/c/${slug}/admin/pacientes/${item.patient_id}`}
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 transition hover:border-brand-300 hover:bg-brand-50/30"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-12 shrink-0 text-sm font-bold tabular-nums text-brand-800">{timeInTz(item.starts_at, timezone)}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">
            {item.patient_name}
            {item.is_fit_in ? <Badge className="ml-1 bg-amber-100 text-amber-800">encaixe</Badge> : null}
          </p>
          <p className="truncate text-xs text-slate-500">
            {item.procedure_name ?? "Consulta"} · {item.procedure_duration ?? 30} min
            {item.unit_name ? ` · ${item.unit_name}` : ""} · {formatPhone(item.patient_phone)}
          </p>
        </div>
      </div>
      <span className={`chip ${STATUS_STYLE[item.status] ?? "bg-slate-100 text-slate-700"}`}>
        {STATUS_LABEL[item.status] ?? item.status}
      </span>
    </Link>
  );
}

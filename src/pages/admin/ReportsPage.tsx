import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Button, Card, Field, Input, Select, Spinner, Stat, Tabs, useToast } from "../../components/ui";
import { addDaysIso, formatDateBr, formatPhone, STATUS_LABEL, todayIso } from "../../lib/format";
import type { Professional } from "../../lib/types";

interface Summary {
  range: { from: string; to: string };
  summary: Record<string, number>;
  by_professional: { professional_id: number; professional_name: string; total: number; concluidos: number; faltas: number; cancelados: number }[];
  by_day: { day: string; total: number; concluidos: number; faltas: number }[];
  awaiting_return: { id: number; code: string; completed_at: string; patient_id: number; patient_name: string; phone: string; professional_name: string }[];
}
interface WhatsAppReport {
  stats: { total?: number; enviados?: number; falhas?: number; pendentes?: number; cancelados?: number };
  whatsapp_confirmations: number;
  messages: { id: number; kind: string; status: string; patient_name: string | null; appointment_code: string | null; sent_at: string | null; last_error: string }[];
}

export default function ReportsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<"operacional" | "whatsapp">("operacional");
  const [from, setFrom] = useState(addDaysIso(todayIso(), -6));
  const [to, setTo] = useState(todayIso());
  const [professionalId, setProfessionalId] = useState("");
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [wa, setWa] = useState<WhatsAppReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from, to });
      if (professionalId) qs.set("professional_id", professionalId);
      const [s, w] = await Promise.all([
        api.get<Summary>(`/reports/summary?${qs.toString()}`),
        api.get<WhatsAppReport>("/reports/whatsapp?limit=80"),
      ]);
      setSummary(s);
      setWa(w);
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [from, to, professionalId, toast]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ professionals: Professional[] }>("/professionals");
        setProfessionals(res.professionals);
      } catch {
        /* filtro opcional */
      }
    })();
  }, []);

  useEffect(() => { void load(); }, [load]);

  const s = summary?.summary ?? {};
  const n = (k: string) => Number(s[k] ?? 0);
  const comparecimento = n("concluidos") + n("faltas") > 0
    ? Math.round((n("concluidos") / (n("concluidos") + n("faltas"))) * 100)
    : null;

  return (
    <div className="space-y-4">
      <Tabs
        tabs={[{ id: "operacional", label: "Operacional" }, { id: "whatsapp", label: "WhatsApp" }]}
        value={tab}
        onChange={(t) => setTab(t as never)}
      />

      {tab === "operacional" && (
        <>
          <Card title="Filtros">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="De"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="Até"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              <Field label="Dentista">
                <Select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                  <option value="">Todos</option>
                  {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <div className="flex items-end gap-2">
                <Button loading={loading} onClick={load}>Aplicar</Button>
                <Button variant="ghost" onClick={() => { setFrom(addDaysIso(todayIso(), -29)); setTo(todayIso()); }}>30 dias</Button>
              </div>
            </div>
          </Card>

          {loading && <Spinner />}

          {summary && !loading && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Agendados" value={n("total")} hint="no período" />
                <Stat label="Concluídos" value={n("concluidos")} tone="good" />
                <Stat label="Faltas" value={n("faltas")} tone="bad" />
                <Stat label="Encaixes" value={n("encaixes")} tone="warn" />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Confirmados" value={n("confirmados")} />
                <Stat label="Confirmados por WhatsApp" value={n("confirmados_whatsapp")} />
                <Stat label="Cancelados" value={n("cancelados")} />
                <Stat label="Comparecimento" value={comparecimento === null ? "—" : `${comparecimento}%`} hint="concluídos ÷ (concluídos + faltas)" />
              </div>

              <Card title="Por profissional">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="py-1">Dentista</th><th>Total</th><th>Concluídos</th><th>Faltas</th><th>Cancelados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.by_professional.map((p) => (
                        <tr key={p.professional_id} className="border-t border-slate-100">
                          <td className="py-1.5 font-medium text-slate-800">{p.professional_name}</td>
                          <td>{p.total}</td><td>{p.concluidos}</td><td>{p.faltas}</td><td>{p.cancelados}</td>
                        </tr>
                      ))}
                      {summary.by_professional.length === 0 && (
                        <tr><td colSpan={5} className="py-3 text-center text-slate-500">Sem dados no período.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Por dia">
                  <div className="flex h-40 items-end gap-1">
                    {summary.by_day.map((d) => {
                      const max = Math.max(...summary.by_day.map((x) => x.total), 1);
                      return (
                        <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.total} agendamentos`}>
                          <div className="flex w-full flex-col justify-end" style={{ height: "100%" }}>
                            <div className="w-full rounded-t bg-brand-600" style={{ height: `${(d.total / max) * 100}%` }} />
                          </div>
                          <span className="text-[9px] text-slate-500">{d.day.slice(8, 10)}/{d.day.slice(5, 7)}</span>
                        </div>
                      );
                    })}
                    {summary.by_day.length === 0 && <p className="text-sm text-slate-500">Sem dados.</p>}
                  </div>
                </Card>

                <Card title="Aguardando retorno" subtitle="Pacientes que pediram para agendar depois">
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {summary.awaiting_return.map((a) => (
                      <div key={a.id} className="rounded-lg bg-slate-50 px-2 py-1.5 text-xs">
                        <p className="font-semibold text-slate-800">{a.patient_name}</p>
                        <p className="text-slate-500">
                          {formatPhone(a.phone)} · concluído em {formatDateBr(a.completed_at.slice(0, 10))} · {a.professional_name}
                        </p>
                      </div>
                    ))}
                    {summary.awaiting_return.length === 0 && <p className="text-sm text-slate-500">Ninguém aguardando retorno.</p>}
                  </div>
                </Card>
              </div>
            </>
          )}
        </>
      )}

      {tab === "whatsapp" && (
        <>
          {loading && <Spinner />}
          {wa && !loading && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Stat label="Total" value={wa.stats.total ?? 0} />
                <Stat label="Enviadas" value={wa.stats.enviados ?? 0} tone="good" />
                <Stat label="Falhas" value={wa.stats.falhas ?? 0} tone="bad" />
                <Stat label="Pendentes" value={wa.stats.pendentes ?? 0} tone="warn" />
                <Stat label="Confirmações" value={wa.whatsapp_confirmations} hint="via WhatsApp" />
              </div>
              <Card title="Histórico de mensagens">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="py-1">Tipo</th><th>Paciente</th><th>Consulta</th><th>Status</th><th>Enviada em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wa.messages.map((m) => (
                        <tr key={m.id} className="border-t border-slate-100">
                          <td className="py-1.5">{m.kind}</td>
                          <td>{m.patient_name ?? "—"}</td>
                          <td>{m.appointment_code ?? "—"}</td>
                          <td className={m.status === "falhou" ? "text-rose-600" : m.status === "enviado" ? "text-emerald-700" : ""}>
                            {m.status}{STATUS_LABEL[m.status] ? "" : ""}
                          </td>
                          <td>{m.sent_at ? new Date(m.sent_at).toLocaleString("pt-BR") : "—"}</td>
                        </tr>
                      ))}
                      {wa.messages.length === 0 && (
                        <tr><td colSpan={5} className="py-3 text-center text-slate-500">Nenhuma mensagem registrada.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

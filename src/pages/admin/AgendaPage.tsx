import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, errorMessage } from "../../lib/api";
import { Icon } from "../../components/Icons";
import {
  Badge, Button, Card, Field, Input, Modal, Select, Spinner, Tabs, Textarea, useToast,
} from "../../components/ui";
import {
  addDaysIso, formatDateBr, formatMoney, PAYMENT_METHODS, timeInTz, todayIso, weekdayLabel,
  STATUS_LABEL, STATUS_STYLE,
} from "../../lib/format";
import type { Appointment, PatientRow, Professional, Procedure } from "../../lib/types";

interface AgendaData { appointments: Appointment[]; today: string; timezone: string }

export default function AgendaPage() {
  const { slug = "" } = useParams();
  const toast = useToast();
  const [day, setDay] = useState(todayIso());
  const [view, setView] = useState<"day" | "week" | "month">("day");
  const [data, setData] = useState<AgendaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [professionalFilter, setProfessionalFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Appointment | null>(null);
  const [finishTarget, setFinishTarget] = useState<Appointment | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (view === "day") qs.set("day", day);
      else if (view === "week") {
        qs.set("from", day);
        qs.set("to", addDaysIso(day, 6));
      } else {
        // Visão mensal: do primeiro ao último dia do mês da data selecionada.
        const [y, m] = day.split("-").map(Number);
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        qs.set("from", `${y}-${String(m).padStart(2, "0")}-01`);
        qs.set("to", `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`);
      }
      if (professionalFilter) qs.set("professional_id", professionalFilter);
      const res = await api.get<AgendaData>(`/appointments?${qs}`);
      setData(res);
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [day, view, professionalFilter, toast]);

  useEffect(() => { void load(); }, [load]);

  const loadWaitlist = useCallback(() => {
    api.get<{ entries: WaitlistEntry[] }>("/waitlist")
      .then((r) => setWaitlist(r.entries))
      .catch(() => setWaitlist([]));
  }, []);

  useEffect(() => {
    api.get<{ professionals: Professional[] }>("/professionals").then((r) => setProfessionals(r.professionals)).catch(() => null);
    api.get<{ procedures: Procedure[] }>("/procedures").then((r) => setProcedures(r.procedures)).catch(() => null);
    loadWaitlist();
  }, [slug, loadWaitlist]);

  async function action(id: number, path: string, body?: unknown) {
    try {
      await api.post(`/appointments/${id}/${path}`, body ?? {});
      toast.push("Agenda atualizada.", "success");
      setDetail(null);
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of data?.appointments ?? []) {
      const key = view === "day" ? a.professional_name : a.local_day;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data, view]);

  const timezone = data?.timezone ?? "America/Sao_Paulo";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={() => setDay(shiftPeriod(day, view, -1))} aria-label="Período anterior"><Icon name="chevron-left" className="h-4 w-4" /></Button>
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-[150px]" />
          <Button variant="secondary" size="sm" onClick={() => setDay(shiftPeriod(day, view, 1))} aria-label="Próximo período"><Icon name="chevron-right" className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setDay(todayIso())}>Hoje</Button>
        </div>
        <Select value={professionalFilter} onChange={(e) => setProfessionalFilter(e.target.value)} className="max-w-[220px]">
          <option value="">Todos os dentistas</option>
          {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <div className="ml-auto flex gap-2">
          <Tabs
            tabs={[{ id: "day", label: "Dia" }, { id: "week", label: "7 dias" }, { id: "month", label: "Mês" }]}
            value={view}
            onChange={(v) => setView(v as "day" | "week" | "month")}
          />
          <Button onClick={() => setCreateOpen(true)}>+ Agendar</Button>
        </div>
      </div>

      <Card
        title={
          view === "day"
            ? formatDateBr(day)
            : view === "week"
              ? `${formatDateBr(day)} – ${formatDateBr(addDaysIso(day, 6))}`
              : monthLabel(day)
        }
        subtitle={`${data?.appointments.length ?? 0} agendamento(s) · fuso ${timezone}`}
        actions={<Button variant="secondary" size="sm" onClick={load}>Atualizar</Button>}
      >
        {loading && <Spinner />}
        {!loading && grouped.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">Nenhum agendamento nesta data.</p>
        )}
        <div className="space-y-4">
          {grouped.map(([group, items]) => (
            <div key={group}>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                {view === "day" ? group : weekdayLabel(group)}
              </p>
              <div className="space-y-2">
                {items.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setDetail(a)}
                    className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-brand-300 hover:shadow-sm"
                  >
                    <span className="grid h-12 w-16 shrink-0 place-items-center rounded-lg bg-slate-100 text-sm font-bold tabular-nums text-slate-700">
                      {timeInTz(a.starts_at, timezone)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-slate-800">{a.patient_name}</span>
                        {a.is_fit_in ? <Badge className="bg-orange-100 text-orange-800">Encaixe</Badge> : null}
                        {a.kind === "retorno" ? <Badge className="bg-sky-100 text-sky-800">Retorno</Badge> : null}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {a.procedure_name ?? "Consulta"} · {a.professional_name}
                        {view === "day" ? "" : ` · ${formatDateBr(a.local_day)}`}
                      </span>
                    </span>
                    <span className={`chip shrink-0 ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Lista de espera"
        subtitle={`${waitlist.length} paciente(s) aguardando vaga`}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setWaitlistOpen(true)}>+ Adicionar</Button>
        }
      >
        {waitlist.length === 0 && (
          <p className="text-sm text-slate-500">
            Ninguém na lista de espera. Ao liberar um horário, use esta lista para encaixar o paciente.
          </p>
        )}
        <div className="space-y-1.5">
          {waitlist.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{w.patient_name}</p>
                <p className="text-xs text-slate-500">
                  a partir de {formatDateBr(w.desired_from)}
                  {w.preferred_period !== "any" ? ` · ${PERIOD_LABEL[w.preferred_period] ?? w.preferred_period}` : ""}
                  {w.professional_name ? ` · ${w.professional_name}` : " · qualquer dentista"}
                  {w.procedure_name ? ` · ${w.procedure_name}` : ""}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => setDay(w.desired_from)}>Ver agenda</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await api.post(`/waitlist/${w.id}/status`, { status: "contatado" });
                      toast.push("Paciente marcado como contatado.", "success");
                      loadWaitlist();
                    } catch (e) {
                      toast.push(errorMessage(e), "error");
                    }
                  }}
                >
                  Contatado
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    try {
                      await api.post(`/waitlist/${w.id}/status`, { status: "cancelado" });
                      toast.push("Removido da lista de espera.", "success");
                      loadWaitlist();
                    } catch (e) {
                      toast.push(errorMessage(e), "error");
                    }
                  }}
                >
                  Remover
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {waitlistOpen && (
        <WaitlistDialog
          professionals={professionals}
          procedures={procedures}
          today={data?.today ?? todayIso()}
          onClose={() => setWaitlistOpen(false)}
          onSaved={() => { setWaitlistOpen(false); loadWaitlist(); }}
        />
      )}

      {createOpen && (
        <CreateAppointmentDialog
          professionals={professionals}
          procedures={procedures}
          day={day}
          timezone={timezone}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); void load(); }}
        />
      )}

      {detail && (
        <Modal
          open
          onClose={() => setDetail(null)}
          title={`${detail.patient_name} · ${timeInTz(detail.starts_at, timezone)}`}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              {["agendado", "aguardando_confirmacao"].includes(detail.status) && (
                <Button size="sm" onClick={() => action(detail.id, "confirm")}>Confirmar</Button>
              )}
              {["agendado", "aguardando_confirmacao", "confirmado"].includes(detail.status) && (
                <Button size="sm" variant="secondary" onClick={() => action(detail.id, "checkin")}>Chegou</Button>
              )}
              {["chegou", "confirmado", "agendado"].includes(detail.status) && (
                <Button size="sm" variant="secondary" onClick={() => action(detail.id, "start")}>Iniciar</Button>
              )}
              {!["concluido", "cancelado", "reagendado", "nao_compareceu"].includes(detail.status) && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => { setRescheduleTarget(detail); setDetail(null); }}>Reagendar</Button>
                  <Button size="sm" variant="danger" onClick={() => { setCancelTarget(detail); setDetail(null); }}>Cancelar</Button>
                </>
              )}
              {["chegou", "em_atendimento", "confirmado", "agendado"].includes(detail.status) && (
                <Button size="sm" onClick={() => { setFinishTarget(detail); setDetail(null); }}>Finalizar atendimento</Button>
              )}
            </div>
          }
        >
          <dl className="space-y-2 text-sm">
            <Row label="Protocolo" value={<span className="font-mono">{detail.code}</span>} />
            <Row label="Paciente" value={`${detail.patient_name} · ${detail.patient_code}`} />
            <Row label="Contato" value={detail.patient_phone || "—"} />
            <Row label="Procedimento" value={detail.procedure_name ?? "Consulta"} />
            <Row label="Dentista" value={detail.professional_name} />
            <Row label="Unidade" value={detail.unit_name ?? "—"} />
            <Row label="Sala/cadeira" value={detail.room_name ?? "—"} />
            <Row label="Situação" value={<span className={`chip ${STATUS_STYLE[detail.status]}`}>{STATUS_LABEL[detail.status]}</span>} />
            <Row label="Confirmação" value={detail.confirmed_at ? `${new Date(detail.confirmed_at).toLocaleString("pt-BR")} (${detail.confirmed_via})` : "—"} />
            {detail.price_cents > 0 && <Row label="Valor informativo" value={formatMoney(detail.price_cents)} />}
            {detail.patient_notes && <Row label="Observação do paciente" value={detail.patient_notes} />}
            {detail.is_fit_in ? <Row label="Encaixe" value="Autorizado — registrado na auditoria" /> : null}
          </dl>
        </Modal>
      )}

      {finishTarget && (
        <FinishDialog
          appointment={finishTarget}
          timezone={timezone}
          professionals={professionals}
          procedures={procedures}
          onClose={() => setFinishTarget(null)}
          onDone={() => { setFinishTarget(null); void load(); }}
        />
      )}

      {rescheduleTarget && (
        <RescheduleDialog
          appointment={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          onDone={() => { setRescheduleTarget(null); void load(); }}
        />
      )}

      {cancelTarget && (
        <CancelDialog
          appointment={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={() => { setCancelTarget(null); void load(); }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-1.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-right text-sm text-slate-700">{value}</dd>
    </div>
  );
}

// ── Criar agendamento (com encaixe) ────────────────────────────────────────
function CreateAppointmentDialog({
  professionals, procedures, day, timezone, onClose, onCreated,
}: {
  professionals: Professional[]; procedures: Procedure[]; day: string; timezone: string;
  onClose: () => void; onCreated: () => void;
}) {
  const toast = useToast();
  const [patientQuery, setPatientQuery] = useState("");
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [professionalId, setProfessionalId] = useState<string>(professionals[0]?.id ? String(professionals[0].id) : "");
  const [procedureId, setProcedureId] = useState<string>("");
  const [date, setDate] = useState(day);
  const [slots, setSlots] = useState<{ time: string; free: boolean }[]>([]);
  const [time, setTime] = useState("");
  const [fitIn, setFitIn] = useState(false);
  const [fitInReason, setFitInReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [newPatient, setNewPatient] = useState(false);
  const [np, setNp] = useState({ name: "", phone: "", birth_date: "", cpf: "", whatsapp_optin: true });

  useEffect(() => {
    if (patientQuery.trim().length < 2) { setPatients([]); return; }
    const t = setTimeout(() => {
      api.get<{ patients: PatientRow[] }>(`/patients?q=${encodeURIComponent(patientQuery)}`)
        .then((r) => setPatients(r.patients)).catch(() => setPatients([]));
    }, 250);
    return () => clearTimeout(t);
  }, [patientQuery]);

  const loadSlots = useCallback(async () => {
    if (!professionalId) return;
    const qs = new URLSearchParams({ professional_id: professionalId, day: date });
    if (procedureId) qs.set("procedure_id", procedureId);
    try {
      const res = await api.get<{ slotsDetailed: { time: string; free: boolean }[] }>(`/availability?${qs}`);
      setSlots(res.slotsDetailed ?? []);
    } catch {
      setSlots([]);
    }
  }, [professionalId, procedureId, date]);

  useEffect(() => { void loadSlots(); }, [loadSlots]);

  async function createPatientInline() {
    try {
      const res = await api.post<{ id: number; code: string; duplicates?: unknown[] }>("/patients", { ...np, force_create: true });
      setPatient({ id: res.id, code: res.code, name: np.name, phone: np.phone, birth_date: np.birth_date || null, last_visit: null });
      setNewPatient(false);
      toast.push("Paciente cadastrado.", "success");
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }

  async function submit() {
    if (!patient) return toast.push("Selecione o paciente.", "error");
    if (!professionalId || !time) return toast.push("Escolha dentista e horário.", "error");
    if (fitIn && !fitInReason.trim()) return toast.push("Informe o motivo do encaixe.", "error");
    setBusy(true);
    try {
      const res = await api.post<{ code: string; reminders?: { created: number } }>("/appointments", {
        patient_id: patient.id,
        professional_id: Number(professionalId),
        procedure_id: procedureId ? Number(procedureId) : null,
        day: date,
        time,
        internal_notes: notes,
        is_fit_in: fitIn,
        fit_in_reason: fitInReason,
      });
      toast.push(`Consulta ${res.code} agendada.${res.reminders?.created ? " Lembretes programados." : ""}`, "success");
      onCreated();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Novo agendamento" size="lg">
      <div className="space-y-3">
        {!patient ? (
          <Card title="1. Paciente" className="border-slate-100">
            <div className="flex gap-2">
              <Input placeholder="Buscar por nome, telefone ou código" value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)} />
              <Button variant="secondary" onClick={() => setNewPatient((v) => !v)}>+ Novo</Button>
            </div>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {patients.map((p) => (
                <button key={p.id} onClick={() => setPatient(p)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100">
                  <span className="font-medium text-slate-800">{p.name}</span>
                  <span className="ml-2 text-xs text-slate-500">{p.code} · {p.phone}</span>
                </button>
              ))}
              {patientQuery.length >= 2 && patients.length === 0 && (
                <p className="px-2 py-3 text-xs text-slate-500">Nenhum paciente encontrado. Use “+ Novo” para cadastrar.</p>
              )}
            </div>
            {newPatient && (
              <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3">
                <Field label="Nome completo" required><Input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="WhatsApp" required><Input value={np.phone} onChange={(e) => setNp({ ...np, phone: e.target.value })} /></Field>
                  <Field label="Nascimento"><Input type="date" value={np.birth_date} onChange={(e) => setNp({ ...np, birth_date: e.target.value })} /></Field>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={np.whatsapp_optin} onChange={(e) => setNp({ ...np, whatsapp_optin: e.target.checked })} />
                  Autoriza lembretes por WhatsApp
                </label>
                <Button size="sm" onClick={createPatientInline}>Cadastrar paciente</Button>
              </div>
            )}
          </Card>
        ) : (
          <div className="flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-brand-900">{patient.name}</p>
              <p className="text-xs text-brand-700">{patient.code} · {patient.phone}</p>
            </div>
            <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setPatient(null)}>trocar</button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dentista" required>
            <Select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
              <option value="">Selecione</option>
              {professionals.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Procedimento">
            <Select value={procedureId} onChange={(e) => setProcedureId(e.target.value)}>
              <option value="">Consulta padrão</option>
              {procedures.filter((p) => p.active).map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.duration_min} min)</option>
              ))}
            </Select>
          </Field>
          <Field label="Dia" required>
            <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }} />
          </Field>
          <Field label="Encaixe" hint="Permite horário sobreposto com autorização registrada">
            <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
              <input type="checkbox" checked={fitIn} onChange={(e) => setFitIn(e.target.checked)} />
              Este é um encaixe excepcional
            </label>
          </Field>
        </div>

        {fitIn && (
          <Field label="Motivo do encaixe" required>
            <Input value={fitInReason} onChange={(e) => setFitInReason(e.target.value)} placeholder="Ex.: paciente com dor aguda" />
          </Field>
        )}

        <div>
          <p className="label">Horário ({date ? formatDateBr(date) : "—"})</p>
          <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
            {slots.map((s) => (
              <button
                key={s.time}
                onClick={() => setTime(s.time)}
                disabled={!s.free && !fitIn}
                className={`rounded-lg border py-1.5 text-xs font-semibold ${
                  time === s.time ? "border-brand-600 bg-brand-700 text-white"
                    : s.free ? "border-slate-200 bg-white text-slate-700 hover:border-brand-300"
                    : "border-slate-200 bg-slate-100 text-slate-400"
                }`}
              >
                {s.time}
              </button>
            ))}
            {slots.length === 0 && <p className="col-span-6 text-xs text-slate-500">Sem grade para este dia (verifique a escala do dentista).</p>}
          </div>
          {!time && <p className="mt-1 text-xs text-slate-500">Selecione um horário livre. Horários ocupados só aparecem se for encaixe.</p>}
        </div>

        <Field label="Observação interna (opcional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={submit} disabled={!patient || !time}>Agendar</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Finalizar atendimento ─────────────────────────────────────────────────
function FinishDialog({
  appointment, timezone, professionals, procedures, onClose, onDone,
}: {
  appointment: Appointment; timezone: string; professionals: Professional[]; procedures: Procedure[];
  onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [choice, setChoice] = useState<"scheduled" | "later" | "none">("none");
  const [returnDay, setReturnDay] = useState(addDaysIso(appointment.local_day, 7));
  const [returnTime, setReturnTime] = useState("");
  const [returnProcedure, setReturnProcedure] = useState(appointment.procedure_id ? String(appointment.procedure_id) : "");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payment, setPayment] = useState({ method: "nao_informado", amount_cents: "" });
  const [slots, setSlots] = useState<{ time: string; free: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [needsRecord, setNeedsRecord] = useState(false);

  useEffect(() => {
    if (choice !== "scheduled") return;
    const qs = new URLSearchParams({ professional_id: String(appointment.professional_id), day: returnDay });
    if (returnProcedure) qs.set("procedure_id", returnProcedure);
    api.get<{ slotsDetailed: { time: string; free: boolean }[] }>(`/availability?${qs}`)
      .then((r) => setSlots((r.slotsDetailed ?? []).filter((s) => s.free)))
      .catch(() => setSlots([]));
  }, [choice, returnDay, returnProcedure, appointment.professional_id]);

  async function submit() {
    setBusy(true);
    setNeedsRecord(false);
    try {
      await api.post(`/appointments/${appointment.id}/finish`, {
        followup_choice: choice,
        return_day: choice === "scheduled" ? returnDay : undefined,
        return_time: choice === "scheduled" ? returnTime : undefined,
        return_procedure_id: choice === "scheduled" && returnProcedure ? Number(returnProcedure) : null,
        payment: paymentOpen
          ? { method: payment.method, amount_cents: payment.amount_cents ? Math.round(Number(payment.amount_cents) * 100) : null, note: "" }
          : null,
      });
      toast.push("Atendimento finalizado.", "success");
      onDone();
    } catch (e) {
      const err = e as { status?: number; message: string };
      if (err.status === 422 && /evolução clínica/i.test(err.message)) setNeedsRecord(true);
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Finalizar atendimento"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={submit} disabled={choice === "scheduled" && !returnTime}>
            Finalizar
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-semibold text-slate-800">{appointment.patient_name}</p>
          <p className="text-xs text-slate-600">
            {formatDateBr(appointment.local_day)} · {timeInTz(appointment.starts_at, timezone)} ·{" "}
            {appointment.procedure_name ?? "Consulta"} · {appointment.professional_name}
          </p>
          <p className="mt-1 text-xs text-slate-500">Protocolo {appointment.code}</p>
        </div>

        {needsRecord && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Esta clínica exige registro clínico antes de finalizar. Abra o prontuário do paciente, registre a evolução e
            volte para finalizar.
          </p>
        )}

        <div>
          <p className="label">Próxima consulta</p>
          <div className="space-y-2">
            {[
              { id: "scheduled", title: "Agendar retorno agora", desc: "Escolha data e horário com o mesmo dentista." },
              { id: "later", title: "Deixar o paciente agendar depois", desc: "O paciente escolhe pelo portal do paciente." },
              { id: "none", title: "Não necessita de retorno", desc: "Encerrar sem novo agendamento." },
            ].map((opt) => (
              <label
                key={opt.id}
                className={`flex cursor-pointer gap-2 rounded-xl border p-3 ${choice === opt.id ? "border-brand-600 bg-brand-50" : "border-slate-200"}`}
              >
                <input type="radio" checked={choice === opt.id} onChange={() => setChoice(opt.id as never)} className="mt-1" />
                <span>
                  <span className="block text-sm font-semibold text-slate-800">{opt.title}</span>
                  <span className="block text-xs text-slate-500">{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {choice === "scheduled" && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Dia do retorno" required>
              <Input type="date" value={returnDay} onChange={(e) => { setReturnDay(e.target.value); setReturnTime(""); }} />
            </Field>
            <Field label="Procedimento">
              <Select value={returnProcedure} onChange={(e) => setReturnProcedure(e.target.value)}>
                <option value="">Mesmo procedimento</option>
                {procedures.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Horário" required>
              <Select value={returnTime} onChange={(e) => setReturnTime(e.target.value)}>
                <option value="">Selecione</option>
                {slots.map((s) => <option key={s.time} value={s.time}>{s.time}</option>)}
              </Select>
            </Field>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 p-3">
          <button className="flex w-full items-center justify-between text-left" onClick={() => setPaymentOpen((v) => !v)}>
            <span>
              <span className="block text-sm font-semibold text-slate-800">Registrar pagamento (opcional)</span>
              <span className="block text-xs text-slate-500">Nenhuma cobrança é processada pelo sistema.</span>
            </span>
            <span className="text-slate-400">{paymentOpen ? "▲" : "▼"}</span>
          </button>
          {paymentOpen && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Field label="Valor (R$)">
                <Input inputMode="decimal" placeholder="0,00" value={payment.amount_cents} onChange={(e) => setPayment({ ...payment, amount_cents: e.target.value })} />
              </Field>
              <Field label="Forma">
                <Select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })}>
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </Select>
              </Field>
            </div>
          )}
        </div>

        <p className="text-[11px] text-slate-500">
          Dentistas disponíveis: {professionals.length}. O retorno herda a sala/cadeira do atendimento atual quando possível.
        </p>
      </div>
    </Modal>
  );
}

// ── Reagendar ─────────────────────────────────────────────────────────────
function RescheduleDialog({ appointment, onClose, onDone }: { appointment: Appointment; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [day, setDay] = useState(addDaysIso(appointment.local_day, 1));
  const [slots, setSlots] = useState<{ time: string; free: boolean }[]>([]);
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const qs = new URLSearchParams({ professional_id: String(appointment.professional_id), day });
    if (appointment.procedure_id) qs.set("procedure_id", String(appointment.procedure_id));
    api.get<{ slotsDetailed: { time: string; free: boolean }[] }>(`/availability?${qs}`)
      .then((r) => setSlots((r.slotsDetailed ?? []).filter((s) => s.free)))
      .catch(() => setSlots([]));
  }, [day, appointment.professional_id, appointment.procedure_id]);

  async function submit() {
    if (!time) return toast.push("Escolha o novo horário.", "error");
    setBusy(true);
    try {
      await api.post(`/appointments/${appointment.id}/reschedule`, { day, time, reason, send_message: true });
      toast.push("Consulta reagendada. O paciente será avisado.", "success");
      onDone();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Reagendar consulta"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={submit}>Reagendar</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          {appointment.patient_name} · atualmente {formatDateBr(appointment.local_day)} com {appointment.professional_name}
        </p>
        <Field label="Novo dia" required>
          <Input type="date" value={day} onChange={(e) => { setDay(e.target.value); setTime(""); }} />
        </Field>
        <div>
          <p className="label">Horários livres</p>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {slots.map((s) => (
              <button
                key={s.time}
                onClick={() => setTime(s.time)}
                className={`rounded-lg border py-1.5 text-xs font-semibold ${
                  time === s.time ? "border-brand-600 bg-brand-700 text-white" : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                {s.time}
              </button>
            ))}
          </div>
          {slots.length === 0 && <p className="text-xs text-slate-500">Nenhum horário livre neste dia.</p>}
        </div>
        <Field label="Motivo (opcional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <p className="text-[11px] text-slate-500">
          O horário anterior é liberado somente depois que a nova reserva é concluída com sucesso.
        </p>
      </div>
    </Modal>
  );
}

// ── Cancelar ──────────────────────────────────────────────────────────────
function CancelDialog({ appointment, onClose, onDone }: { appointment: Appointment; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("paciente_desistiu");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/appointments/${appointment.id}/cancel`, { reason_code: code, reason });
      toast.push("Consulta cancelada.", "success");
      onDone();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Cancelar consulta"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Voltar</Button>
          <Button variant="danger" loading={busy} onClick={submit}>Cancelar consulta</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          {appointment.patient_name} · {formatDateBr(appointment.local_day)} · {appointment.professional_name}
        </p>
        <Field label="Motivo">
          <Select value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="paciente_desistiu">Paciente desistiu</option>
            <option value="reagendamento">Vai reagendar</option>
            <option value="profissional_indisponivel">Profissional indisponível</option>
            <option value="emergencia">Emergência</option>
            <option value="outro">Outro</option>
          </Select>
        </Field>
        <Field label="Detalhes (opcional)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <p className="text-xs text-slate-500">Os lembretes pendentes desta consulta serão cancelados automaticamente.</p>
      </div>
    </Modal>
  );
}

interface WaitlistEntry {
  id: number;
  desired_from: string;
  desired_to: string | null;
  preferred_period: "any" | "morning" | "afternoon" | "evening";
  notes: string;
  status: string;
  patient_id: number;
  patient_name: string;
  phone: string;
  professional_name: string | null;
  procedure_name: string | null;
}

const PERIOD_LABEL: Record<string, string> = {
  any: "qualquer horário",
  morning: "manhã",
  afternoon: "tarde",
  evening: "noite",
};

function monthLabel(day: string): string {
  const [y, m] = day.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shiftPeriod(day: string, view: "day" | "week" | "month", step: number): string {
  if (view === "day") return addDaysIso(day, step);
  if (view === "week") return addDaysIso(day, step * 7);
  const [y, m] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + step, 1));
  return target.toISOString().slice(0, 10);
}

function WaitlistDialog({
  professionals, procedures, today, onClose, onSaved,
}: {
  professionals: Professional[];
  procedures: Procedure[];
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientRow[]>([]);
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [form, setForm] = useState({
    desired_from: today, desired_to: "", preferred_period: "any",
    professional_id: "", procedure_id: "", notes: "",
  });

  useEffect(() => {
    if (!query || query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get<{ patients: PatientRow[] }>(`/patients?q=${encodeURIComponent(query)}`)
        .then((r) => setResults(r.patients.slice(0, 6)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function save() {
    if (!patient) return toast.push("Selecione o paciente.", "error");
    setBusy(true);
    try {
      await api.post("/waitlist", {
        patient_id: patient.id,
        desired_from: form.desired_from,
        desired_to: form.desired_to || null,
        preferred_period: form.preferred_period,
        professional_id: form.professional_id ? Number(form.professional_id) : null,
        procedure_id: form.procedure_id ? Number(form.procedure_id) : null,
        notes: form.notes,
      });
      toast.push("Paciente adicionado à lista de espera.", "success");
      onSaved();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Adicionar à lista de espera"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={save}>Adicionar</Button>
        </div>
      }
    >
      <div className="space-y-3">
        {patient ? (
          <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm">
            <strong className="text-brand-900">{patient.name}</strong>
            <span className="ml-2 text-xs text-brand-800">{patient.phone}</span>
            <button className="ml-2 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setPatient(null)}>trocar</button>
          </div>
        ) : (
          <Field label="Paciente" required>
            <Input placeholder="Buscar por nome ou telefone" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="mt-1 space-y-1">
              {results.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setPatient(p); setQuery(""); }}
                  className="w-full rounded-lg bg-slate-50 px-2 py-1.5 text-left text-xs hover:bg-slate-100"
                >
                  {p.name} · {p.code} · {p.phone}
                </button>
              ))}
            </div>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="A partir de" required><Input type="date" value={form.desired_from} onChange={(e) => setForm({ ...form, desired_from: e.target.value })} /></Field>
          <Field label="Até (opcional)"><Input type="date" value={form.desired_to} onChange={(e) => setForm({ ...form, desired_to: e.target.value })} /></Field>
          <Field label="Período">
            <Select value={form.preferred_period} onChange={(e) => setForm({ ...form, preferred_period: e.target.value })}>
              <option value="any">Qualquer horário</option>
              <option value="morning">Manhã</option>
              <option value="afternoon">Tarde</option>
              <option value="evening">Noite</option>
            </Select>
          </Field>
          <Field label="Dentista (opcional)">
            <Select value={form.professional_id} onChange={(e) => setForm({ ...form, professional_id: e.target.value })}>
              <option value="">Qualquer</option>
              {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Procedimento (opcional)">
            <Select value={form.procedure_id} onChange={(e) => setForm({ ...form, procedure_id: e.target.value })}>
              <option value="">Qualquer</option>
              {procedures.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Observações"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

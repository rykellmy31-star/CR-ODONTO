import { Icon } from "../../components/Icons";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, clinicBase, errorMessage } from "../../lib/api";
import { Button, Card, Field, Input, Modal, Select, Spinner, Tabs, Textarea, useToast, Badge } from "../../components/ui";
import Odontogram, { CONDITION_META, FACES, type OdontogramEntryLike } from "../../components/Odontogram";
import { ageFrom, formatDateBr, formatMoney, formatPhone, STATUS_LABEL, STATUS_STYLE, timeInTz } from "../../lib/format";
import type { ClinicalRecord } from "../../lib/types";

interface ClinicalData {
  overview: {
    patient: Record<string, string | number | null>;
    upcoming: { id: number; code: string; starts_at: string; status: string; professional_name: string; procedure_name: string | null; kind: string }[];
    history: { id: number; code: string; starts_at: string; status: string; professional_name: string; procedure_name: string | null }[];
    counts: { completed: number; no_shows: number; cancelled: number };
    plans: { id: number; title: string; status: string; total_cents: number; created_at: string }[];
  };
  anamnesis: Record<string, unknown> | null;
  records: ClinicalRecord[];
  odontogram: OdontogramEntryLike[];
  plans: { id: number; title: string; status: string; total_cents: number; items: number; done: number }[];
  documents: { id: number; kind: string; title: string; body: string; issued_at: string; issued_by_name: string; visibility?: string; size_bytes: number; r2_key: string }[];
  settings: { require_record_on_finish: boolean; odontogram_default_dentition: "permanente" | "decidua" };
}

type Tab = "resumo" | "prontuario" | "odontograma" | "planos" | "documentos";

export default function PatientDetailPage() {
  const { slug = "", patientId = "" } = useParams();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("resumo");
  const [data, setData] = useState<ClinicalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dentition, setDentition] = useState<"permanente" | "decidua">("permanente");
  const [toothModal, setToothModal] = useState<{ tooth: string; face: string } | null>(null);
  const [recordModal, setRecordModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ClinicalData>(`${clinicBase()}/pro/patients/${patientId}/clinical`);
      setData(res);
      setDentition(res.settings.odontogram_default_dentition);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Spinner />;
  if (error) {
    return (
      <Card title="Acesso ao prontuário">
        <p className="text-sm text-slate-600">{error}</p>
        <Link to={`/c/${slug}/admin/pacientes`} className="btn-secondary mt-3">Voltar para pacientes</Link>
      </Card>
    );
  }
  if (!data) return null;

  const p = data.overview.patient as Record<string, string | number | null>;
  const anamnesis = data.anamnesis as Record<string, unknown> | null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link to={`/c/${slug}/admin/pacientes`} className="text-xs font-semibold text-brand-700 hover:underline"><Icon name="chevron-left" className="inline h-3 w-3" /> Pacientes</Link>
          <h2 className="text-lg font-bold text-slate-900">{String(p.name)}</h2>
          <p className="text-xs text-slate-500">
            {String(p.code)} · {formatPhone(String(p.phone ?? ""))}
            {p.birth_date ? ` · ${formatDateBr(String(p.birth_date))} (${ageFrom(String(p.birth_date))})` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/c/${slug}/admin/agenda`} className="btn-primary px-3 py-2 text-xs">Atender novamente</Link>
          <Button variant="secondary" className="text-xs" onClick={() => setRecordModal(true)}>+ Registro clínico</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label="Atendimentos" value={data.overview.counts.completed ?? 0} />
        <MiniStat label="Faltas" value={data.overview.counts.no_shows ?? 0} />
        <MiniStat label="Cancelamentos" value={data.overview.counts.cancelled ?? 0} />
        <MiniStat label="Planos ativos" value={data.plans.filter((pl) => pl.status === "ativo").length} />
      </div>

      <Tabs
        tabs={[
          { id: "resumo", label: "Resumo" },
          { id: "prontuario", label: "Prontuário" },
          { id: "odontograma", label: "Odontograma" },
          { id: "planos", label: "Tratamentos" },
          { id: "documentos", label: "Documentos" },
        ]}
        value={tab}
        onChange={(t) => setTab(t as Tab)}
      />

      {tab === "resumo" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Próximas consultas">
            {data.overview.upcoming.length === 0 && <p className="text-sm text-slate-500">Nenhuma consulta futura.</p>}
            <div className="space-y-1.5">
              {data.overview.upcoming.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="truncate">
                    {formatDateBr(a.starts_at.slice(0, 10))} · {a.professional_name} · {a.procedure_name ?? "Consulta"}
                  </span>
                  <span className={`chip ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Histórico de atendimentos">
            {data.overview.history.length === 0 && <p className="text-sm text-slate-500">Sem histórico.</p>}
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {data.overview.history.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0">
                  <span className="truncate text-slate-700">
                    {formatDateBr(a.starts_at.slice(0, 10))} · {a.procedure_name ?? "Consulta"}
                  </span>
                  <span className={`chip ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Dados cadastrais" className="lg:col-span-2">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Info label="CPF" value={p.cpf ? String(p.cpf) : "—"} />
              <Info label="E-mail" value={String(p.email || "—")} />
              <Info label="Endereço" value={[p.address, p.city, p.state].filter(Boolean).join(", ") || "—"} />
              <Info label="Responsável" value={String(p.guardian_name || "—")} />
              <Info label="WhatsApp autorizado" value={Number(p.whatsapp_optin) ? "Sim" : "Não"} />
              <Info label="Observações administrativas" value={String(p.notes || "—")} />
            </dl>
          </Card>
        </div>
      )}

      {tab === "prontuario" && (
        <div className="space-y-4">
          <Card title="Anamnese" subtitle={anamnesis ? `Atualizada em ${formatDateBr(String(anamnesis.updated_at ?? "").slice(0, 10))}` : "Não preenchida"}>
            {anamnesis ? (
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <Info label="Alergias" value={String(anamnesis.allergies || "—")} />
                <Info label="Medicamentos" value={String(anamnesis.medications || "—")} />
                <Info label="Condições sistêmicas" value={(anamnesis.systemic_conditions as string[] | undefined)?.join(", ") || "—"} />
                <Info label="Cirurgias" value={String(anamnesis.surgeries || "—")} />
                <Info label="Fumante" value={String(anamnesis.smoker)} />
                <Info label="Gestante" value={String(anamnesis.pregnant)} />
                <Info label="Diabetes" value={Number(anamnesis.diabetes) ? "Sim" : "Não"} />
                <Info label="Hipertensão" value={Number(anamnesis.hypertension) ? "Sim" : "Não"} />
                <Info label="Cardiopatia" value={Number(anamnesis.heart_condition) ? "Sim" : "Não"} />
                <Info label="Distúrbio de coagulação" value={Number(anamnesis.bleeding_disorder) ? "Sim" : "Não"} />
                <Info label="Observações" value={String(anamnesis.notes || "—")} />
                <Info label="Responsável pelo preenchimento" value={String(anamnesis.updated_by_name || "—")} />
              </dl>
            ) : (
              <p className="text-sm text-slate-500">Preencha a anamnese no primeiro atendimento.</p>
            )}
            <AnamnesisForm patientId={patientId} onSaved={load} hasData={Boolean(anamnesis)} />
          </Card>

          <Card title="Evolução clínica" subtitle="Registros imutáveis: correções geram novo registro">
            {data.records.length === 0 && <p className="text-sm text-slate-500">Nenhum registro clínico.</p>}
            <div className="space-y-2">
              {data.records.map((r) => (
                <article key={r.id} className={`rounded-xl border p-3 ${r.voided_at ? "border-rose-200 bg-rose-50/40" : "border-slate-200"}`}>
                  <header className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {r.kind} <span className="font-normal text-slate-500">· {new Date(r.created_at).toLocaleString("pt-BR")}</span>
                    </p>
                    <span className="text-xs text-slate-500">{r.professional_name}{r.professional_cro ? ` · CRO ${r.professional_cro}` : ""}</span>
                  </header>
                  <div className="mt-1 space-y-0.5 text-sm text-slate-700">
                    {r.chief_complaint && <p><strong>Queixa:</strong> {r.chief_complaint}</p>}
                    {r.diagnosis && <p><strong>Diagnóstico:</strong> {r.diagnosis}</p>}
                    {r.evolution && <p className="whitespace-pre-wrap"><strong>Evolução:</strong> {r.evolution}</p>}
                    {r.procedure_done && <p><strong>Procedimento:</strong> {r.procedure_done}</p>}
                    {r.tooth_codes && <p><strong>Dentes:</strong> {r.tooth_codes}</p>}
                    {r.notes && <p className="text-slate-600">{r.notes}</p>}
                  </div>
                  {r.voided_at && <p className="mt-1 text-xs font-semibold text-rose-600">Registro anulado</p>}
                </article>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "odontograma" && (
        <Card
          title="Odontograma"
          subtitle="Toque no dente e escolha a condição. Cada marcação guarda autor, data e histórico."
          actions={
            <Select value={dentition} onChange={(e) => setDentition(e.target.value as never)} className="max-w-[170px]">
              <option value="permanente">Dentição permanente</option>
              <option value="decidua">Dentição decídua</option>
            </Select>
          }
        >
          <Odontogram entries={data.odontogram} dentition={dentition} onSelect={(tooth, face) => setToothModal({ tooth, face })} />
        </Card>
      )}

      {tab === "planos" && (
        <TreatmentsTab patientId={patientId} data={data} onRefresh={load} />
      )}

      {tab === "documentos" && (
        <DocumentsTab patientId={patientId} data={data} onRefresh={load} />
      )}

      {toothModal && (
        <ToothModal
          patientId={patientId}
          dentition={dentition}
          tooth={toothModal.tooth}
          initialFace={toothModal.face}
          onClose={() => setToothModal(null)}
          onSaved={() => { setToothModal(null); void load(); }}
        />
      )}

      {recordModal && (
        <RecordModal
          patientId={patientId}
          appointments={[...data.overview.upcoming, ...data.overview.history]}
          onClose={() => setRecordModal(false)}
          onSaved={() => { setRecordModal(false); void load(); }}
        />
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-700">{value}</dd>
    </div>
  );
}

function AnamnesisForm({ patientId, onSaved, hasData }: { patientId: string; onSaved: () => void; hasData: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    allergies: "", medications: "", surgeries: "", notes: "",
    smoker: "nao", pregnant: "na_se_aplica", diabetes: false, hypertension: false,
    heart_condition: false, bleeding_disorder: false, conditions: "",
  });

  async function save() {
    setBusy(true);
    try {
      await api.post(`${clinicBase()}/pro/patients/${patientId}/anamnesis`, {
        ...form,
        systemic_conditions: form.conditions ? form.conditions.split(",").map((s) => s.trim()).filter(Boolean) : [],
      });
      toast.push("Anamnese salva.", "success");
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
        {hasData ? "Atualizar anamnese" : "Preencher anamnese"}
      </Button>
      {open && (
        <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Alergias"><Input value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} /></Field>
            <Field label="Medicamentos em uso"><Input value={form.medications} onChange={(e) => setForm({ ...form, medications: e.target.value })} /></Field>
            <Field label="Condições sistêmicas" hint="Separe por vírgulas"><Input value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })} /></Field>
            <Field label="Cirurgias"><Input value={form.surgeries} onChange={(e) => setForm({ ...form, surgeries: e.target.value })} /></Field>
            <Field label="Fumante">
              <Select value={form.smoker} onChange={(e) => setForm({ ...form, smoker: e.target.value })}>
                <option value="nao">Não</option><option value="sim">Sim</option><option value="ex">Ex-fumante</option>
              </Select>
            </Field>
            <Field label="Gestante">
              <Select value={form.pregnant} onChange={(e) => setForm({ ...form, pregnant: e.target.value })}>
                <option value="na_se_aplica">Não se aplica</option><option value="nao">Não</option><option value="sim">Sim</option>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-700">
            {[
              ["diabetes", "Diabetes"], ["hypertension", "Hipertensão"],
              ["heart_condition", "Cardiopatia"], ["bleeding_disorder", "Coagulopatia"],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={Boolean((form as unknown as Record<string, boolean>)[k])}
                  onChange={(e) => setForm({ ...form, [k]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
          <Field label="Observações"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <Button size="sm" loading={busy} onClick={save}>Salvar anamnese</Button>
        </div>
      )}
    </div>
  );
}

function ToothModal({
  patientId, dentition, tooth, initialFace, onClose, onSaved,
}: {
  patientId: string; dentition: "permanente" | "decidua"; tooth: string; initialFace: string;
  onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [face, setFace] = useState(initialFace);
  const [condition, setCondition] = useState("carie");
  const [status, setStatus] = useState("existente");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.post(`${clinicBase()}/pro/patients/${patientId}/odontogram`, {
        dentition, tooth_code: tooth, face, condition, status, notes,
      });
      toast.push("Odontograma atualizado.", "success");
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
      title={`Dente ${tooth}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={save}>Registrar</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Face">
          <div className="flex flex-wrap gap-1.5">
            {FACES.map((f) => (
              <button
                key={f}
                onClick={() => setFace(f)}
                className={`chip ${face === f ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Condição">
          <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
            {Object.entries(CONDITION_META).map(([k, meta]) => <option key={k} value={k}>{meta.label}</option>)}
          </Select>
        </Field>
        <Field label="Situação">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="existente">Existente</option>
            <option value="planejado">Planejado</option>
            <option value="concluido">Executado</option>
          </Select>
        </Field>
        <Field label="Observações"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="text-[11px] text-slate-500">A marcação anterior desta face é preservada no histórico (nada é apagado).</p>
      </div>
    </Modal>
  );
}

function RecordModal({
  patientId, appointments, onClose, onSaved,
}: {
  patientId: string;
  appointments: { id: number; code: string; starts_at: string; professional_name: string; procedure_name: string | null }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    kind: "evolucao", chief_complaint: "", diagnosis: "", evolution: "", procedure_done: "", tooth_codes: "", notes: "",
  });
  const [appointmentId, setAppointmentId] = useState("");

  async function save() {
    setBusy(true);
    try {
      await api.post(`${clinicBase()}/pro/patients/${patientId}/records`, {
        ...form,
        appointment_id: appointmentId ? Number(appointmentId) : null,
        tooth_codes: form.tooth_codes ? form.tooth_codes.split(",").map((s) => s.trim()).filter(Boolean) : [],
      });
      toast.push("Registro clínico criado.", "success");
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
      title="Novo registro clínico"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={save}>Salvar registro</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Tipo">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="avaliacao">Avaliação</option>
            <option value="evolucao">Evolução</option>
            <option value="diagnostico">Diagnóstico</option>
            <option value="procedimento">Procedimento</option>
            <option value="retorno">Retorno</option>
            <option value="observacao">Observação</option>
          </Select>
        </Field>
        <Field label="Atendimento vinculado" hint="necessário para administradores e recepção registrarem evolução">
          <Select value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}>
            <option value="">Sem vínculo (apenas dentista logado)</option>
            {appointments.map((a) => (
              <option key={a.id} value={a.id}>
                {formatDateBr(a.starts_at.slice(0, 10))} · {a.professional_name} · {a.procedure_name ?? "Consulta"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Queixa principal"><Input value={form.chief_complaint} onChange={(e) => setForm({ ...form, chief_complaint: e.target.value })} /></Field>
        <Field label="Diagnóstico"><Textarea value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></Field>
        <Field label="Evolução clínica" required><Textarea className="min-h-[120px]" value={form.evolution} onChange={(e) => setForm({ ...form, evolution: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Procedimento realizado"><Input value={form.procedure_done} onChange={(e) => setForm({ ...form, procedure_done: e.target.value })} /></Field>
          <Field label="Dentes" hint="ex.: 11, 12, 21"><Input value={form.tooth_codes} onChange={(e) => setForm({ ...form, tooth_codes: e.target.value })} /></Field>
        </div>
        <Field label="Observações"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function TreatmentsTab({ patientId, data, onRefresh }: { patientId: string; data: ClinicalData; onRefresh: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<{ id: number; plan_id: number; description: string; status: string; sessions_planned: number; sessions_done: number; price_cents: number; tooth_code: string; procedure_name: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [newItemFor, setNewItemFor] = useState<number | null>(null);
  const [itemForm, setItemForm] = useState({ description: "", tooth_code: "", sessions: 1, price: "" });

  const loadItems = useCallback(async () => {
    try {
      const res = await api.get<{ items: typeof items }>(`${clinicBase()}/pro/patients/${patientId}/plans`);
      setItems(res.items);
    } catch {
      setItems([]);
    }
  }, [patientId]);

  useEffect(() => { void loadItems(); }, [loadItems]);

  async function createPlan() {
    if (title.trim().length < 3) return toast.push("Informe o título do plano.", "error");
    setBusy(true);
    try {
      await api.post(`${clinicBase()}/pro/patients/${patientId}/plans`, { title });
      toast.push("Plano criado.", "success");
      setOpen(false);
      setTitle("");
      onRefresh();
      await loadItems();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function addItem(planId: number) {
    setBusy(true);
    try {
      await api.post(`${clinicBase()}/pro/plans/${planId}/items`, {
        description: itemForm.description,
        tooth_code: itemForm.tooth_code,
        sessions: Number(itemForm.sessions) || 1,
        price_cents: itemForm.price ? Math.round(Number(itemForm.price) * 100) : null,
      });
      toast.push("Etapa adicionada.", "success");
      setNewItemFor(null);
      setItemForm({ description: "", tooth_code: "", sessions: 1, price: "" });
      await loadItems();
      onRefresh();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(itemId: number, status: string) {
    try {
      await api.post(`${clinicBase()}/pro/plan-items/${itemId}/status`, { status });
      await loadItems();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="Planos de tratamento"
        actions={<Button size="sm" onClick={() => setOpen(true)}>+ Novo plano</Button>}
      >
        {data.plans.length === 0 && <p className="text-sm text-slate-500">Nenhum plano de tratamento.</p>}
        <div className="space-y-3">
          {data.plans.map((plan) => {
            const planItems = items.filter((i) => i.plan_id === plan.id);
            return (
              <div key={plan.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{plan.title}</p>
                    <p className="text-xs text-slate-500">
                      {plan.done}/{plan.items} etapas · {formatMoney(plan.total_cents)} ·{" "}
                      <span className="capitalize">{plan.status}</span>
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setNewItemFor(newItemFor === plan.id ? null : plan.id)}>+ Etapa</Button>
                </div>

                {newItemFor === plan.id && (
                  <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-4">
                    <Input placeholder="Procedimento/descrição" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} />
                    <Input placeholder="Dente" value={itemForm.tooth_code} onChange={(e) => setItemForm({ ...itemForm, tooth_code: e.target.value })} />
                    <Input type="number" min={1} placeholder="Sessões" value={itemForm.sessions} onChange={(e) => setItemForm({ ...itemForm, sessions: Number(e.target.value) })} />
                    <div className="flex gap-1">
                      <Input placeholder="R$" value={itemForm.price} onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })} />
                      <Button size="sm" loading={busy} onClick={() => addItem(plan.id)}>OK</Button>
                    </div>
                  </div>
                )}

                <ul className="mt-2 space-y-1">
                  {planItems.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-1 rounded-lg bg-slate-50 px-2 py-1.5 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium text-slate-800">{item.description || item.procedure_name}</span>
                        {item.tooth_code && <span className="ml-1 text-xs text-slate-500">dente {item.tooth_code}</span>}
                        <span className="ml-1 text-xs text-slate-500">· {item.sessions_done}/{item.sessions_planned} sessões</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Badge className={
                          item.status === "concluido" ? "bg-emerald-100 text-emerald-800"
                            : item.status === "em_andamento" ? "bg-sky-100 text-sky-800"
                            : item.status === "cancelado" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"
                        }>{item.status.replace("_", " ")}</Badge>
                        {item.status !== "concluido" && (
                          <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setStatus(item.id, "concluido")}>
                            concluir
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                  {planItems.length === 0 && <li className="text-xs text-slate-500">Sem etapas.</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Novo plano de tratamento"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={busy} onClick={createPlan}>Criar</Button>
          </div>
        }
      >
        <Field label="Título" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Reabilitação superior" />
        </Field>
      </Modal>
    </div>
  );
}

function DocumentsTab({ patientId, data, onRefresh }: { patientId: string; data: ClinicalData; onRefresh: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ kind: "atestado", title: "", body: "", sign: true, visible_to_patient: false });
  const [view, setView] = useState<{ title: string; body: string; issued_by_name: string } | null>(null);

  async function create() {
    setBusy(true);
    try {
      await api.post(`${clinicBase()}/pro/patients/${patientId}/documents`, form);
      toast.push("Documento criado.", "success");
      setOpen(false);
      setForm({ ...form, title: "", body: "" });
      onRefresh();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    try {
      await api.upload(`${clinicBase()}/uploads/document?patient_id=${patientId}&kind=exame&title=${encodeURIComponent(file.name)}`, file);
      toast.push("Arquivo enviado.", "success");
      onRefresh();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="Documentos clínicos"
        subtitle="Atestados, receitas, termos, exames e arquivos (armazenamento privado)"
        actions={<Button size="sm" onClick={() => setOpen(true)}>+ Documento</Button>}
      >
        <div className="mb-3">
          <label className="btn-secondary cursor-pointer text-xs">
            Enviar arquivo (PDF/imagem)
            <input type="file" className="hidden" accept="application/pdf,image/*" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }} />
          </label>
        </div>
        {data.documents.length === 0 && <p className="text-sm text-slate-500">Nenhum documento.</p>}
        <div className="space-y-1.5">
          {data.documents.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{d.title}</p>
                <p className="text-xs text-slate-500">
                  {d.kind} · {formatDateBr(d.issued_at.slice(0, 10))} · {d.issued_by_name}
                </p>
              </div>
              {d.body && (
                <Button size="sm" variant="secondary" onClick={() => setView({ title: d.title, body: d.body, issued_by_name: d.issued_by_name })}>
                  Ver
                </Button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          A assinatura interna registra um hash de integridade do conteúdo. Ela não substitui a assinatura digital
          ICP-Brasil quando exigida por lei.
        </p>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Novo documento"
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={busy} onClick={create}>Gerar documento</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Tipo">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {["atestado", "declaracao", "receita", "encaminhamento", "termo", "plano_tratamento", "exame"].map((k) => (
                <option key={k} value={k}>{k.replace("_", " ")}</option>
              ))}
            </Select>
          </Field>
          <Field label="Título" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Conteúdo" required><Textarea className="min-h-[160px]" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={form.sign} onChange={(e) => setForm({ ...form, sign: e.target.checked })} />
            Assinar internamente (hash de integridade + identificação profissional)
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={form.visible_to_patient} onChange={(e) => setForm({ ...form, visible_to_patient: e.target.checked })} />
            Disponibilizar no portal do paciente
          </label>
        </div>
      </Modal>

      {view && (
        <Modal open onClose={() => setView(null)} title={view.title}>
          <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{view.body}</pre>
          <p className="mt-3 text-xs text-slate-500">{view.issued_by_name}</p>
        </Modal>
      )}
    </div>
  );
}

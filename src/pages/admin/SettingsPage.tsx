import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../../lib/api";
import { Badge, Button, Card, Field, Input, Select, Spinner, Tabs, Textarea, useToast } from "../../components/ui";
import { formatDateBr } from "../../lib/format";

interface ClinicRow {
  id: number; slug: string; name: string; legal_name: string; cnpj: string; email: string;
  phone: string; whatsapp: string; logo_url: string; timezone: string; status: string;
  plan_code: string; trial_ends_at: string | null;
}

interface Settings {
  branding: {
    logo_url: string; primary_color: string; accent_color: string; tagline: string; about: string;
    instagram: string; website: string; address_public: string; phone_public: string; whatsapp_public: string;
  };
  booking: {
    online_enabled: boolean; min_lead_min: number; max_days_ahead: number; require_optin: boolean;
    allow_patient_cancel: boolean; cancel_limit_hours: number; allow_patient_reschedule: boolean;
    show_prices: boolean; show_professional_choice: boolean; require_cpf: boolean;
  };
  clinical: {
    require_anamnesis_before_first_visit: boolean; require_record_on_finish: boolean;
    odontogram_default_dentition: "permanente" | "decidua"; receptionist_can_view_records: boolean;
    patient_sharing: "clinic" | "unit";
  };
  reminders: { enabled_default: boolean; offsets_min: number[]; send_window_start: string; send_window_end: string; short_notice_min: number };
  scheduling: { slot_min: number; allow_fit_in: boolean; room_required_by_default: boolean; max_parallel_per_professional: number };
  modules: Record<string, boolean>;
  documents: { footer_text: string; show_cro: boolean; share_with_patient_default: boolean };
}

const MODULE_LABEL: Record<string, string> = {
  payments_simple: "Registrar forma de pagamento na finalização (opcional)",
  accounts_receivable: "Contas a receber",
  accounts_payable: "Contas a pagar",
  cash_register: "Caixa diário",
  commissions: "Comissões de profissionais",
  inventory: "Estoque de materiais",
  suppliers: "Fornecedores",
  advanced_financial_reports: "Relatórios financeiros avançados",
};

export default function SettingsPage() {
  const { slug = "" } = useParams();
  const toast = useToast();
  const [tab, setTab] = useState<"clinica" | "visual" | "agenda" | "clinico" | "modulos" | "auditoria">("clinica");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [clinic, setClinic] = useState<ClinicRow | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clinicForm, setClinicForm] = useState({ name: "", legal_name: "", cnpj: "", email: "", phone: "", whatsapp: "", timezone: "America/Sao_Paulo" });
  const [audit, setAudit] = useState<{ id: number; user_name: string; action: string; entity: string; entity_id: number | null; meta: string; created_at: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ clinic: ClinicRow; settings: Settings }>("/settings");
      setClinic(res.clinic);
      setSettings(res.settings);
      setClinicForm({
        name: res.clinic.name ?? "", legal_name: res.clinic.legal_name ?? "", cnpj: res.clinic.cnpj ?? "",
        email: res.clinic.email ?? "", phone: res.clinic.phone ?? "", whatsapp: res.clinic.whatsapp ?? "",
        timezone: res.clinic.timezone ?? "America/Sao_Paulo",
      });
      const a = await api.get<{ entries: typeof audit }>("/audit");
      setAudit(a.entries);
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function saveClinic() {
    setBusy(true);
    try {
      await api.put("/clinic", clinicForm);
      toast.push("Dados da clínica atualizados.", "success");
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function patchSettings(patch: (prev: Settings) => Settings) {
    if (!settings) return;
    const next = patch(settings);
    setSettings(next);
    setBusy(true);
    try {
      await api.put("/settings", next);
      toast.push("Configuração salva.", "success");
    } catch (e) {
      toast.push(errorMessage(e), "error");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    setBusy(true);
    try {
      const res = await api.upload<{ url: string }>("/logo", file);
      await patchSettings((prev) => ({ ...prev, branding: { ...prev.branding, logo_url: res.url } }));
      toast.push("Logotipo atualizado.", "success");
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (!clinic || !settings) return null;

  const publicUrl = `${location.origin}/c/${clinic.slug}`;

  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { id: "clinica", label: "Clínica" },
          { id: "visual", label: "Identidade visual" },
          { id: "agenda", label: "Agendamento" },
          { id: "clinico", label: "Prontuário" },
          { id: "modulos", label: "Módulos" },
          { id: "auditoria", label: "Auditoria" },
        ]}
        value={tab}
        onChange={(t) => setTab(t as never)}
      />

      {tab === "clinica" && (
        <div className="space-y-4">
          <Card title="Dados da clínica" actions={<Badge className="bg-brand-50 text-brand-800">{clinic.plan_code} · {clinic.status}</Badge>}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome fantasia" required><Input value={clinicForm.name} onChange={(e) => setClinicForm({ ...clinicForm, name: e.target.value })} /></Field>
              <Field label="Razão social"><Input value={clinicForm.legal_name} onChange={(e) => setClinicForm({ ...clinicForm, legal_name: e.target.value })} /></Field>
              <Field label="CNPJ"><Input value={clinicForm.cnpj} onChange={(e) => setClinicForm({ ...clinicForm, cnpj: e.target.value })} /></Field>
              <Field label="E-mail"><Input type="email" value={clinicForm.email} onChange={(e) => setClinicForm({ ...clinicForm, email: e.target.value })} /></Field>
              <Field label="Telefone"><Input value={clinicForm.phone} onChange={(e) => setClinicForm({ ...clinicForm, phone: e.target.value })} /></Field>
              <Field label="WhatsApp"><Input value={clinicForm.whatsapp} onChange={(e) => setClinicForm({ ...clinicForm, whatsapp: e.target.value })} /></Field>
              <Field label="Fuso horário">
                <Select value={clinicForm.timezone} onChange={(e) => setClinicForm({ ...clinicForm, timezone: e.target.value })}>
                  {["America/Sao_Paulo", "America/Bahia", "America/Manaus", "America/Cuiaba", "America/Fortaleza", "America/Rio_Branco", "America/Recife"].map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button loading={busy} onClick={saveClinic}>Salvar dados</Button>
              {clinic.trial_ends_at && <span className="text-xs text-slate-500">Teste até {formatDateBr(clinic.trial_ends_at.slice(0, 10))}</span>}
            </div>
          </Card>

          <Card title="Página pública da clínica" subtitle="Compartilhe este endereço com seus pacientes">
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 break-all rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{publicUrl}</code>
              <Button variant="secondary" onClick={() => navigator.clipboard.writeText(publicUrl).then(() => toast.push("Link copiado.", "success"))}>
                Copiar
              </Button>
              <Link to={`/c/${clinic.slug}`} className="btn-ghost px-3 py-1.5 text-xs" target="_blank">Abrir</Link>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Pacientes também podem confirmar ou reagendar pela página segura enviada por WhatsApp: /confirmar/… e /reagendar/….
              O portal do paciente com código de acesso está em /c/{clinic.slug}/portal.
            </p>
          </Card>
        </div>
      )}

      {tab === "visual" && (
        <Card title="Identidade visual" subtitle="Nada de identidade de barbearia: logo, cores e textos da sua clínica">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="label">Logotipo</p>
              <div className="flex items-center gap-3">
                {settings.branding.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={settings.branding.logo_url} alt="Logo" className="h-14 w-14 rounded-xl border border-slate-200 object-contain" />
                ) : (
                  <div className="grid h-14 w-14 place-items-center rounded-xl bg-slate-100 text-xs text-slate-400">sem logo</div>
                )}
                <label className="btn-secondary cursor-pointer px-3 py-1.5 text-xs">
                  Enviar imagem
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadLogo(f);
                  }} />
                </label>
              </div>
            </div>
            <Field label="Frase de destaque"><Input value={settings.branding.tagline} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, tagline: e.target.value } })} /></Field>
            <Field label="Cor principal">
              <div className="flex gap-2">
                <Input type="color" value={settings.branding.primary_color} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, primary_color: e.target.value } })} className="w-16" />
                <Input value={settings.branding.primary_color} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, primary_color: e.target.value } })} />
              </div>
            </Field>
            <Field label="Cor de destaque">
              <div className="flex gap-2">
                <Input type="color" value={settings.branding.accent_color} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, accent_color: e.target.value } })} className="w-16" />
                <Input value={settings.branding.accent_color} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, accent_color: e.target.value } })} />
              </div>
            </Field>
            <Field label="Endereço público"><Input value={settings.branding.address_public} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, address_public: e.target.value } })} /></Field>
            <Field label="Telefone público"><Input value={settings.branding.phone_public} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, phone_public: e.target.value } })} /></Field>
            <Field label="Instagram"><Input value={settings.branding.instagram} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, instagram: e.target.value } })} /></Field>
            <Field label="Site"><Input value={settings.branding.website} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, website: e.target.value } })} /></Field>
          </div>
          <Field label="Sobre a clínica"><Textarea value={settings.branding.about} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, about: e.target.value } })} /></Field>
          <div className="mt-3"><Button loading={busy} onClick={() => patchSettings((p) => p)}>Salvar identidade visual</Button></div>
        </Card>
      )}

      {tab === "agenda" && (
        <Card title="Regras de agendamento">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Intervalo padrão (min)">
              <Select value={settings.scheduling.slot_min} onChange={(e) => patchSettings((p) => ({ ...p, scheduling: { ...p.scheduling, slot_min: Number(e.target.value) } }))}>
                {[10, 15, 20, 30].map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Antecedência mínima (min)">
              <Input type="number" min={0} value={settings.booking.min_lead_min} onChange={(e) => setSettings({ ...settings, booking: { ...settings.booking, min_lead_min: Number(e.target.value) } })} />
            </Field>
            <Field label="Agendar até (dias à frente)">
              <Input type="number" min={1} value={settings.booking.max_days_ahead} onChange={(e) => setSettings({ ...settings, booking: { ...settings.booking, max_days_ahead: Number(e.target.value) } })} />
            </Field>
            <Field label="Cancelamento pelo paciente">
              <Select value={settings.booking.cancel_limit_hours} onChange={(e) => setSettings({ ...settings, booking: { ...settings.booking, cancel_limit_hours: Number(e.target.value) } })}>
                {[0, 2, 4, 6, 12, 24, 48].map((v) => <option key={v} value={v}>{v === 0 ? "sem limite" : `${v}h antes`}</option>)}
              </Select>
            </Field>
            <Field label="Compartilhamento do paciente">
              <Select value={settings.clinical.patient_sharing} onChange={(e) => setSettings({ ...settings, clinical: { ...settings.clinical, patient_sharing: e.target.value as never } })}>
                <option value="clinic">Toda a clínica</option>
                <option value="unit">Somente a unidade</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3 space-y-2">
            {([
              ["online_enabled", "Aceitar agendamento online"],
              ["allow_patient_cancel", "Permitir que o paciente cancele"],
              ["allow_patient_reschedule", "Permitir que o paciente reagende"],
              ["require_optin", "Exigir autorização de WhatsApp no agendamento"],
              ["require_cpf", "Exigir CPF no agendamento online"],
              ["show_prices", "Mostrar valores no site"],
              ["show_professional_choice", "Permitir escolher o dentista"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(settings.booking[key])}
                  onChange={(e) => setSettings({ ...settings, booking: { ...settings.booking, [key]: e.target.checked } })}
                />
                {label}
              </label>
            ))}
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={settings.scheduling.allow_fit_in} onChange={(e) => setSettings({ ...settings, scheduling: { ...settings.scheduling, allow_fit_in: e.target.checked } })} />
              Permitir encaixes (sempre com motivo registrado)
            </label>
          </div>
          <div className="mt-3"><Button loading={busy} onClick={() => patchSettings((p) => p)}>Salvar regras</Button></div>
        </Card>
      )}

      {tab === "clinico" && (
        <Card title="Prontuário e documentos" subtitle="Regras de integridade e privacidade">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={settings.clinical.require_record_on_finish} onChange={(e) => setSettings({ ...settings, clinical: { ...settings.clinical, require_record_on_finish: e.target.checked } })} />
              Exigir evolução clínica para finalizar o atendimento
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={settings.clinical.require_anamnesis_before_first_visit} onChange={(e) => setSettings({ ...settings, clinical: { ...settings.clinical, require_anamnesis_before_first_visit: e.target.checked } })} />
              Exigir anamnese antes do primeiro atendimento
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={settings.clinical.receptionist_can_view_records} onChange={(e) => setSettings({ ...settings, clinical: { ...settings.clinical, receptionist_can_view_records: e.target.checked } })} />
              Permitir que a recepção acesse prontuário (padrão: não)
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Dentição padrão do odontograma">
              <Select value={settings.clinical.odontogram_default_dentition} onChange={(e) => setSettings({ ...settings, clinical: { ...settings.clinical, odontogram_default_dentition: e.target.value as never } })}>
                <option value="permanente">Permanente</option>
                <option value="decidua">Decídua</option>
              </Select>
            </Field>
            <Field label="Rodapé dos documentos"><Input value={settings.documents.footer_text} onChange={(e) => setSettings({ ...settings, documents: { ...settings.documents, footer_text: e.target.value } })} /></Field>
          </div>
          <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={settings.documents.show_cro} onChange={(e) => setSettings({ ...settings, documents: { ...settings.documents, show_cro: e.target.checked } })} />
              Exibir CRO/UF do profissional nos documentos
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={settings.documents.share_with_patient_default} onChange={(e) => setSettings({ ...settings, documents: { ...settings.documents, share_with_patient_default: e.target.checked } })} />
              Disponibilizar documentos no portal por padrão
            </label>
          </div>
          <div className="mt-3"><Button loading={busy} onClick={() => patchSettings((p) => p)}>Salvar</Button></div>
        </Card>
      )}

      {tab === "modulos" && (
        <Card title="Módulos opcionais" subtitle="Todos desligados por padrão. Nada aqui bloqueia agenda ou atendimento.">
          <div className="space-y-2">
            {Object.entries(MODULE_LABEL).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(settings.modules[key])}
                  onChange={(e) => patchSettings((p) => ({ ...p, modules: { ...p.modules, [key]: e.target.checked } }))}
                />
              </label>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            A CR ODONTO não processa pagamentos, não cobra automaticamente e não integra gateways. O registro de forma de
            pagamento na finalização é apenas informativo e totalmente opcional.
          </p>
        </Card>
      )}

      {tab === "auditoria" && (
        <Card title="Registro de auditoria" subtitle="Últimas 200 ações desta clínica">
          <div className="max-h-[520px] space-y-1 overflow-y-auto">
            {audit.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-xs">
                <span className="min-w-0">
                  <strong className="text-slate-800">{a.action}</strong> · {a.entity}{a.entity_id ? ` #${a.entity_id}` : ""} · {a.user_name}
                </span>
                <span className="text-slate-400">{new Date(a.created_at).toLocaleString("pt-BR")}</span>
              </div>
            ))}
            {audit.length === 0 && <p className="text-sm text-slate-500">Nenhum registro.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Badge, Button, Card, Field, Input, Select, Spinner, Textarea, useToast } from "../../components/ui";

interface WaSettings {
  enabled: number; provider: string; waba_id: string; phone_number_id: string; display_phone: string;
  reminder_offsets_min: string; send_window_start: string; send_window_end: string;
  max_per_day: number; require_optin: number; last_error: string; last_checked_at: string | null;
  updated_at: string | null; has_token: number;
}
interface Template { id: number; code: string; name: string; body: string; provider_template_name: string; provider_status: string; active: number }
interface Job { id: number; kind: string; status: string; scheduled_at: string; sent_at: string | null; attempts: number; last_error: string; patient_name: string | null; appointment_code: string | null }

const TEMPLATE_LABEL: Record<string, string> = {
  lembrete: "Lembrete de consulta", confirmacao: "Confirmação", reagendamento: "Reagendamento",
  conclusao: "Conclusão de atendimento", retorno: "Retorno", boas_vindas: "Boas-vindas",
};

export default function WhatsAppPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<{ whatsapp_enabled: number; max_messages_month: number } | null>(null);
  const [platformConfigured, setPlatformConfigured] = useState(false);
  const [settings, setSettings] = useState<WaSettings | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [testNumber, setTestNumber] = useState("");
  const [form, setForm] = useState({
    enabled: false, phone_number_id: "", waba_id: "", display_phone: "", access_token: "",
    offsets: "1440,300", send_window_start: "08:00", send_window_end: "20:00", max_per_day: 400, require_optin: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, msg] = await Promise.all([
        api.get<{ settings: WaSettings | null; templates: Template[]; plan: { whatsapp_enabled: number; max_messages_month: number }; platform_configured: boolean }>("/whatsapp"),
        api.get<{ messages: Job[] }>("/messages"),
      ]);
      setPlan(res.plan);
      setPlatformConfigured(res.platform_configured);
      setTemplates(res.templates);
      setSettings(res.settings);
      setJobs(msg.messages);
      if (res.settings) {
        let offsets = "1440,300";
        try {
          const parsed = JSON.parse(res.settings.reminder_offsets_min || "[]");
          if (Array.isArray(parsed) && parsed.length) offsets = parsed.join(",");
        } catch { /* mantém padrão */ }
        setForm({
          enabled: Boolean(res.settings.enabled),
          phone_number_id: res.settings.phone_number_id ?? "",
          waba_id: res.settings.waba_id ?? "",
          display_phone: res.settings.display_phone ?? "",
          access_token: "",
          offsets,
          send_window_start: res.settings.send_window_start ?? "08:00",
          send_window_end: res.settings.send_window_end ?? "20:00",
          max_per_day: res.settings.max_per_day ?? 400,
          require_optin: Boolean(res.settings.require_optin),
        });
      }
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true);
    try {
      const offsets = form.offsets.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 5);
      await api.put("/whatsapp", {
        enabled: form.enabled,
        phone_number_id: form.phone_number_id,
        waba_id: form.waba_id,
        display_phone: form.display_phone,
        access_token: form.access_token || undefined,
        reminder_offsets_min: offsets.length ? offsets : [1440, 300],
        send_window_start: form.send_window_start,
        send_window_end: form.send_window_end,
        max_per_day: Number(form.max_per_day),
        require_optin: form.require_optin,
      });
      toast.push("Configuração de WhatsApp salva.", "success");
      setForm({ ...form, access_token: "" });
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (testNumber.replace(/\D/g, "").length < 10) return toast.push("Informe um WhatsApp válido.", "error");
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; outcome: string; error: string | null }>("/whatsapp/test", { to: testNumber });
      toast.push(res.ok ? `Mensagem enviada (${res.outcome}).` : `Falha: ${res.error ?? res.outcome}`, res.ok ? "success" : "error");
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    try {
      const res = await api.post<{ processed: number; sent: number; failed: number; skipped: number }>("/whatsapp/run-now");
      toast.push(`Fila processada: ${res.sent} enviada(s), ${res.failed} falha(s), ${res.skipped} ignorada(s).`, "success");
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  if (plan && !plan.whatsapp_enabled) {
    return (
      <Card title="WhatsApp não incluído no plano">
        <p className="text-sm text-slate-600">
          A integração com WhatsApp Cloud API não está disponível no plano atual desta clínica. Fale com o suporte
          para habilitar. Todo o restante do sistema continua funcionando normalmente, inclusive a agenda e os lembretes internos.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!platformConfigured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          A plataforma ainda não configurou o token de verificação do webhook. Os envios funcionam, mas a confirmação
          por botão exige essa configuração no ambiente da CR ODONTO.
        </div>
      )}
      {settings?.last_error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          Último erro registrado: {settings.last_error}
        </div>
      )}

      <Card title="Integração WhatsApp Cloud API" subtitle="Credenciais da própria clínica, guardadas criptografadas">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone Number ID"><Input value={form.phone_number_id} onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })} /></Field>
          <Field label="WABA ID"><Input value={form.waba_id} onChange={(e) => setForm({ ...form, waba_id: e.target.value })} /></Field>
          <Field label="Número exibido"><Input value={form.display_phone} onChange={(e) => setForm({ ...form, display_phone: e.target.value })} placeholder="(11) 99999-0000" /></Field>
          <Field label="Access Token" hint={settings?.has_token ? "token já salvo — deixe em branco para manter" : "obrigatório para enviar"}>
            <Input type="password" value={form.access_token} onChange={(e) => setForm({ ...form, access_token: e.target.value })} placeholder={settings?.has_token ? "••••••••" : ""} />
          </Field>
          <Field label="Lembretes (minutos antes)" hint="ex.: 1440,300 = 24h e 5h antes">
            <Input value={form.offsets} onChange={(e) => setForm({ ...form, offsets: e.target.value })} />
          </Field>
          <Field label="Máximo de mensagens por dia"><Input type="number" min={1} value={form.max_per_day} onChange={(e) => setForm({ ...form, max_per_day: Number(e.target.value) })} /></Field>
          <Field label="Janela de envio — início"><Input type="time" value={form.send_window_start} onChange={(e) => setForm({ ...form, send_window_start: e.target.value })} /></Field>
          <Field label="Janela de envio — fim"><Input type="time" value={form.send_window_end} onChange={(e) => setForm({ ...form, send_window_end: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Integração ativa
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input type="checkbox" checked={form.require_optin} onChange={(e) => setForm({ ...form, require_optin: e.target.checked })} />
            Só enviar para quem autorizou
          </label>
          <Button loading={busy} onClick={save} className="ml-auto">Salvar</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
          <Field label="Testar envio para"><Input inputMode="tel" value={testNumber} onChange={(e) => setTestNumber(e.target.value)} placeholder="DDD + número" /></Field>
          <Button variant="secondary" loading={busy} onClick={test}>Enviar teste</Button>
          <Button variant="ghost" loading={busy} onClick={runNow}>Processar fila agora</Button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Nenhuma informação clínica é enviada por WhatsApp — apenas dados de agendamento e links seguros de confirmação.
        </p>
      </Card>

      <Card title="Modelos de mensagem" subtitle="Personalize o texto; links e variáveis são aplicados automaticamente">
        <div className="space-y-3">
          {templates.map((t) => <TemplateEditor key={t.code} template={t} onSaved={load} />)}
          {templates.length === 0 && <p className="text-sm text-slate-500">Nenhum modelo disponível.</p>}
        </div>
      </Card>

      <Card title="Fila de mensagens" subtitle="Últimos envios e agendamentos">
        <div className="space-y-1.5">
          {jobs.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs">
              <span className="min-w-0">
                <strong className="text-slate-800">{TEMPLATE_LABEL[j.kind] ?? j.kind}</strong>
                {" · "}{j.patient_name ?? "—"}{j.appointment_code ? ` · ${j.appointment_code}` : ""}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-slate-500">{j.status}</span>
                <Badge className={
                  j.status === "enviado" ? "bg-emerald-100 text-emerald-800"
                    : j.status === "falhou" ? "bg-rose-100 text-rose-700"
                    : j.status === "cancelado" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-800"
                }>{j.attempts}x</Badge>
                {j.last_error && <span className="max-w-[220px] truncate text-rose-600" title={j.last_error}>{j.last_error}</span>}
              </span>
            </div>
          ))}
          {jobs.length === 0 && <p className="text-sm text-slate-500">Nenhuma mensagem na fila.</p>}
        </div>
      </Card>
    </div>
  );
}

function TemplateEditor({ template, onSaved }: { template: Template; onSaved: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState(template.body);
  const [busy, setBusy] = useState(false);
  const [providerName, setProviderName] = useState(template.provider_template_name);

  async function save() {
    setBusy(true);
    try {
      await api.put(`/whatsapp/templates/${template.code}`, {
        body,
        provider_template_name: providerName,
        provider_status: template.provider_status,
        active: Boolean(template.active),
      });
      toast.push("Modelo salvo.", "success");
      onSaved();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">{TEMPLATE_LABEL[template.code] ?? template.code}</p>
        <Badge className={template.provider_status === "aprovado" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}>
          {template.provider_status}
        </Badge>
      </div>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[90px] text-xs" />
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input placeholder="Nome do modelo na Meta (se usar template aprovado)" value={providerName} onChange={(e) => setProviderName(e.target.value)} className="text-xs" />
        <Button size="sm" loading={busy} onClick={save}>Salvar modelo</Button>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">Variáveis disponíveis: paciente, clinica, data, hora, profissional, unidade, procedimento e link — sempre entre chaves duplas. Os botões interativos (Confirmar / Reagendar) são enviados automaticamente.</p>
    </div>
  );
}

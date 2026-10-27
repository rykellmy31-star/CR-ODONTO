import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../../lib/api";
import { Button, Card, Field, Input, Spinner, useToast } from "../../components/ui";
import { formatDateBr, STATUS_LABEL, STATUS_STYLE } from "../../lib/format";
import { Icon } from "../../components/Icons";

interface PortalMe {
  authenticated: boolean;
  patient?: { id: number; name: string };
  clinic?: { name: string; slug: string; phone: string; whatsapp: string };
  booking?: { allow_cancel: boolean; allow_reschedule: boolean; cancel_limit_hours: number };
  appointments?: {
    id: number; code: string; day: string; time: string; status: string; kind: string;
    professional_name: string; procedure_name: string | null; unit_name: string | null;
  }[];
  documents?: { id: number; kind: string; title: string; issued_at: string; issued_by_name: string }[];
}

export default function PortalPage() {
  const { slug = "" } = useParams();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [credentials, setCredentials] = useState({ phone: "", birth_date: "" });
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"login" | "code">("login");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openDoc, setOpenDoc] = useState<{ title: string; body: string; issued_by_name: string } | null>(null);
  const toast = useToast();

  const load = async () => {
    try {
      const res = await api.get<PortalMe>("/portal/me");
      setMe(res);
    } catch {
      setMe({ authenticated: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [slug]);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post<{ dev_code?: string }>("/portal/request-code", credentials);
      setPhase("code");
      if (res.dev_code) setDevCode(res.dev_code);
      toast.push("Se os dados conferirem, o código foi enviado por WhatsApp.", "success");
    } catch (err) {
      toast.push(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/portal/verify", { ...credentials, code });
      await load();
    } catch (err) {
      toast.push(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function cancelAppointment(id: number) {
    if (!confirm("Cancelar esta consulta?")) return;
    try {
      await api.post(`/portal/appointments/${id}/cancel`);
      toast.push("Consulta cancelada.", "success");
      await load();
    } catch (err) {
      toast.push(errorMessage(err), "error");
    }
  }

  async function showDocument(id: number) {
    try {
      const res = await api.get<{ document: { title: string; body: string; issued_by_name: string } }>(`/portal/documents/${id}`);
      setOpenDoc(res.document);
    } catch (err) {
      toast.push(errorMessage(err), "error");
    }
  }

  async function logout() {
    await api.post("/portal/logout").catch(() => null);
    setMe({ authenticated: false });
    setPhase("login");
    setCode("");
  }

  if (loading) return <Spinner label="Carregando portal..." />;

  if (!me?.authenticated) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-700 text-white"><Icon name="tooth" className="h-5 w-5" strokeWidth={2} /></span>
          <div>
            <p className="text-sm font-bold text-slate-900">Portal do paciente</p>
            <p className="text-xs text-slate-500">Acesse suas consultas com segurança</p>
          </div>
        </div>
        <Card>
          {phase === "login" ? (
            <form onSubmit={requestCode} className="space-y-3">
              <Field label="WhatsApp cadastrado" required>
                <Input required inputMode="tel" value={credentials.phone} onChange={(e) => setCredentials({ ...credentials, phone: e.target.value })} placeholder="(11) 91234-5678" />
              </Field>
              <Field label="Data de nascimento" required>
                <Input required type="date" value={credentials.birth_date} onChange={(e) => setCredentials({ ...credentials, birth_date: e.target.value })} />
              </Field>
              <Button type="submit" loading={busy} className="w-full">Receber código por WhatsApp</Button>
              <p className="text-center text-[11px] text-slate-500">
                Usamos telefone + nascimento apenas para localizar seu cadastro. O código é enviado ao seu WhatsApp.
              </p>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-3">
              <Field label="Código de 6 dígitos" required>
                <Input required inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="text-center text-lg tracking-[0.4em]" />
              </Field>
              {devCode && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Ambiente de desenvolvimento — código: <strong>{devCode}</strong>
                </p>
              )}
              <Button type="submit" loading={busy} className="w-full">Entrar</Button>
              <button type="button" className="btn-ghost w-full text-xs" onClick={() => setPhase("login")}>Voltar</button>
            </form>
          )}
        </Card>
        <p className="mt-4 text-center text-xs text-slate-500">
          <Link to={`/c/${slug}`} className="font-semibold text-brand-700 hover:underline">Agendar nova consulta</Link>
        </p>
      </div>
    );
  }

  const upcoming = (me.appointments ?? []).filter((a) => !["concluido", "cancelado", "reagendado", "nao_compareceu"].includes(a.status));
  const history = (me.appointments ?? []).filter((a) => ["concluido", "cancelado", "reagendado", "nao_compareceu"].includes(a.status));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">{me.clinic?.name}</p>
          <h1 className="text-xl font-bold text-slate-900">Olá, {me.patient?.name?.split(" ")[0]}</h1>
        </div>
        <button onClick={logout} className="btn-ghost px-3 py-2 text-xs">Sair</button>
      </header>

      <div className="space-y-4">
        <Card title="Próximas consultas">
          {upcoming.length === 0 && <p className="text-sm text-slate-500">Nenhuma consulta agendada.</p>}
          <div className="space-y-2">
            {upcoming.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {formatDateBr(a.day)} às {a.time} · {a.procedure_name || "Consulta"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {a.professional_name} {a.unit_name ? `· ${a.unit_name}` : ""} · Protocolo {a.code}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`chip ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status] ?? a.status}</span>
                  {me.booking?.allow_cancel && (
                    <button onClick={() => cancelAppointment(a.id)} className="text-xs font-semibold text-rose-600 hover:underline">
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Link to={`/c/${slug}`} className="btn-primary w-full">Agendar nova consulta</Link>
          </div>
        </Card>

        {(me.documents?.length ?? 0) > 0 && (
          <Card title="Documentos disponíveis">
            <div className="space-y-2">
              {me.documents!.map((d) => (
                <button key={d.id} onClick={() => showDocument(d.id)} className="w-full rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50">
                  <p className="text-sm font-semibold text-slate-800">{d.title}</p>
                  <p className="text-xs text-slate-500">{d.kind} · {formatDateBr(d.issued_at.slice(0, 10))}</p>
                </button>
              ))}
            </div>
          </Card>
        )}

        <Card title="Histórico">
          {history.length === 0 && <p className="text-sm text-slate-500">Sem histórico ainda.</p>}
          <div className="space-y-1">
            {history.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0">
                <span className="text-slate-700">{formatDateBr(a.day)} · {a.procedure_name || "Consulta"}</span>
                <span className={`chip ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status] ?? a.status}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {openDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-bold text-slate-900">{openDoc.title}</h3>
              <button onClick={() => setOpenDoc(null)} className="text-slate-400" aria-label="Fechar"><Icon name="close" className="h-4 w-4" /></button>
            </div>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-slate-700">{openDoc.body}</pre>
            <p className="mt-3 text-xs text-slate-500">{openDoc.issued_by_name}</p>
          </div>
        </div>
      )}
    </div>
  );
}

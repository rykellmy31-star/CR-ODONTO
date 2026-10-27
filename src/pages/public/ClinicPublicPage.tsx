import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../../lib/api";
import { Button, Card, Field, Input, Select, Spinner, Textarea, useToast } from "../../components/ui";
import { addDaysIso, formatDateBr, formatMoney, todayIso, weekdayLabel } from "../../lib/format";
import { Icon } from "../../components/Icons";

interface Info {
  clinic: {
    slug: string; name: string; timezone: string; logo_url: string; tagline: string; about: string;
    address: string; phone: string; whatsapp: string; instagram: string;
    colors: { primary: string; accent: string };
  };
  booking: { online_enabled: boolean; max_days_ahead: number; show_prices: boolean; show_professional_choice: boolean; require_cpf: boolean; require_optin: boolean };
  units: { id: number; name: string; address: string; city: string; phone: string; whatsapp: string }[];
  professionals: { id: number; name: string; cro: string; cro_uf: string; photo_url: string; bio: string; color: string; specialties: string | null }[];
  procedures: { id: number; name: string; duration_min: number; price_cents: number; description: string; specialty_name: string | null; specialty_id: number | null }[];
  specialties: { id: number; name: string; color: string }[];
}

export default function ClinicPublicPage() {
  const { slug = "" } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [specialtyId, setSpecialtyId] = useState<number | null>(null);
  const [procedureId, setProcedureId] = useState<number | null>(null);
  const [professionalId, setProfessionalId] = useState<number | null>(null);
  const [days, setDays] = useState<{ day: string; label: string; free: number }[]>([]);
  const [day, setDay] = useState<string>("");
  const [slots, setSlots] = useState<string[] | null>(null);
  const [time, setTime] = useState<string>("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", cpf: "", birth_date: "", notes: "", optin: false, accept_terms: false });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code: string } | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.get<Info>("/info")
      .then((data) => {
        setInfo(data);
        document.documentElement.style.setProperty("--app-primary", data.clinic.colors.primary);
        document.documentElement.style.setProperty("--app-accent", data.clinic.colors.accent);
        if (data.professionals.length === 1) setProfessionalId(data.professionals[0].id);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [slug]);

  const filteredProcedures = useMemo(() => {
    if (!info) return [];
    return specialtyId ? info.procedures.filter((p) => p.specialty_id === specialtyId) : info.procedures;
  }, [info, specialtyId]);

  useEffect(() => {
    if (!info || !professionalId) return;
    setDays([]);
    setDay("");
    setSlots(null);
    setTime("");
    const qs = new URLSearchParams({ professional_id: String(professionalId) });
    if (procedureId) qs.set("procedure_id", String(procedureId));
    qs.set("days", String(Math.min(info.booking.max_days_ahead, 30)));
    api.get<{ days: { day: string; label: string; free: number }[] }>(`/availability/days?${qs}`)
      .then((r) => setDays(r.days))
      .catch(() => setDays([]));
  }, [info, professionalId, procedureId]);

  async function loadSlots(d: string) {
    setDay(d);
    setTime("");
    setSlots(null);
    if (!professionalId) return;
    setLoadingSlots(true);
    try {
      const qs = new URLSearchParams({ professional_id: String(professionalId), day: d });
      if (procedureId) qs.set("procedure_id", String(procedureId));
      const r = await api.get<{ slots: string[] }>(`/availability?${qs}`);
      setSlots(r.slots);
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setLoadingSlots(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!professionalId || !day || !time) return toast.push("Escolha profissional, dia e horário.", "error");
    if (!form.accept_terms) return toast.push("É necessário aceitar o aviso de privacidade.", "error");
    setBusy(true);
    try {
      const res = await api.post<{ code: string }>("/book", {
        professional_id: professionalId,
        procedure_id: procedureId,
        day, time,
        name: form.name.trim(),
        phone: form.phone,
        email: form.email,
        cpf: form.cpf,
        birth_date: form.birth_date || null,
        notes: form.notes,
        optin: form.optin,
        accept_terms: true,
      });
      setResult(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.push(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon name="tooth" className="h-5 w-5" /></span>
        <h1 className="mt-3 text-lg font-bold text-slate-900">Clínica não encontrada</h1>
        <p className="mt-1 text-sm text-slate-600">{error}</p>
        <Link to="/" className="btn-primary mt-5">Voltar ao início</Link>
      </div>
    );
  }
  if (!info) return <Spinner label="Carregando a clínica..." />;

  if (result) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="card p-6">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Icon name="check" className="h-7 w-7" strokeWidth={2.4} /></span>
          <h1 className="mt-3 text-xl font-bold text-slate-900">Consulta solicitada!</h1>
          <p className="mt-2 text-sm text-slate-600">
            Protocolo <strong className="font-mono">{result.code}</strong> — {formatDateBr(day)} às {time}.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Você receberá a confirmação pelo WhatsApp. Para acompanhar, acesse o portal do paciente.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link to={`/c/${slug}/portal`} className="btn-primary">Portal do paciente</Link>
            <button className="btn-secondary" onClick={() => { setResult(null); setTime(""); setSlots(null); }}>Agendar outra</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {info.clinic.logo_url ? (
              <img src={info.clinic.logo_url} alt={info.clinic.name} className="h-10 w-10 rounded-xl object-cover" />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-700 text-white"><Icon name="tooth" className="h-5 w-5" strokeWidth={2} /></span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">{info.clinic.name}</p>
              <p className="truncate text-xs text-slate-500">{info.clinic.tagline || "Odontologia"}</p>
            </div>
          </div>
          <Link to={`/c/${slug}/portal`} className="btn-secondary shrink-0 px-3 py-2 text-xs">Portal do paciente</Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {!info.booking.online_enabled ? (
          <Card title="Agendamento online indisponível">
            <p className="text-sm text-slate-600">
              Entre em contato pelo telefone {info.clinic.phone || info.clinic.whatsapp || "da clínica"} para agendar.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="space-y-4">
              <Card title="1. Escolha o procedimento">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => { setSpecialtyId(null); setProcedureId(null); }}
                    className={`chip ${specialtyId === null ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700"}`}
                  >
                    Todos
                  </button>
                  {info.specialties.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { setSpecialtyId(s.id); setProcedureId(null); }}
                      className={`chip ${specialtyId === s.id ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700"}`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {filteredProcedures.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setProcedureId(p.id)}
                      className={`rounded-xl border p-3 text-left transition ${
                        procedureId === p.id ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-300"
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-500">
                        {p.duration_min} min
                        {info.booking.show_prices && p.price_cents > 0 ? ` · ${formatMoney(p.price_cents)}` : ""}
                      </p>
                    </button>
                  ))}
                  {filteredProcedures.length === 0 && <p className="text-sm text-slate-500">Nenhum procedimento nesta especialidade.</p>}
                </div>
              </Card>

              <Card title="2. Escolha o dentista">
                <div className="grid gap-2 sm:grid-cols-2">
                  {info.professionals.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setProfessionalId(p.id);
                        if (!info.booking.show_professional_choice) return;
                      }}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                        professionalId === p.id ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-300"
                      }`}
                    >
                      {p.photo_url ? (
                        <img src={p.photo_url} alt={p.name} className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <span className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold text-white" style={{ background: p.color }}>
                          {p.name.slice(0, 1)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {p.cro ? `CRO ${p.cro}${p.cro_uf ? `/${p.cro_uf}` : ""}` : "Cirurgião-dentista"}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </Card>

              <Card title="3. Escolha o dia e o horário">
                {!professionalId && <p className="text-sm text-slate-500">Selecione um dentista para ver os horários.</p>}
                {professionalId && (
                  <>
                    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                      {days.map((d) => (
                        <button
                          key={d.day}
                          disabled={d.free === 0}
                          onClick={() => loadSlots(d.day)}
                          className={`min-w-[92px] rounded-xl border px-3 py-2 text-center transition ${
                            day === d.day ? "border-brand-600 bg-brand-700 text-white"
                              : d.free === 0 ? "border-slate-200 bg-slate-100 text-slate-400"
                              : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"
                          }`}
                        >
                          <span className="block text-[11px] uppercase">{weekdayLabel(d.day).split(",")[0]}</span>
                          <span className="block text-sm font-bold">{formatDateBr(d.day).slice(0, 5)}</span>
                          <span className="block text-[10px]">{d.free > 0 ? `${d.free} horários` : "sem vaga"}</span>
                        </button>
                      ))}
                      {days.length === 0 && <p className="text-sm text-slate-500">Nenhum dia disponível nos próximos dias.</p>}
                    </div>
                    {loadingSlots && <Spinner label="Buscando horários..." />}
                    {slots && slots.length > 0 && (
                      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {slots.map((s) => (
                          <button
                            key={s}
                            onClick={() => setTime(s)}
                            className={`rounded-xl border py-2 text-sm font-semibold transition ${
                              time === s ? "border-brand-600 bg-brand-700 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                    {slots && slots.length === 0 && (
                      <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Sem horários livres neste dia. Escolha outra data.
                      </p>
                    )}
                  </>
                )}
              </Card>
            </div>

            <Card title="4. Seus dados" subtitle={day && time ? `${formatDateBr(day)} às ${time}` : "Preencha para confirmar"}>
              <form onSubmit={submit} className="space-y-3">
                <Field label="Nome completo" required>
                  <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label="WhatsApp" required>
                  <Input required inputMode="tel" placeholder="(11) 91234-5678" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Nascimento">
                    <Input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
                  </Field>
                  <Field label="CPF" required={info.booking.require_cpf}>
                    <Input inputMode="numeric" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} />
                  </Field>
                </div>
                <Field label="E-mail">
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
                <Field label="Observação (opcional)">
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ex.: dor no dente do fundo" />
                </Field>
                <label className="flex items-start gap-2 text-xs text-slate-600">
                  <input type="checkbox" className="mt-0.5" checked={form.optin} onChange={(e) => setForm({ ...form, optin: e.target.checked })} />
                  Autorizo o contato por WhatsApp sobre esta consulta (lembretes e confirmação).
                </label>
                <label className="flex items-start gap-2 text-xs text-slate-600">
                  <input type="checkbox" className="mt-0.5" checked={form.accept_terms} onChange={(e) => setForm({ ...form, accept_terms: e.target.checked })} />
                  Li o aviso de privacidade e concordo com o tratamento dos meus dados para atendimento odontológico (LGPD).
                </label>
                <Button type="submit" loading={busy} className="w-full" disabled={!day || !time}>
                  Solicitar agendamento
                </Button>
                <p className="text-center text-[11px] text-slate-500">
                  A consulta é confirmada pela clínica. Em caso de imprevisto, avise com antecedência.
                </p>
              </form>
            </Card>
          </div>
        )}

        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          <Card title="Onde estamos">
            {info.units.map((u) => (
              <div key={u.id} className="mb-2 rounded-xl bg-slate-50 p-3 text-sm">
                <p className="font-semibold text-slate-800">{u.name}</p>
                <p className="text-xs text-slate-500">{[u.address, u.city].filter(Boolean).join(" · ") || "Endereço a confirmar"}</p>
                {u.phone && <p className="text-xs text-slate-500">Tel.: {u.phone}</p>}
              </div>
            ))}
            {info.units.length === 0 && <p className="text-sm text-slate-500">Endereço disponível por telefone.</p>}
          </Card>
          <Card title="Sobre a clínica">
            <p className="text-sm text-slate-600">{info.clinic.about || "Atendimento odontológico com foco em prevenção e conforto."}</p>
            <p className="mt-2 text-xs text-slate-500">
              {info.clinic.address && <>Endereço: {info.clinic.address}<br /></>}
              {info.clinic.phone && <>Telefone: {info.clinic.phone}<br /></>}
              {info.clinic.whatsapp && <>WhatsApp: {info.clinic.whatsapp}</>}
            </p>
          </Card>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        {info.clinic.name} · agendamento online por CR ODONTO · hoje {formatDateBr(todayIso(info.clinic.timezone))} (próximo dia: {formatDateBr(addDaysIso(todayIso(info.clinic.timezone), 1))})
      </footer>
    </div>
  );
}

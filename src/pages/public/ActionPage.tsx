import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../../lib/api";
import { Button, Card, Spinner, useToast } from "../../components/ui";
import { formatDateBr, weekdayLabel } from "../../lib/format";
import { Icon } from "../../components/Icons";

interface ActionInfo {
  purpose: "confirmar" | "reagendar" | "portal" | "documento";
  clinic: { name: string; timezone: string; phone: string; whatsapp: string };
  appointment: {
    code: string;
    patient_first_name: string;
    professional_name: string;
    procedure_name: string | null;
    unit_name: string | null;
    day: string;
    time: string;
    label: string;
    status: string;
    duration_min: number;
  };
}

export default function ActionPage({ purpose }: { purpose: "confirmar" | "reagendar" }) {
  const { slug = "", token = "" } = useParams();
  const [info, setInfo] = useState<ActionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "reschedule">("idle");
  const [days, setDays] = useState<{ day: string; label: string; free: number }[]>([]);
  const [selectedDay, setSelectedDay] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedTime, setSelectedTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ title: string; text: string } | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get<ActionInfo>(`/c/${slug}/action/${token}`)
      .then(setInfo)
      .catch((e) => setError(errorMessage(e)));
  }, [slug, token]);

  async function confirm() {
    setBusy(true);
    try {
      const res = await api.post<{ message: string }>(`/c/${slug}/action/${token}/confirm`);
      setDone({ title: "Consulta confirmada!", text: res.message });
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function openReschedule() {
    setStep("reschedule");
    if (days.length) return;
    try {
      const res = await api.get<{ days: { day: string; label: string; free: number }[] }>(`/c/${slug}/action/${token}/options`);
      setDays(res.days);
    } catch (e) {
      toast.push(errorMessage(e), "error");
    }
  }

  async function loadSlots(day: string) {
    setSelectedDay(day);
    setSelectedTime("");
    setLoadingSlots(true);
    try {
      const res = await api.get<{ slots: string[] }>(`/c/${slug}/action/${token}/slots?day=${day}`);
      setSlots(res.slots);
    } catch (e) {
      toast.push(errorMessage(e), "error");
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }

  async function submitReschedule() {
    if (!selectedDay || !selectedTime) return toast.push("Escolha o novo dia e horário.", "error");
    setBusy(true);
    try {
      const res = await api.post<{ message: string; appointment: { day: string; time: string } }>(`/c/${slug}/action/${token}/reschedule`, {
        day: selectedDay, time: selectedTime,
      });
      setDone({ title: "Consulta reagendada!", text: `${res.message} Novo horário: ${formatDateBr(res.appointment.day)} às ${res.appointment.time}.` });
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-3xl">⏳</p>
        <h1 className="mt-3 text-lg font-bold text-slate-900">Link indisponível</h1>
        <p className="mt-1 text-sm text-slate-600">{error}</p>
        <Link to="/" className="btn-secondary mt-5">Ir para o início</Link>
      </div>
    );
  }
  if (!info) return <Spinner label="Validando seu link..." />;

  if (done) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Card>
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Icon name="check" className="h-7 w-7" strokeWidth={2.4} /></span>
          <h1 className="mt-3 text-xl font-bold text-slate-900">{done.title}</h1>
          <p className="mt-2 text-sm text-slate-600">{done.text}</p>
          <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            {info.clinic.name}
            {info.clinic.phone && <> · Tel.: {info.clinic.phone}</>}
          </div>
        </Card>
      </div>
    );
  }

  const a = info.appointment;

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-700 text-white"><Icon name="tooth" className="h-5 w-5" strokeWidth={2} /></span>
        <div>
          <p className="text-sm font-bold text-slate-900">{info.clinic.name}</p>
          <p className="text-xs text-slate-500">Confirmação de consulta</p>
        </div>
      </div>

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Olá, {a.patient_first_name}!</p>
        <h1 className="mt-1 text-lg font-bold text-slate-900">
          {step === "idle" ? "Podemos confirmar sua consulta?" : "Escolha o novo horário"}
        </h1>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-800">{a.procedure_name || "Consulta odontológica"}</p>
          <p className="text-sm text-slate-600">{a.label}</p>
          <p className="mt-1 text-xs text-slate-500">
            {a.professional_name}
            {a.unit_name ? ` · ${a.unit_name}` : ""} · Protocolo {a.code}
          </p>
        </div>

        {step === "idle" ? (
          <div className="mt-5 space-y-2">
            <Button className="w-full" loading={busy} onClick={confirm} disabled={a.status === "confirmado"}>
              {a.status === "confirmado" ? "Consulta já confirmada" : "Confirmar consulta"}
            </Button>
            <Button variant="secondary" className="w-full" onClick={openReschedule}>
              Não poderei comparecer — reagendar
            </Button>
            {info.clinic.whatsapp && (
              <p className="pt-2 text-center text-[11px] text-slate-500">
                Precisa falar com a clínica? WhatsApp {info.clinic.whatsapp}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {days.filter((d) => d.free > 0).map((d) => (
                <button
                  key={d.day}
                  onClick={() => loadSlots(d.day)}
                  className={`min-w-[86px] rounded-xl border px-3 py-2 text-center ${
                    selectedDay === d.day ? "border-brand-600 bg-brand-700 text-white" : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <span className="block text-[10px] uppercase">{weekdayLabel(d.day).split(",")[0]}</span>
                  <span className="block text-sm font-bold">{formatDateBr(d.day).slice(0, 5)}</span>
                </button>
              ))}
              {days.every((d) => d.free === 0) && (
                <p className="text-xs text-slate-500">Sem horários livres nos próximos dias. Fale com a clínica.</p>
              )}
            </div>
            {loadingSlots && <Spinner label="Buscando horários..." />}
            {!loadingSlots && slots.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSelectedTime(s)}
                    className={`rounded-xl border py-2 text-sm font-semibold ${
                      selectedTime === s ? "border-brand-600 bg-brand-700 text-white" : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {!loadingSlots && selectedDay && slots.length === 0 && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Nenhum horário livre neste dia.</p>
            )}
            <Button className="w-full" loading={busy} onClick={submitReschedule} disabled={!selectedTime}>
              Confirmar novo horário
            </Button>
            <button className="btn-ghost w-full text-xs" onClick={() => setStep("idle")}>Voltar</button>
          </div>
        )}
      </Card>

      <p className="mt-4 text-center text-[11px] text-slate-400">
        Este link é pessoal, de uso único e expira automaticamente. {purpose === "reagendar" ? "Reagendamento seguro." : ""}
      </p>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../../lib/api";
import { Button, Card, Field, Input, Modal, Spinner, Textarea, useToast } from "../../components/ui";
import { formatDateBr, formatPhone } from "../../lib/format";
import type { PatientRow } from "../../lib/types";

export default function PatientsPage() {
  const { slug = "" } = useParams();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<{ id: number; name: string; phone: string; reason: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", birth_date: "", cpf: "", email: "", address: "", city: "", state: "", zip: "",
    guardian_name: "", guardian_phone: "", notes: "", whatsapp_optin: true,
  });

  async function search() {
    setLoading(true);
    try {
      const res = await api.get<{ patients: PatientRow[] }>(`/patients?q=${encodeURIComponent(q)}`);
      setPatients(res.patients);
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => { void search(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function create(force = false) {
    setBusy(true);
    try {
      const res = await api.post<{ id: number; code: string }>("/patients", { ...form, force_create: force });
      toast.push(`Paciente cadastrado: ${res.code}`, "success");
      setOpen(false);
      setDuplicates(null);
      setForm({ ...form, name: "", phone: "", cpf: "", birth_date: "", email: "", notes: "" });
      await search();
    } catch (e) {
      const err = e as { status?: number; details?: unknown };
      if (err.status === 409) {
        const body = e as unknown as { duplicates?: { id: number; name: string; phone: string; reason: string }[] };
        setDuplicates(body.duplicates ?? []);
      }
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Buscar por nome, telefone, CPF ou código" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md" />
        <Button onClick={() => setOpen(true)} className="ml-auto">+ Novo paciente</Button>
      </div>

      <Card title={`Pacientes${q ? ` · busca "${q}"` : ""}`} subtitle={`${patients.length} resultado(s)`}>
        {loading && <Spinner />}
        <div className="space-y-1.5">
          {patients.map((p) => (
            <Link
              key={p.id}
              to={`/c/${slug}/admin/pacientes/${p.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-brand-300 hover:bg-brand-50/30"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                <p className="text-xs text-slate-500">
                  {p.code} · {formatPhone(p.phone)}
                  {p.birth_date ? ` · nasc. ${formatDateBr(p.birth_date)}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-slate-500">
                  {p.last_visit ? `Último atendimento: ${formatDateBr(p.last_visit.slice(0, 10))}` : "Sem atendimentos"}
                </p>
              </div>
            </Link>
          ))}
          {!loading && patients.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              {q ? "Nenhum paciente encontrado." : "Nenhum paciente cadastrado ainda."}
            </p>
          )}
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Novo paciente" size="lg">
        <div className="space-y-3">
          <Field label="Nome completo" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="WhatsApp"><Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Nascimento"><Input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} /></Field>
            <Field label="CPF (opcional)"><Input inputMode="numeric" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} /></Field>
            <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Endereço"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label="Cidade"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            <Field label="UF"><Input maxLength={2} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Responsável legal (menores)"><Input value={form.guardian_name} onChange={(e) => setForm({ ...form, guardian_name: e.target.value })} /></Field>
            <Field label="Telefone do responsável"><Input value={form.guardian_phone} onChange={(e) => setForm({ ...form, guardian_phone: e.target.value })} /></Field>
          </div>
          <Field label="Observações administrativas"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={form.whatsapp_optin} onChange={(e) => setForm({ ...form, whatsapp_optin: e.target.checked })} />
            Paciente autoriza lembretes e confirmações por WhatsApp
          </label>

          {duplicates && duplicates.length > 0 && (
            <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">Cadastros parecidos encontrados (evite duplicidade):</p>
              <ul className="mt-1 space-y-0.5">
                {duplicates.map((d) => (
                  <li key={d.id}>• {d.name} — {formatPhone(d.phone)} (mesmo {d.reason})</li>
                ))}
              </ul>
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => create(true)}>Cadastrar mesmo assim</Button>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={busy} onClick={() => create(false)}>Cadastrar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

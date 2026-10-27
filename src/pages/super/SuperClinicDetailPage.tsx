import { Icon } from "../../components/Icons";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../../lib/api";
import { Button, Card, Field, Input, Modal, Select, Spinner, Stat, Textarea, useAsync, useToast } from "../../components/ui";
import { formatDateBr, formatDateTime } from "../../lib/format";

interface Detail {
  clinic: { id: number; name: string; slug: string; status: string; suspend_reason: string; plan_code: string; trial_ends_at: string | null; cnpj: string; phone: string; whatsapp: string; email: string };
  subscription: { plan_code: string; status: string; trial_ends_at: string | null; period_end: string | null; notes: string } | null;
  units: { id: number; name: string; city: string; active: number }[];
  members: { id: number; role: string; active: number; can_view_records: number; user_id: number; name: string; email: string; must_change_password: number; last_login_at: string | null }[];
  counts: { patients: number; dentists: number; appointments: number; today: number; message_failures: number };
}

export default function SuperClinicDetailPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const detail = useAsync<Detail>(() => api.get(`/super/clinics/${id}`), [id]);
  const plans = useAsync<{ plans: { code: string; name: string }[] }>(() => api.get("/super/plans"), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusModal, setStatusModal] = useState<null | "suspend" | "block" | "activate">(null);
  const [reason, setReason] = useState("");
  const [subModal, setSubModal] = useState(false);
  const [sub, setSub] = useState({ plan_code: "", status: "active", trial_days: 0, period_end: "", notes: "" });
  const [adminModal, setAdminModal] = useState(false);
  const [admin, setAdmin] = useState({ name: "", email: "", password: "", role: "clinic_admin", can_view_records: false });
  const [deleteModal, setDeleteModal] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  const d = detail.data;

  async function run(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(key);
    try {
      await fn();
      toast.push(okMsg, "success");
      detail.reload();
    } catch (e) {
      toast.push(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  if (detail.loading) return <Spinner />;
  if (detail.error) return <Card title="Erro">{detail.error}</Card>;
  if (!d) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="/superadmin/clinicas" className="text-xs font-semibold text-brand-700 hover:underline"><Icon name="chevron-left" className="inline h-3 w-3" /> Clínicas</Link>
          <h2 className="text-lg font-bold text-slate-900">{d.clinic.name}</h2>
          <p className="text-xs text-slate-500">
            /c/{d.clinic.slug} · CNPJ {d.clinic.cnpj || "—"} · {d.clinic.phone || d.clinic.whatsapp || "sem telefone"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/c/${d.clinic.slug}`} target="_blank" rel="noreferrer" className="btn-secondary px-3 py-2 text-xs">Ver site</a>
          {d.clinic.status === "active" ? (
            <>
              <Button variant="secondary" className="text-xs" onClick={() => setStatusModal("suspend")}>Suspender</Button>
              <Button variant="danger" className="text-xs" onClick={() => setStatusModal("block")}>Bloquear</Button>
            </>
          ) : (
            <Button className="text-xs" onClick={() => setStatusModal("activate")}>Reativar</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Dentistas" value={d.counts.dentists ?? 0} />
        <Stat label="Pacientes" value={d.counts.patients ?? 0} />
        <Stat label="Consultas hoje" value={d.counts.today ?? 0} />
        <Stat label="Consultas (total)" value={d.counts.appointments ?? 0} />
        <Stat label="Falhas WhatsApp" value={d.counts.message_failures ?? 0} tone={Number(d.counts.message_failures) > 0 ? "bad" : "good"} />
      </div>

      {d.clinic.status !== "active" && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Clínica {d.clinic.status === "suspended" ? "suspensa" : "bloqueada"}. Motivo: {d.clinic.suspend_reason || "não informado"}.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Assinatura e plano"
          subtitle="Controle manual (sem gateway de pagamento)"
          actions={
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => {
              setSub({
                plan_code: d.subscription?.plan_code ?? d.clinic.plan_code,
                status: d.subscription?.status ?? "active",
                trial_days: 0,
                period_end: d.subscription?.period_end?.slice(0, 10) ?? "",
                notes: d.subscription?.notes ?? "",
              });
              setSubModal(true);
            }}>Alterar</Button>
          }
        >
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Plano</dt><dd className="font-semibold capitalize">{d.subscription?.plan_code ?? d.clinic.plan_code}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Situação</dt><dd className="font-semibold capitalize">{d.subscription?.status ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Avaliação até</dt><dd>{d.clinic.trial_ends_at ? formatDateBr(d.clinic.trial_ends_at.slice(0, 10)) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Vigência</dt><dd>{d.subscription?.period_end ? formatDateBr(d.subscription.period_end.slice(0, 10)) : "—"}</dd></div>
          </dl>
        </Card>

        <Card title="Unidades" subtitle={`${d.units.length} unidade(s)`}>
          {d.units.map((u) => (
            <div key={u.id} className="mb-1 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span>{u.name}</span>
              <span className="text-xs text-slate-500">{u.city || "—"} {u.active ? "" : "(inativa)"}</span>
            </div>
          ))}
          {d.units.length === 0 && <p className="text-sm text-slate-500">Nenhuma unidade.</p>}
        </Card>
      </div>

      <Card
        title="Equipe e acessos"
        actions={<Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setAdminModal(true)}>+ Administrador</Button>}
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Prontuário</th><th>Último acesso</th><th>Situação</th><th></th></tr>
            </thead>
            <tbody>
              {d.members.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.name}</td>
                  <td className="text-xs">{m.email}</td>
                  <td className="text-xs capitalize">{m.role.replace("_", " ")}</td>
                  <td className="text-xs">{m.role === "clinic_admin" || m.role === "dentist" ? "Sim" : m.can_view_records ? "Liberado" : "Não"}</td>
                  <td className="text-xs">{m.last_login_at ? formatDateTime(m.last_login_at) : "nunca"}</td>
                  <td>
                    <span className={`chip ${m.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                      {m.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="text-right">
                    <button
                      className="text-xs font-semibold text-brand-700 hover:underline"
                      onClick={() => run(`m${m.id}`, () => api.post(`/super/memberships/${m.id}/active`, { active: !m.active }), "Acesso atualizado.")}
                    >
                      {busy === `m${m.id}` ? "..." : m.active ? "Desativar" : "Ativar"}
                    </button>
                    <button
                      className="ml-3 text-xs font-semibold text-slate-600 hover:underline"
                      onClick={() => run(`r${m.id}`, async () => {
                        const r = await api.post<{ code: string }>(`/super/users/${m.user_id}/reset-code`);
                        toast.push(`Código de recuperação de ${m.email}: ${r.code}`, "info");
                      }, "Código de recuperação gerado.")}
                    >
                      Código
                    </button>
                  </td>
                </tr>
              ))}
              {d.members.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-sm text-slate-500">Nenhum usuário vinculado.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Zona de risco" subtitle="Ações irreversíveis e auditadas">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-lg text-xs text-slate-500">
            A exclusão desativa a clínica e seus acessos. Os dados são preservados para obrigações legais, auditoria e
            responsabilidade profissional sobre prontuários.
          </p>
          <Button variant="danger" className="text-xs" onClick={() => setDeleteModal(true)}>Excluir clínica</Button>
        </div>
      </Card>

      {/* Modais */}
      <Modal
        open={statusModal !== null}
        onClose={() => setStatusModal(null)}
        title={statusModal === "activate" ? "Reativar clínica" : statusModal === "suspend" ? "Suspender clínica" : "Bloquear clínica"}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStatusModal(null)}>Cancelar</Button>
            <Button
              variant={statusModal === "activate" ? "primary" : "danger"}
              loading={busy === "status"}
              onClick={() =>
                run("status", async () => {
                  await api.post(`/super/clinics/${id}/status`, { action: statusModal, reason });
                  setStatusModal(null);
                  setReason("");
                }, "Situação atualizada.")
              }
            >
              Confirmar
            </Button>
          </div>
        }
      >
        {statusModal === "activate" ? (
          <p className="text-sm text-slate-600">A clínica volta a operar normalmente e os usuários poderão acessar o painel.</p>
        ) : (
          <Field label="Motivo (visível para a clínica)" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: inadimplência, encerramento de contrato" />
          </Field>
        )}
      </Modal>

      <Modal
        open={subModal}
        onClose={() => setSubModal(false)}
        title="Assinatura"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSubModal(false)}>Cancelar</Button>
            <Button loading={busy === "sub"} onClick={() => run("sub", async () => {
              await api.post(`/super/clinics/${id}/subscription`, {
                ...sub,
                trial_days: sub.trial_days || undefined,
                period_end: sub.period_end || null,
              });
              setSubModal(false);
            }, "Assinatura atualizada.")}>Salvar</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Plano">
            <Select value={sub.plan_code} onChange={(e) => setSub({ ...sub, plan_code: e.target.value })}>
              {(plans.data?.plans ?? []).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Situação">
            <Select value={sub.status} onChange={(e) => setSub({ ...sub, status: e.target.value })}>
              <option value="trial">Avaliação</option>
              <option value="active">Ativa</option>
              <option value="past_due">Em atraso</option>
              <option value="cancelled">Cancelada</option>
              <option value="blocked">Bloqueada</option>
            </Select>
          </Field>
          <Field label="Estender avaliação (dias)" hint="Preencha apenas para conceder novo prazo de teste">
            <Input type="number" min={0} max={365} value={sub.trial_days} onChange={(e) => setSub({ ...sub, trial_days: Number(e.target.value) })} />
          </Field>
          <Field label="Vigência até">
            <Input type="date" value={sub.period_end} onChange={(e) => setSub({ ...sub, period_end: e.target.value })} />
          </Field>
          <Field label="Observações internas">
            <Textarea value={sub.notes} onChange={(e) => setSub({ ...sub, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={adminModal}
        onClose={() => setAdminModal(false)}
        title="Novo administrador"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdminModal(false)}>Cancelar</Button>
            <Button loading={busy === "admin"} onClick={() => run("admin", async () => {
              await api.post(`/super/clinics/${id}/admins`, admin);
              setAdminModal(false);
              setAdmin({ name: "", email: "", password: "", role: "clinic_admin", can_view_records: false });
            }, "Administrador criado (senha provisória).")}>Criar</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Nome" required><Input value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} /></Field>
          <Field label="E-mail" required><Input type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} /></Field>
          <Field label="Senha provisória" required hint="Mínimo 10 caracteres; será trocada no primeiro acesso">
            <Input type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} />
          </Field>
          <Field label="Papel">
            <Select value={admin.role} onChange={(e) => setAdmin({ ...admin, role: e.target.value })}>
              <option value="clinic_admin">Administrador da clínica</option>
              <option value="receptionist">Recepcionista</option>
            </Select>
          </Field>
          {admin.role === "receptionist" && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={admin.can_view_records} onChange={(e) => setAdmin({ ...admin, can_view_records: e.target.checked })} />
              Permitir acesso ao prontuário clínico
            </label>
          )}
        </div>
      </Modal>

      <Modal
        open={deleteModal}
        onClose={() => setDeleteModal(false)}
        title="Excluir clínica"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteModal(false)}>Cancelar</Button>
            <Button variant="danger" loading={busy === "del"} onClick={() => run("del", async () => {
              await api.post(`/super/clinics/${id}/delete`, { confirm_slug: confirmSlug, reason: deleteReason });
              setDeleteModal(false);
            }, "Clínica excluída.")}>Excluir definitivamente</Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          Digite o endereço <strong className="font-mono">{d.clinic.slug}</strong> para confirmar e informe o motivo.
        </p>
        <Field label="Endereço da clínica" required>
          <Input value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} />
        </Field>
        <div className="mt-3">
          <Field label="Motivo" required><Textarea value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}

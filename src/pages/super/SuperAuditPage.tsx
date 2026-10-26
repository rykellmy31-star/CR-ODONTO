import { useState } from "react";
import { api } from "../../lib/api";
import { Card, Field, Input, Spinner, useAsync } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

interface Entry {
  id: number; scope: string; clinic_id: number | null; clinic_name: string | null;
  user_name: string; action: string; entity: string; entity_id: string; meta: string; created_at: string;
}

export default function SuperAuditPage() {
  const [clinicId, setClinicId] = useState("");
  const { data, loading } = useAsync<{ entries: Entry[] }>(
    () => api.get(`/super/audit?limit=200${clinicId ? `&clinic_id=${clinicId}` : ""}`),
    [clinicId]
  );

  return (
    <div className="space-y-4">
      <Card title="Logs administrativos" subtitle="Ações de plataforma e de clínica, com autor e horário">
        <div className="mb-3 max-w-xs">
          <Field label="Filtrar por clínica (id)">
            <Input inputMode="numeric" value={clinicId} onChange={(e) => setClinicId(e.target.value.replace(/\D/g, ""))} placeholder="ex.: 1" />
          </Field>
        </div>
        {loading && <Spinner />}
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Quando</th><th>Escopo</th><th>Clínica</th><th>Usuário</th><th>Ação</th><th>Entidade</th></tr></thead>
            <tbody>
              {(data?.entries ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs">{formatDateTime(e.created_at)}</td>
                  <td className="text-xs">{e.scope === "platform" ? "Plataforma" : "Clínica"}</td>
                  <td className="text-xs">{e.clinic_name ?? "—"}</td>
                  <td className="text-xs">{e.user_name}</td>
                  <td className="font-mono text-xs">{e.action}</td>
                  <td className="text-xs">{e.entity}{e.entity_id ? ` #${e.entity_id}` : ""}</td>
                </tr>
              ))}
              {(data?.entries ?? []).length === 0 && !loading && (
                <tr><td colSpan={6} className="py-6 text-center text-sm text-slate-500">Nenhum registro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

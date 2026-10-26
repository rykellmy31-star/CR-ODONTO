// Odontograma interativo e responsivo (permanente e decídua).
// Cada dente é dividido em faces clicáveis; o estado atual vem do backend.
import { useMemo, useState } from "react";
import clsx from "clsx";

export const PERMANENT_TEETH = [
  ["18", "17", "16", "15", "14", "13", "12", "11"],
  ["21", "22", "23", "24", "25", "26", "27", "28"],
  ["48", "47", "46", "45", "44", "43", "42", "41"],
  ["31", "32", "33", "34", "35", "36", "37", "38"],
];
export const DECIDUOUS_TEETH = [
  ["55", "54", "53", "52", "51"],
  ["61", "62", "63", "64", "65"],
  ["85", "84", "83", "82", "81"],
  ["71", "72", "73", "74", "75"],
];

export const FACES = ["geral", "oclusal", "vestibular", "lingual", "mesial", "distal"] as const;

export const CONDITION_META: Record<string, { label: string; color: string; short: string }> = {
  carie: { label: "Cárie", color: "#dc2626", short: "C" },
  restauracao: { label: "Restauração", color: "#2563eb", short: "R" },
  ausente: { label: "Dente ausente", color: "#94a3b8", short: "A" },
  extracao: { label: "Extração", color: "#475569", short: "E" },
  coroa: { label: "Coroa", color: "#ca8a04", short: "K" },
  endodontia: { label: "Endodontia", color: "#7c3aed", short: "T" },
  implante: { label: "Implante", color: "#0f766e", short: "I" },
  fratura: { label: "Fratura", color: "#ea580c", short: "F" },
  provisorio: { label: "Provisório", color: "#0891b2", short: "P" },
  selante: { label: "Selante", color: "#16a34a", short: "S" },
  limpeza: { label: "Limpeza", color: "#65a30d", short: "L" },
  planejado: { label: "Planejado", color: "#d946ef", short: "PL" },
  observacao: { label: "Observação", color: "#64748b", short: "O" },
};

export interface OdontogramEntryLike {
  id: number;
  dentition: string;
  tooth_code: string;
  face: string;
  condition: string;
  status: string;
  notes: string;
  professional_name?: string;
  created_at: string;
}

interface Props {
  entries: OdontogramEntryLike[];
  dentition: "permanente" | "decidua";
  onSelect: (tooth: string, face: string) => void;
  readOnly?: boolean;
}

export default function Odontogram({ entries, dentition, onSelect, readOnly }: Props) {
  const [activeTooth, setActiveTooth] = useState<string | null>(null);
  const grid = dentition === "decidua" ? DECIDUOUS_TEETH : PERMANENT_TEETH;

  const byTooth = useMemo(() => {
    const map = new Map<string, OdontogramEntryLike[]>();
    for (const e of entries) {
      if (e.dentition !== dentition) continue;
      const list = map.get(e.tooth_code) ?? [];
      list.push(e);
      map.set(e.tooth_code, list);
    }
    return map;
  }, [entries, dentition]);

  const toothState = (code: string) => {
    const list = byTooth.get(code) ?? [];
    const general = list.find((e) => e.face === "geral");
    return { list, general };
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-8 gap-1.5 sm:gap-2">
        {grid.flat().map((code) => {
          const { list, general } = toothState(code);
          const color = general ? CONDITION_META[general.condition]?.color : undefined;
          const isActive = activeTooth === code;
          const isMissing = general?.condition === "ausente" || general?.condition === "extracao";
          return (
            <button
              key={code}
              onClick={() => {
                setActiveTooth(isActive ? null : code);
                if (!readOnly) onSelect(code, "geral");
              }}
              className={clsx(
                "relative flex flex-col items-center gap-0.5 rounded-lg border p-1 transition",
                isActive ? "border-brand-600 bg-brand-50 ring-2 ring-brand-200" : "border-slate-200 bg-white hover:border-brand-300"
              )}
              aria-label={`Dente ${code}`}
            >
              <span className={clsx("text-[10px] font-bold", color ? "text-slate-900" : "text-slate-500")}>{code}</span>
              <span
                className={clsx("grid h-7 w-6 place-items-center rounded text-[10px] font-bold text-white", isMissing && "line-through")}
                style={{ background: color ?? "#e2e8f0", color: color ? "#fff" : "#94a3b8" }}
              >
                {general ? CONDITION_META[general.condition]?.short ?? "" : ""}
              </span>
              <span className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                <span
                  className="block h-full bg-brand-400"
                  style={{ width: `${Math.min(list.length * 25, 100)}%` }}
                />
              </span>
            </button>
          );
        })}
      </div>

      {activeTooth && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Dente {activeTooth} — histórico</p>
            <button className="text-xs text-slate-500 hover:underline" onClick={() => setActiveTooth(null)}>fechar</button>
          </div>
          {(byTooth.get(activeTooth) ?? []).length === 0 && (
            <p className="text-xs text-slate-500">Nenhuma marcação. Toque em uma face acima para registrar.</p>
          )}
          <ul className="space-y-1">
            {(byTooth.get(activeTooth) ?? []).map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-xs">
                <span>
                  <span className="font-semibold" style={{ color: CONDITION_META[e.condition]?.color }}>
                    {CONDITION_META[e.condition]?.label ?? e.condition}
                  </span>{" "}
                  · face {e.face} · {e.status}
                  {e.notes ? ` · ${e.notes}` : ""}
                </span>
                <span className="shrink-0 text-slate-400">{new Date(e.created_at).toLocaleDateString("pt-BR")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {Object.entries(CONDITION_META).map(([key, meta]) => (
          <span key={key} className="inline-flex items-center gap-1 text-[10px] text-slate-600">
            <span className="h-2.5 w-2.5 rounded" style={{ background: meta.color }} />
            {meta.label}
          </span>
        ))}
      </div>
    </div>
  );
}

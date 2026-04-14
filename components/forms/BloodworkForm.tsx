"use client";

import { useState, useRef } from "react";
import { format } from "date-fns";
import { useStore } from "@/lib/store";
import { generateCSVTemplate, analyzeBloodwork } from "@/lib/bloodwork-engine";
import { emptyBloodworkPanel } from "@/lib/types";
import type { BloodworkEntry, BloodworkPanel } from "@/lib/types";
import {
  FlaskConical, ChevronDown, ChevronRight, Upload, Download,
  CheckCircle2, Sparkles, Loader2, AlertCircle, X,
} from "lucide-react";
import { useRouter } from "next/navigation";

// ─── Reusable field ────────────────────────────────────────────────────────

function BiomarkerInput({
  label, unit, optimal, value, onChange, placeholder, step = 0.1,
}: {
  label: string; unit: string; optimal: string;
  value: number | null; onChange: (v: number | null) => void;
  placeholder?: string; step?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label className="text-2xs text-text-muted uppercase tracking-wider">{label}</label>
        <span className="text-2xs text-text-muted/60 italic truncate max-w-[120px]">{optimal}</span>
      </div>
      <div className="flex items-center gap-2 bg-bg-elevated border border-bg-border rounded-xl px-3 py-2">
        <input
          type="number" step={step} value={value ?? ""}
          placeholder={placeholder ?? "—"}
          onChange={(e) => { const v = e.target.value; onChange(v === "" ? null : parseFloat(v)); }}
          className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder-text-muted tabular-nums min-w-0"
        />
        <span className="text-2xs text-text-muted shrink-0">{unit}</span>
      </div>
    </div>
  );
}

// ─── Collapsible section ───────────────────────────────────────────────────

function Section({
  title, count, filled, children, defaultOpen = false,
}: {
  title: string; count: number; filled: number;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-bg-card border border-bg-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-4 py-3.5 hover:bg-bg-elevated transition-colors"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
          <span className="text-sm font-semibold text-text-primary">{title}</span>
        </div>
        <span className={`text-2xs font-semibold px-2 py-0.5 rounded-full ${filled > 0 ? "bg-gold/15 text-gold" : "bg-bg-border text-text-muted"}`}>
          {filled}/{count}
        </span>
      </button>
      {open && <div className="px-4 pb-4 pt-1 grid grid-cols-2 gap-3">{children}</div>}
    </div>
  );
}

// ─── Filled count helper ───────────────────────────────────────────────────

function count(panel: BloodworkPanel, keys: (keyof BloodworkPanel)[]) {
  return keys.filter((k) => panel[k] !== null).length;
}

// ─── Main form ─────────────────────────────────────────────────────────────

export default function BloodworkForm({ onSubmitted }: { onSubmitted?: () => void } = {}) {
  const upsertBloodwork = useStore((s) => s.upsertBloodwork);
  const router = useRouter();
  const today = format(new Date(), "yyyy-MM-dd");

  const [panel, setPanel] = useState<BloodworkPanel>(emptyBloodworkPanel());
  const [labName, setLabName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // AI upload state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadCount, setUploadCount] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [showPaste, setShowPaste] = useState(false);

  const set = (key: keyof BloodworkPanel, v: number | null) =>
    setPanel((p) => ({ ...p, [key]: v }));

  // ── AI upload handler ───────────────────────────────────────────────────

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    setUploadCount(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-labs", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");

      if (data.panel && data.count > 0) {
        setPanel((p) => ({ ...p, ...data.panel }));
        setUploadCount(data.count);
      } else {
        setUploadError("No lab values found in the file. Try pasting the text directly.");
      }
    } catch (e) {
      setUploadError(String(e));
    } finally {
      setUploading(false);
    }
  };


  const handleTextPaste = async () => {
    const text = textRef.current?.value ?? "";
    if (!text.trim()) return;
    setUploading(true);
    setUploadError(null);
    setUploadCount(null);
    try {
      const fd = new FormData();
      fd.append("text", text);
      const res = await fetch("/api/parse-labs", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Parse failed");
      if (data.panel && data.count > 0) {
        setPanel((p) => ({ ...p, ...data.panel }));
        setUploadCount(data.count);
        setShowPaste(false);
      } else {
        setUploadError("No lab values detected. Try the CSV format or upload an image.");
      }
    } catch (e) {
      setUploadError(String(e));
    } finally {
      setUploading(false);
    }
  };

  // ── Submit ──────────────────────────────────────────────────────────────

  const handleSubmit = () => {
    setSubmitting(true);
    const entry: BloodworkEntry = {
      id: crypto.randomUUID(),
      date: today,
      labName: labName || "Lab Results",
      panel,
      notes,
    };
    upsertBloodwork(entry);
    setSubmitting(false);
    setSubmitted(true);
    setTimeout(() => { onSubmitted ? onSubmitted() : router.push("/bloodwork"); }, 800);
  };

  const totalFilled = Object.values(panel).filter((v) => v !== null).length;

  return (
    <div className="flex flex-col gap-4 pb-8 animate-fade-in">

      {/* ── AI Upload Card ────────────────────────────────────────────── */}
      <div className="bg-bg-card border border-gold/30 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={15} className="text-gold" />
          <span className="text-sm font-semibold text-text-primary">AI Lab Interpreter</span>
          <span className="text-2xs bg-gold/15 text-gold px-2 py-0.5 rounded-full font-semibold">Auto-fill</span>
        </div>
        <p className="text-xs text-text-muted mb-3 leading-relaxed">
          Upload your lab report (PDF, CSV, JPG, PNG) or paste raw text — Claude will extract all values automatically.
        </p>

        {/* Upload buttons */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gold text-bg-primary text-xs font-bold hover:bg-gold-light transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            Upload File
          </button>
          <button
            onClick={() => setShowPaste(!showPaste)}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-bg-border bg-bg-elevated text-xs font-semibold text-text-secondary hover:border-text-muted transition-colors"
          >
            Paste Text
          </button>
          <button
            onClick={() => {
              const csv = generateCSVTemplate();
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = "lab-template.csv"; a.click();
              URL.revokeObjectURL(url);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-bg-border bg-bg-elevated text-xs font-semibold text-text-muted hover:border-text-muted transition-colors"
          >
            <Download size={13} /> CSV Template
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.pdf,.jpg,.jpeg,.png,image/*,application/pdf"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ""; }}
        />

        {showPaste && (
          <div className="mt-3 flex flex-col gap-2">
            <textarea
              ref={textRef}
              rows={6}
              placeholder={"Paste your lab values here.\nCSV (marker,value) or any text format:\n\nHemoglobin: 15.2 g/dL\nFerritin: 95 ng/mL\nTestosterone Total: 720 ng/dL\n..."}
              className="w-full bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5 text-xs text-text-primary placeholder-text-muted outline-none resize-none font-mono"
            />
            <div className="flex gap-2">
              <button
                onClick={handleTextPaste}
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gold text-bg-primary text-xs font-bold hover:bg-gold-light transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Extract Values
              </button>
              <button onClick={() => setShowPaste(false)} className="px-3 py-2 rounded-xl border border-bg-border text-xs text-text-muted hover:border-text-muted transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {uploading && (
          <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
            <Loader2 size={13} className="animate-spin" />
            <span>Scanning PDF with OCR — this may take a moment…</span>
          </div>
        )}
        {uploadCount !== null && (
          <div className="mt-3 flex items-center gap-2 text-xs text-recovery-high">
            <CheckCircle2 size={13} />
            <span>{uploadCount} values extracted and filled in below.</span>
          </div>
        )}
        {uploadError && (
          <div className="mt-3 flex items-start gap-2 text-xs text-recovery-low">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}
      </div>

      {/* ── Lab metadata ─────────────────────────────────────────────── */}
      <div className="bg-bg-card border border-bg-border rounded-2xl p-4">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Lab Info</h3>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-2xs text-text-muted uppercase tracking-wider">Lab Name</label>
            <input
              type="text" value={labName} placeholder="e.g. LabCorp, Quest, Inside Tracker"
              onChange={(e) => setLabName(e.target.value)}
              className="bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5 text-sm text-text-primary outline-none placeholder-text-muted"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-2xs text-text-muted uppercase tracking-wider">Notes (optional)</label>
            <input
              type="text" value={notes} placeholder="e.g. Fasted 12h, post-deload week"
              onChange={(e) => setNotes(e.target.value)}
              className="bg-bg-elevated border border-bg-border rounded-xl px-3 py-2.5 text-sm text-text-primary outline-none placeholder-text-muted"
            />
          </div>
        </div>
      </div>

      {/* ── Filled progress ───────────────────────────────────────────── */}
      {totalFilled > 0 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-text-muted">{totalFilled} markers entered</span>
          <button onClick={() => setPanel(emptyBloodworkPanel())} className="flex items-center gap-1 text-xs text-text-muted hover:text-recovery-low transition-colors">
            <X size={11} /> Clear all
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* SECTION 1 — Oxygen Delivery & RBC */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <Section title="1 · Oxygen Delivery & RBC" count={10}
        filled={count(panel, ["rbc","hemoglobin","hematocrit","mcv","mch","mchc","rdw","reticulocyteCount","reticulocyteHb","epo"])}>
        <BiomarkerInput label="RBC" unit="M/μL" optimal="4.7–6.1" value={panel.rbc} onChange={(v) => set("rbc", v)} />
        <BiomarkerInput label="Hemoglobin" unit="g/dL" optimal="14.5–17.5" value={panel.hemoglobin} onChange={(v) => set("hemoglobin", v)} />
        <BiomarkerInput label="Hematocrit" unit="%" optimal="42–52" value={panel.hematocrit} onChange={(v) => set("hematocrit", v)} />
        <BiomarkerInput label="MCV" unit="fL" optimal="82–92" value={panel.mcv} onChange={(v) => set("mcv", v)} />
        <BiomarkerInput label="MCH" unit="pg" optimal="27–33" value={panel.mch} onChange={(v) => set("mch", v)} />
        <BiomarkerInput label="MCHC" unit="g/dL" optimal="33–35" value={panel.mchc} onChange={(v) => set("mchc", v)} />
        <BiomarkerInput label="RDW" unit="%" optimal="<13" value={panel.rdw} onChange={(v) => set("rdw", v)} />
        <BiomarkerInput label="Reticulocytes" unit="%" optimal="0.5–2.5" value={panel.reticulocyteCount} onChange={(v) => set("reticulocyteCount", v)} />
        <BiomarkerInput label="Retic Hb" unit="pg" optimal=">29" value={panel.reticulocyteHb} onChange={(v) => set("reticulocyteHb", v)} />
        <BiomarkerInput label="EPO" unit="mIU/mL" optimal="4–24" value={panel.epo} onChange={(v) => set("epo", v)} />
      </Section>

      {/* SECTION 2 — Iron Status */}
      <Section title="2 · Iron Status & Handling" count={10}
        filled={count(panel, ["ferritin","ironSerum","transferrin","tibc","uibc","tsat","stfr","hepcidin","haptoglobin","indirectBilirubin"])}>
        <BiomarkerInput label="Ferritin" unit="ng/mL" optimal="80–150" value={panel.ferritin} onChange={(v) => set("ferritin", v)} />
        <BiomarkerInput label="Serum Iron" unit="μg/dL" optimal="80–120" value={panel.ironSerum} onChange={(v) => set("ironSerum", v)} />
        <BiomarkerInput label="Transferrin" unit="mg/dL" optimal="220–300" value={panel.transferrin} onChange={(v) => set("transferrin", v)} />
        <BiomarkerInput label="TIBC" unit="μg/dL" optimal="250–330" value={panel.tibc} onChange={(v) => set("tibc", v)} />
        <BiomarkerInput label="UIBC" unit="μg/dL" optimal="100–200" value={panel.uibc} onChange={(v) => set("uibc", v)} />
        <BiomarkerInput label="Transferrin Sat" unit="%" optimal="25–40" value={panel.tsat} onChange={(v) => set("tsat", v)} />
        <BiomarkerInput label="sTfR" unit="mg/L" optimal="0.83–1.76" value={panel.stfr} onChange={(v) => set("stfr", v)} />
        <BiomarkerInput label="Hepcidin" unit="ng/mL" optimal="30–150" value={panel.hepcidin} onChange={(v) => set("hepcidin", v)} />
        <BiomarkerInput label="Haptoglobin" unit="g/L" optimal="0.8–2.0" value={panel.haptoglobin} onChange={(v) => set("haptoglobin", v)} />
        <BiomarkerInput label="Indirect Bili" unit="mg/dL" optimal="<0.8" value={panel.indirectBilirubin} onChange={(v) => set("indirectBilirubin", v)} />
      </Section>

      {/* SECTION 3 — Muscle Damage */}
      <Section title="3 · Muscle Damage & Training Stress" count={7}
        filled={count(panel, ["creatineKinase","ldh","myoglobin","ast","alt","aldolase","troponin"])}>
        <BiomarkerInput label="Creatine Kinase" unit="U/L" optimal="<200" value={panel.creatineKinase} onChange={(v) => set("creatineKinase", v)} step={1} />
        <BiomarkerInput label="LDH" unit="U/L" optimal="140–200" value={panel.ldh} onChange={(v) => set("ldh", v)} step={1} />
        <BiomarkerInput label="Myoglobin" unit="ng/mL" optimal="<85" value={panel.myoglobin} onChange={(v) => set("myoglobin", v)} />
        <BiomarkerInput label="AST" unit="U/L" optimal="<25" value={panel.ast} onChange={(v) => set("ast", v)} step={1} />
        <BiomarkerInput label="ALT" unit="U/L" optimal="<25" value={panel.alt} onChange={(v) => set("alt", v)} step={1} />
        <BiomarkerInput label="Aldolase" unit="U/L" optimal="1.5–7.5" value={panel.aldolase} onChange={(v) => set("aldolase", v)} />
        <BiomarkerInput label="Troponin I" unit="ng/L" optimal="<26" value={panel.troponin} onChange={(v) => set("troponin", v)} />
      </Section>

      {/* SECTION 4 — Inflammation */}
      <Section title="4 · Systemic Inflammation" count={6}
        filled={count(panel, ["hsCRP","il6","tnfAlpha","fibrinogen","esr","serumAmyloidA"])}>
        <BiomarkerInput label="hs-CRP" unit="mg/L" optimal="<0.5" value={panel.hsCRP} onChange={(v) => set("hsCRP", v)} />
        <BiomarkerInput label="IL-6" unit="pg/mL" optimal="<2" value={panel.il6} onChange={(v) => set("il6", v)} />
        <BiomarkerInput label="TNF-α" unit="pg/mL" optimal="<3" value={panel.tnfAlpha} onChange={(v) => set("tnfAlpha", v)} />
        <BiomarkerInput label="Fibrinogen" unit="mg/dL" optimal="200–350" value={panel.fibrinogen} onChange={(v) => set("fibrinogen", v)} step={1} />
        <BiomarkerInput label="ESR" unit="mm/hr" optimal="<10" value={panel.esr} onChange={(v) => set("esr", v)} step={1} />
        <BiomarkerInput label="Serum Amyloid A" unit="mg/L" optimal="<6.4" value={panel.serumAmyloidA} onChange={(v) => set("serumAmyloidA", v)} />
      </Section>

      {/* SECTION 5 — Stress & Hormones */}
      <Section title="5 · Stress, Hormones & Anabolic Balance" count={9}
        filled={count(panel, ["cortisolAM","cortisolPM","testosteroneTotal","testosteroneFree","shbg","dheas","acth","gh","igf1"])}>
        <BiomarkerInput label="Cortisol (AM)" unit="μg/dL" optimal="10–18" value={panel.cortisolAM} onChange={(v) => set("cortisolAM", v)} />
        <BiomarkerInput label="Cortisol (PM)" unit="μg/dL" optimal="2–6" value={panel.cortisolPM} onChange={(v) => set("cortisolPM", v)} />
        <BiomarkerInput label="Testosterone Total" unit="ng/dL" optimal="600–1000" value={panel.testosteroneTotal} onChange={(v) => set("testosteroneTotal", v)} step={1} />
        <BiomarkerInput label="Testosterone Free" unit="pg/mL" optimal="15–25" value={panel.testosteroneFree} onChange={(v) => set("testosteroneFree", v)} />
        <BiomarkerInput label="SHBG" unit="nmol/L" optimal="20–40" value={panel.shbg} onChange={(v) => set("shbg", v)} />
        <BiomarkerInput label="DHEA-S" unit="μg/dL" optimal="200–400" value={panel.dheas} onChange={(v) => set("dheas", v)} step={1} />
        <BiomarkerInput label="ACTH" unit="pg/mL" optimal="10–40" value={panel.acth} onChange={(v) => set("acth", v)} />
        <BiomarkerInput label="Growth Hormone" unit="ng/mL" optimal="<1 (fast)" value={panel.gh} onChange={(v) => set("gh", v)} />
        <BiomarkerInput label="IGF-1" unit="ng/mL" optimal="150–250" value={panel.igf1} onChange={(v) => set("igf1", v)} step={1} />
      </Section>

      {/* SECTION 6 — Thyroid */}
      <Section title="6 · Thyroid & Metabolic Rate" count={8}
        filled={count(panel, ["tsh","freeT4","freeT3","totalT4","totalT3","reverseT3","tpoAb","tgAb"])}>
        <BiomarkerInput label="TSH" unit="mIU/L" optimal="0.5–2.0" value={panel.tsh} onChange={(v) => set("tsh", v)} />
        <BiomarkerInput label="Free T4" unit="ng/dL" optimal="1.1–1.6" value={panel.freeT4} onChange={(v) => set("freeT4", v)} />
        <BiomarkerInput label="Free T3" unit="pg/mL" optimal="3.2–4.2" value={panel.freeT3} onChange={(v) => set("freeT3", v)} />
        <BiomarkerInput label="Total T4" unit="μg/dL" optimal="6.5–10" value={panel.totalT4} onChange={(v) => set("totalT4", v)} />
        <BiomarkerInput label="Total T3" unit="ng/dL" optimal="100–180" value={panel.totalT3} onChange={(v) => set("totalT3", v)} step={1} />
        <BiomarkerInput label="Reverse T3" unit="ng/dL" optimal="<15" value={panel.reverseT3} onChange={(v) => set("reverseT3", v)} />
        <BiomarkerInput label="TPO Ab" unit="IU/mL" optimal="<35" value={panel.tpoAb} onChange={(v) => set("tpoAb", v)} step={1} />
        <BiomarkerInput label="TgAb" unit="IU/mL" optimal="<20" value={panel.tgAb} onChange={(v) => set("tgAb", v)} step={1} />
      </Section>

      {/* SECTION 7 — Glucose */}
      <Section title="7 · Glucose Regulation & Fuel" count={7}
        filled={count(panel, ["glucoseFasting","insulin","hba1c","cPeptide","fructosamine","lactateFasting","betaHydroxybutyrate"])}>
        <BiomarkerInput label="Fasting Glucose" unit="mg/dL" optimal="72–90" value={panel.glucoseFasting} onChange={(v) => set("glucoseFasting", v)} step={1} />
        <BiomarkerInput label="Fasting Insulin" unit="μIU/mL" optimal="<5" value={panel.insulin} onChange={(v) => set("insulin", v)} />
        <BiomarkerInput label="HbA1c" unit="%" optimal="<5.3" value={panel.hba1c} onChange={(v) => set("hba1c", v)} />
        <BiomarkerInput label="C-Peptide" unit="ng/mL" optimal="0.8–2.0" value={panel.cPeptide} onChange={(v) => set("cPeptide", v)} />
        <BiomarkerInput label="Fructosamine" unit="μmol/L" optimal="190–240" value={panel.fructosamine} onChange={(v) => set("fructosamine", v)} step={1} />
        <BiomarkerInput label="Fasting Lactate" unit="mmol/L" optimal="0.5–1.5" value={panel.lactateFasting} onChange={(v) => set("lactateFasting", v)} />
        <BiomarkerInput label="β-Hydroxybutyrate" unit="mmol/L" optimal="<0.3" value={panel.betaHydroxybutyrate} onChange={(v) => set("betaHydroxybutyrate", v)} />
      </Section>

      {/* SECTION 8 — Liver & Protein */}
      <Section title="8 · Liver Function & Protein Status" count={6}
        filled={count(panel, ["albumin","totalProtein","ggt","alp","totalBilirubin","directBilirubin"])}>
        <BiomarkerInput label="Albumin" unit="g/dL" optimal="4.2–5.0" value={panel.albumin} onChange={(v) => set("albumin", v)} />
        <BiomarkerInput label="Total Protein" unit="g/dL" optimal="7.0–8.0" value={panel.totalProtein} onChange={(v) => set("totalProtein", v)} />
        <BiomarkerInput label="GGT" unit="U/L" optimal="<20" value={panel.ggt} onChange={(v) => set("ggt", v)} step={1} />
        <BiomarkerInput label="ALP" unit="U/L" optimal="40–100" value={panel.alp} onChange={(v) => set("alp", v)} step={1} />
        <BiomarkerInput label="Total Bilirubin" unit="mg/dL" optimal="<0.8" value={panel.totalBilirubin} onChange={(v) => set("totalBilirubin", v)} />
        <BiomarkerInput label="Direct Bilirubin" unit="mg/dL" optimal="<0.2" value={panel.directBilirubin} onChange={(v) => set("directBilirubin", v)} />
      </Section>

      {/* SECTION 9 — Kidney & Hydration */}
      <Section title="9 · Kidney Function & Hydration" count={8}
        filled={count(panel, ["creatinine","cystatinC","egfr","egfrCystatinC","bun","uricAcid","plasmaOsmolality","sodium"])}>
        <BiomarkerInput label="Creatinine" unit="mg/dL" optimal="0.8–1.1" value={panel.creatinine} onChange={(v) => set("creatinine", v)} />
        <BiomarkerInput label="Cystatin C" unit="mg/L" optimal="0.5–0.8" value={panel.cystatinC} onChange={(v) => set("cystatinC", v)} />
        <BiomarkerInput label="eGFR" unit="mL/min" optimal=">90" value={panel.egfr} onChange={(v) => set("egfr", v)} step={1} />
        <BiomarkerInput label="eGFR (Cystatin)" unit="mL/min" optimal=">90" value={panel.egfrCystatinC} onChange={(v) => set("egfrCystatinC", v)} step={1} />
        <BiomarkerInput label="BUN" unit="mg/dL" optimal="10–20" value={panel.bun} onChange={(v) => set("bun", v)} step={1} />
        <BiomarkerInput label="Uric Acid" unit="mg/dL" optimal="3.5–6.0" value={panel.uricAcid} onChange={(v) => set("uricAcid", v)} />
        <BiomarkerInput label="Plasma Osmolality" unit="mOsm/kg" optimal="280–295" value={panel.plasmaOsmolality} onChange={(v) => set("plasmaOsmolality", v)} step={1} />
        <BiomarkerInput label="Sodium" unit="mEq/L" optimal="136–142" value={panel.sodium} onChange={(v) => set("sodium", v)} step={1} />
      </Section>

      {/* SECTION 10 — Electrolytes */}
      <Section title="10 · Electrolytes & Neuromuscular Recovery" count={7}
        filled={count(panel, ["potassium","chloride","bicarbonate","calciumTotal","ionizedCalcium","magnesium","phosphate"])}>
        <BiomarkerInput label="Potassium" unit="mEq/L" optimal="4.0–4.8" value={panel.potassium} onChange={(v) => set("potassium", v)} />
        <BiomarkerInput label="Chloride" unit="mEq/L" optimal="100–106" value={panel.chloride} onChange={(v) => set("chloride", v)} step={1} />
        <BiomarkerInput label="Bicarbonate" unit="mEq/L" optimal="24–28" value={panel.bicarbonate} onChange={(v) => set("bicarbonate", v)} step={1} />
        <BiomarkerInput label="Calcium (Total)" unit="mg/dL" optimal="9.0–10.2" value={panel.calciumTotal} onChange={(v) => set("calciumTotal", v)} />
        <BiomarkerInput label="Ionized Ca" unit="mmol/L" optimal="1.15–1.30" value={panel.ionizedCalcium} onChange={(v) => set("ionizedCalcium", v)} />
        <BiomarkerInput label="Magnesium" unit="mg/dL" optimal="2.1–2.5" value={panel.magnesium} onChange={(v) => set("magnesium", v)} />
        <BiomarkerInput label="Phosphate" unit="mg/dL" optimal="2.5–4.5" value={panel.phosphate} onChange={(v) => set("phosphate", v)} />
      </Section>

      {/* SECTION 11 — Bone & Vitamin D */}
      <Section title="11 · Bone Health & Vitamin D" count={6}
        filled={count(panel, ["vitaminD","vitaminD125","pth","p1np","ctx1","osteocalcin"])}>
        <BiomarkerInput label="Vitamin D (25-OH)" unit="ng/mL" optimal="50–80" value={panel.vitaminD} onChange={(v) => set("vitaminD", v)} step={1} />
        <BiomarkerInput label="Vitamin D (1,25)" unit="pg/mL" optimal="40–65" value={panel.vitaminD125} onChange={(v) => set("vitaminD125", v)} step={1} />
        <BiomarkerInput label="PTH" unit="pg/mL" optimal="15–50" value={panel.pth} onChange={(v) => set("pth", v)} step={1} />
        <BiomarkerInput label="P1NP" unit="ng/mL" optimal="25–74" value={panel.p1np} onChange={(v) => set("p1np", v)} step={1} />
        <BiomarkerInput label="CTX-1" unit="pg/mL" optimal="100–400" value={panel.ctx1} onChange={(v) => set("ctx1", v)} step={1} />
        <BiomarkerInput label="Osteocalcin" unit="ng/mL" optimal="5–14" value={panel.osteocalcin} onChange={(v) => set("osteocalcin", v)} />
      </Section>

      {/* SECTION 12 — Lipids */}
      <Section title="12 · Lipids & Cardiometabolic Health" count={7}
        filled={count(panel, ["totalCholesterol","ldl","hdl","triglycerides","apob","apoA1","lipoproteinA"])}>
        <BiomarkerInput label="Total Cholesterol" unit="mg/dL" optimal="160–200" value={panel.totalCholesterol} onChange={(v) => set("totalCholesterol", v)} step={1} />
        <BiomarkerInput label="LDL" unit="mg/dL" optimal="<100" value={panel.ldl} onChange={(v) => set("ldl", v)} step={1} />
        <BiomarkerInput label="HDL" unit="mg/dL" optimal=">55" value={panel.hdl} onChange={(v) => set("hdl", v)} step={1} />
        <BiomarkerInput label="Triglycerides" unit="mg/dL" optimal="<100" value={panel.triglycerides} onChange={(v) => set("triglycerides", v)} step={1} />
        <BiomarkerInput label="ApoB" unit="mg/dL" optimal="<80" value={panel.apob} onChange={(v) => set("apob", v)} step={1} />
        <BiomarkerInput label="ApoA1" unit="mg/dL" optimal=">130" value={panel.apoA1} onChange={(v) => set("apoA1", v)} step={1} />
        <BiomarkerInput label="Lp(a)" unit="mg/dL" optimal="<30" value={panel.lipoproteinA} onChange={(v) => set("lipoproteinA", v)} step={1} />
      </Section>

      {/* SECTION 13 — Micronutrients */}
      <Section title="13 · Micronutrients" count={8}
        filled={count(panel, ["vitaminB12","folate","rbcFolate","vitaminB6","vitaminB1","zinc","copper","selenium"])}>
        <BiomarkerInput label="Vitamin B12" unit="pg/mL" optimal="400–900" value={panel.vitaminB12} onChange={(v) => set("vitaminB12", v)} step={1} />
        <BiomarkerInput label="Serum Folate" unit="ng/mL" optimal=">10" value={panel.folate} onChange={(v) => set("folate", v)} />
        <BiomarkerInput label="RBC Folate" unit="ng/mL" optimal=">280" value={panel.rbcFolate} onChange={(v) => set("rbcFolate", v)} step={1} />
        <BiomarkerInput label="Vitamin B6 (P5P)" unit="nmol/L" optimal="25–80" value={panel.vitaminB6} onChange={(v) => set("vitaminB6", v)} step={1} />
        <BiomarkerInput label="Vitamin B1" unit="nmol/L" optimal="70–150" value={panel.vitaminB1} onChange={(v) => set("vitaminB1", v)} step={1} />
        <BiomarkerInput label="Zinc" unit="μg/dL" optimal="85–120" value={panel.zinc} onChange={(v) => set("zinc", v)} step={1} />
        <BiomarkerInput label="Copper" unit="μg/dL" optimal="70–140" value={panel.copper} onChange={(v) => set("copper", v)} step={1} />
        <BiomarkerInput label="Selenium" unit="μg/L" optimal="120–200" value={panel.selenium} onChange={(v) => set("selenium", v)} step={1} />
      </Section>

      {/* SECTION 14 — Oxidative Stress */}
      <Section title="14 · Oxidative Stress & Antioxidants" count={3}
        filled={count(panel, ["mda","totalAntioxidantCapacity","reducedGlutathione"])}>
        <BiomarkerInput label="MDA" unit="μmol/L" optimal="<0.5" value={panel.mda} onChange={(v) => set("mda", v)} />
        <BiomarkerInput label="Total Antioxidant Cap" unit="mmol/L" optimal=">1.5" value={panel.totalAntioxidantCapacity} onChange={(v) => set("totalAntioxidantCapacity", v)} />
        <BiomarkerInput label="Glutathione (GSH)" unit="μmol/L" optimal=">800" value={panel.reducedGlutathione} onChange={(v) => set("reducedGlutathione", v)} step={1} />
      </Section>

      {/* SECTION 15 — Fatty Acids */}
      <Section title="15 · Fatty Acids & Membrane Health" count={4}
        filled={count(panel, ["omega3Index","epa","dha","arachidonicAcid"])}>
        <BiomarkerInput label="Omega-3 Index" unit="%" optimal=">8" value={panel.omega3Index} onChange={(v) => set("omega3Index", v)} />
        <BiomarkerInput label="EPA" unit="%" optimal=">1.5" value={panel.epa} onChange={(v) => set("epa", v)} />
        <BiomarkerInput label="DHA" unit="%" optimal=">4.5" value={panel.dha} onChange={(v) => set("dha", v)} />
        <BiomarkerInput label="Arachidonic Acid" unit="%" optimal="8–12" value={panel.arachidonicAcid} onChange={(v) => set("arachidonicAcid", v)} />
      </Section>

      {/* SECTION 16 — Reproductive Hormones */}
      <Section title="16 · Reproductive Hormones & RED-S" count={7}
        filled={count(panel, ["lh","fsh","estradiol","progesterone","prolactin","leptin","ghrelin"])}>
        <BiomarkerInput label="LH" unit="mIU/mL" optimal="2–8" value={panel.lh} onChange={(v) => set("lh", v)} />
        <BiomarkerInput label="FSH" unit="mIU/mL" optimal="2–10" value={panel.fsh} onChange={(v) => set("fsh", v)} />
        <BiomarkerInput label="Estradiol (E2)" unit="pg/mL" optimal="20–35" value={panel.estradiol} onChange={(v) => set("estradiol", v)} step={1} />
        <BiomarkerInput label="Progesterone" unit="ng/mL" optimal="0.2–1.4" value={panel.progesterone} onChange={(v) => set("progesterone", v)} />
        <BiomarkerInput label="Prolactin" unit="ng/mL" optimal="2–15" value={panel.prolactin} onChange={(v) => set("prolactin", v)} />
        <BiomarkerInput label="Leptin" unit="ng/mL" optimal="2–10" value={panel.leptin} onChange={(v) => set("leptin", v)} />
        <BiomarkerInput label="Ghrelin" unit="pg/mL" optimal="100–500" value={panel.ghrelin} onChange={(v) => set("ghrelin", v)} step={1} />
      </Section>

      {/* SECTION 17 — Connective Tissue */}
      <Section title="17 · Connective Tissue & Repair" count={5}
        filled={count(panel, ["piiinp","comp","hyaluronicAcid","mmp3","mmp9"])}>
        <BiomarkerInput label="P-III-NP" unit="ng/mL" optimal="3–8" value={panel.piiinp} onChange={(v) => set("piiinp", v)} />
        <BiomarkerInput label="COMP" unit="μg/mL" optimal="3–8" value={panel.comp} onChange={(v) => set("comp", v)} />
        <BiomarkerInput label="Hyaluronic Acid" unit="ng/mL" optimal="<50" value={panel.hyaluronicAcid} onChange={(v) => set("hyaluronicAcid", v)} step={1} />
        <BiomarkerInput label="MMP-3" unit="ng/mL" optimal="5–25" value={panel.mmp3} onChange={(v) => set("mmp3", v)} />
        <BiomarkerInput label="MMP-9" unit="ng/mL" optimal="<30" value={panel.mmp9} onChange={(v) => set("mmp9", v)} />
      </Section>

      {/* SECTION 18 — Immune & WBC */}
      <Section title="18 · White Blood Cells & Immune" count={8}
        filled={count(panel, ["wbc","neutrophils","lymphocytes","monocytes","eosinophils","basophils","platelets","mpv"])}>
        <BiomarkerInput label="WBC" unit="K/μL" optimal="5.0–8.0" value={panel.wbc} onChange={(v) => set("wbc", v)} />
        <BiomarkerInput label="Neutrophils" unit="K/μL" optimal="2.0–6.0" value={panel.neutrophils} onChange={(v) => set("neutrophils", v)} />
        <BiomarkerInput label="Lymphocytes" unit="K/μL" optimal="1.5–3.5" value={panel.lymphocytes} onChange={(v) => set("lymphocytes", v)} />
        <BiomarkerInput label="Monocytes" unit="K/μL" optimal="0.2–0.8" value={panel.monocytes} onChange={(v) => set("monocytes", v)} />
        <BiomarkerInput label="Eosinophils" unit="K/μL" optimal="<0.3" value={panel.eosinophils} onChange={(v) => set("eosinophils", v)} />
        <BiomarkerInput label="Basophils" unit="K/μL" optimal="<0.1" value={panel.basophils} onChange={(v) => set("basophils", v)} />
        <BiomarkerInput label="Platelets" unit="K/μL" optimal="200–350" value={panel.platelets} onChange={(v) => set("platelets", v)} step={1} />
        <BiomarkerInput label="MPV" unit="fL" optimal="7.5–12" value={panel.mpv} onChange={(v) => set("mpv", v)} />
      </Section>

      {/* SECTION 19 — Vascular & Coagulation */}
      <Section title="19 · Vascular & Coagulation" count={6}
        filled={count(panel, ["homocysteine","dDimer","ptInr","vonWillebrandFactor","nitricOxide","vegf"])}>
        <BiomarkerInput label="Homocysteine" unit="μmol/L" optimal="<8" value={panel.homocysteine} onChange={(v) => set("homocysteine", v)} />
        <BiomarkerInput label="D-Dimer" unit="μg/mL" optimal="<0.5" value={panel.dDimer} onChange={(v) => set("dDimer", v)} />
        <BiomarkerInput label="PT/INR" unit="ratio" optimal="0.9–1.1" value={panel.ptInr} onChange={(v) => set("ptInr", v)} />
        <BiomarkerInput label="vWF" unit="%" optimal="80–150" value={panel.vonWillebrandFactor} onChange={(v) => set("vonWillebrandFactor", v)} step={1} />
        <BiomarkerInput label="Nitric Oxide" unit="μmol/L" optimal="30–70" value={panel.nitricOxide} onChange={(v) => set("nitricOxide", v)} step={1} />
        <BiomarkerInput label="VEGF" unit="pg/mL" optimal="60–400" value={panel.vegf} onChange={(v) => set("vegf", v)} step={1} />
      </Section>

      {/* SECTION 20 — Advanced */}
      <Section title="20 · Advanced: Mitochondrial & Gut" count={7}
        filled={count(panel, ["adiponectin","resistin","gdf15","bdnf","fgf21","lpsBp","zonulin"])}>
        <BiomarkerInput label="Adiponectin" unit="μg/mL" optimal=">10" value={panel.adiponectin} onChange={(v) => set("adiponectin", v)} />
        <BiomarkerInput label="Resistin" unit="ng/mL" optimal="<5" value={panel.resistin} onChange={(v) => set("resistin", v)} />
        <BiomarkerInput label="GDF-15" unit="pg/mL" optimal="<300" value={panel.gdf15} onChange={(v) => set("gdf15", v)} step={1} />
        <BiomarkerInput label="BDNF" unit="ng/mL" optimal=">25" value={panel.bdnf} onChange={(v) => set("bdnf", v)} step={1} />
        <BiomarkerInput label="FGF-21" unit="pg/mL" optimal="<100" value={panel.fgf21} onChange={(v) => set("fgf21", v)} step={1} />
        <BiomarkerInput label="LPS Binding Protein" unit="μg/mL" optimal="5–15" value={panel.lpsBp} onChange={(v) => set("lpsBp", v)} />
        <BiomarkerInput label="Zonulin" unit="ng/mL" optimal="<30" value={panel.zonulin} onChange={(v) => set("zonulin", v)} step={1} />
      </Section>

      {/* ── Live score preview ────────────────────────────────────────── */}
      {totalFilled > 0 && (() => {
        const analysis = analyzeBloodwork(panel);
        const mod = analysis.recoveryModifier;
        return (
          <div className="bg-bg-card border border-bg-border rounded-2xl p-4">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Score Preview</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-text-primary">{analysis.score}<span className="text-sm text-text-muted font-normal">/100</span></p>
                <p className="text-xs text-text-muted mt-0.5">{analysis.markerCount} markers analyzed</p>
              </div>
              <div className={`text-right ${mod >= 0 ? "text-recovery-high" : "text-recovery-low"}`}>
                <p className="text-lg font-bold">{mod >= 0 ? "+" : ""}{mod} pts</p>
                <p className="text-xs opacity-70">daily modifier</p>
              </div>
            </div>
            {analysis.topConcerns.length > 0 && (
              <div className="mt-3 pt-3 border-t border-bg-border">
                <p className="text-2xs text-text-muted uppercase tracking-wider mb-1.5">Top concerns</p>
                {analysis.topConcerns.slice(0, 3).map((m) => (
                  <p key={m.key} className="text-xs text-recovery-low">• {m.label}: {m.value} {m.unit}</p>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Submit ────────────────────────────────────────────────────── */}
      <button
        onClick={handleSubmit}
        disabled={submitting || submitted || totalFilled === 0}
        className={`w-full py-4 rounded-2xl text-sm font-bold uppercase tracking-wider transition-all ${
          submitted
            ? "bg-recovery-high/20 text-recovery-high border border-recovery-high/40"
            : "bg-gold text-bg-primary hover:bg-gold-light active:scale-98"
        } disabled:opacity-40`}
      >
        {submitted ? "Lab Results Saved" : submitting ? "Saving..." : totalFilled > 0 ? `Save ${totalFilled} Lab Values` : "Enter Lab Values Above"}
      </button>
    </div>
  );
}

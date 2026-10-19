import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet, FileUp, LoaderCircle, Rows3, UploadCloud } from 'lucide-react';
import { getDataset, getDatasetPreview, getDatasetWarnings, getDatasets, uploadDataset, type Dataset, type PreviewRow } from '../lib/api';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_LABEL = '5 MB';

export function DatasetsPage() {
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { getDatasets().then(setDatasets).catch((reason: unknown) => setError(errorMessage(reason))); }, []);

  async function submitFile(file?: File) {
    if (!file) return;
    setError(''); setNotice('');
    if (!file.name.toLowerCase().endsWith('.csv') || (file.type && !['text/csv', 'application/vnd.ms-excel', 'application/csv', 'text/plain'].includes(file.type))) {
      setError('Choose a CSV file. The server will verify its contents before saving it.'); return;
    }
    if (file.size > MAX_UPLOAD_BYTES) { setError(`This file is larger than ${MAX_UPLOAD_LABEL}. Choose a smaller CSV.`); return; }
    if (file.size === 0) { setError('This file is empty. Choose a CSV with a header row and data.'); return; }
    setBusy(true); setProgress(0);
    try {
      const created = await uploadDataset(file, setProgress);
      setDatasets((current) => current ? [created, ...current] : [created]);
      setNotice(`${created.originalFileName ?? 'Your file'} is ready. ${created.parsedRowCount.toLocaleString()} rows parsed${created.rejectedRowCount ? `; ${created.rejectedRowCount} need review` : ''}.`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  return <>
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="mb-2 text-xs font-semibold tracking-[.12em] text-indigo-600">YOUR WORKSPACE</p><h1 className="text-3xl font-bold tracking-tight">Datasets</h1><p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Upload a CSV to inspect its columns, data quality, and source rows.</p></div>
      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600"><FileSpreadsheet size={14} /> Up to {MAX_UPLOAD_LABEL}</span>
    </div>
    <section className={`rounded-2xl border bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.025)] sm:p-7 ${dragging ? 'border-indigo-400 ring-4 ring-indigo-100' : 'border-slate-200/80'}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void submitFile(event.dataTransfer.files[0]); }}>
      <input ref={input} className="sr-only" type="file" accept=".csv,text/csv" aria-label="Choose a CSV file" onChange={(event) => { void submitFile(event.target.files?.[0]); event.target.value = ''; }} />
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-5 py-8 text-center sm:py-10">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><UploadCloud size={22} /></div>
        <h2 className="text-sm font-semibold">Drop a CSV file here</h2><p className="mt-1 text-xs text-slate-500">or browse your computer · maximum {MAX_UPLOAD_LABEL}</p>
        <button className="button-secondary mt-4" type="button" onClick={() => input.current?.click()} disabled={busy}><FileUp size={15} /> Choose CSV file</button>
        {busy && <div className="mt-5 w-full max-w-sm" aria-live="polite"><div className="mb-1.5 flex justify-between text-xs text-slate-500"><span>Uploading and profiling</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-indigo-600 transition-[width]" style={{ width: `${progress}%` }} /></div></div>}
      </div>
      {error && <p className="mt-4 flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</p>}
      {notice && <p className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{notice}</p>}
    </section>
    <section className="mt-8" aria-labelledby="dataset-list-heading">
      <div className="mb-3 flex items-center justify-between"><h2 id="dataset-list-heading" className="font-semibold">Your files</h2>{datasets && <span className="text-xs text-slate-400">{datasets.length} {datasets.length === 1 ? 'dataset' : 'datasets'}</span>}</div>
      {datasets === null && !error && <LoadingState text="Loading your datasets…" />}
      {error && datasets === null && <RetryState onRetry={() => { setError(''); getDatasets().then(setDatasets).catch((reason: unknown) => setError(errorMessage(reason))); }} />}
      {datasets?.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center"><Rows3 className="mx-auto mb-3 text-slate-400" size={24} /><h3 className="text-sm font-semibold">No datasets yet</h3><p className="mt-1 text-sm text-slate-500">Choose a CSV above to create your first dataset.</p></div>}
      {!!datasets?.length && <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">{datasets.map((dataset) => <Link key={dataset.id} to={`/datasets/${encodeURIComponent(dataset.id)}`} className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 last:border-0 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><span className="icon-tint tint-blue"><FileSpreadsheet size={17} /></span><div className="min-w-0"><p className="truncate text-sm font-semibold">{dataset.name}</p><p className="mt-1 truncate text-xs text-slate-500">{dataset.originalFileName} · {new Date(dataset.createdAt).toLocaleString()}</p></div></div><div className="flex items-center gap-4 pl-12 text-xs text-slate-500 sm:pl-0"><span>{dataset.parsedRowCount.toLocaleString()} rows</span><span>{dataset.columns.length} columns</span>{dataset.rejectedRowCount > 0 && <span className="text-amber-700">{dataset.rejectedRowCount} to review</span>}</div></Link>)}</div>}
    </section>
  </>;
}

export function DatasetDetailPage() {
  const { datasetId = '' } = useParams();
  const [state, setState] = useState<{ dataset: Dataset; preview: PreviewRow[]; warnings: { warnings: PreviewRow[]; total: number } } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([getDataset(datasetId), getDatasetPreview(datasetId), getDatasetWarnings(datasetId)])
      .then(([dataset, preview, warnings]) => { if (active) setState({ dataset, preview, warnings }); })
      .catch((reason: unknown) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [datasetId]);
  if (error) return <div><Link to="/datasets" className="mb-5 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-700"><ArrowLeft size={15} /> Datasets</Link><div className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700" role="alert">{error}</div></div>;
  if (!state) return <LoadingState text="Loading the data profile…" />;
  const { dataset, preview, warnings } = state;
  const displayValue = (row: PreviewRow, index: number) => Array.isArray(row.values) ? String(row.values[index] ?? '') : '';
  return <>
    <Link to="/datasets" className="mb-5 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-700"><ArrowLeft size={15} /> Datasets</Link>
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div className="min-w-0"><p className="mb-2 text-xs font-semibold tracking-[.12em] text-indigo-600">DATA PROFILE</p><h1 className="truncate text-3xl font-bold tracking-tight">{dataset.name}</h1><p className="mt-2 text-sm text-slate-500">{dataset.originalFileName} · uploaded {new Date(dataset.createdAt).toLocaleString()}</p></div><div className="flex gap-2 text-xs"><Metric value={dataset.parsedRowCount} label="parsed rows" /><Metric value={dataset.rejectedRowCount} label="rejected rows" /><Metric value={dataset.columns.length} label="columns" /></div></div>
    {dataset.rejectedRowCount > 0 && <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 shrink-0" size={17} /><p><strong>{dataset.rejectedRowCount} source {dataset.rejectedRowCount === 1 ? 'row needs' : 'rows need'} review.</strong> They remain preserved in the source preview and are not silently dropped.</p></div>}
    <section><h2 className="mb-3 font-semibold">Column profile</h2><div className="grid gap-3 md:grid-cols-2">{dataset.columns.map((column) => <article key={column.id} className="rounded-xl border border-slate-200/80 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{column.displayName}</h3><p className="mt-0.5 text-xs text-slate-400">Source header: {column.originalName || '(empty)'}</p></div><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold capitalize text-indigo-700">{column.type}</span></div><p className="mt-3 text-xs leading-5 text-slate-600">{column.rationale}</p><div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500"><span>{column.missingCount} missing</span><span>{column.invalidCount} invalid</span></div><p className="mt-2 truncate text-xs text-slate-400" title={column.samples.join(', ')}>Samples: {column.samples.length ? column.samples.join(' · ') : 'None'}</p></article>)}</div></section>
    <section className="mt-8" aria-labelledby="quality-heading"><div className="mb-3 flex items-center justify-between"><div><h2 id="quality-heading" className="font-semibold">Data quality</h2><p className="mt-1 text-xs text-slate-500">{warnings.total} row{warnings.total === 1 ? '' : 's'} with parsing or cell warnings · source records: {dataset.sourceRecordCount}, parsed: {dataset.parsedRowCount}, rejected: {dataset.rejectedRowCount}. No rows are excluded from calculation in this phase.</p></div></div>{warnings.total === 0 ? <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">No row-level data quality warnings.</div> : <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-amber-100 bg-amber-50/50 p-3">{warnings.warnings.map((row) => <div key={row.ordinal} className="rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-700"><span className="mr-2 font-semibold text-amber-800">Row {row.sourceRow} · line {row.sourceLine}</span>{Array.isArray(row.warnings) ? row.warnings.map(String).join(' ') : row.rejectionReason}</div>)}</div>}</section>
    <section className="mt-8" aria-labelledby="preview-heading"><div className="mb-3 flex items-end justify-between"><div><h2 id="preview-heading" className="font-semibold">Source preview</h2><p className="mt-1 text-xs text-slate-500">First {preview.length} of {dataset.sourceRecordCount} source records. Values are shown as plain text.</p></div></div><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-full border-collapse text-left text-xs"><thead className="bg-slate-50"><tr>{dataset.columns.map((column) => <th key={column.id} scope="col" className="whitespace-nowrap border-b border-slate-200 px-3 py-3 font-semibold text-slate-600">{column.displayName}</th>)}<th scope="col" className="whitespace-nowrap border-b border-slate-200 px-3 py-3 font-semibold text-slate-600">Source</th></tr></thead><tbody>{preview.map((row) => <tr key={row.ordinal} className="border-b border-slate-100 last:border-0">{dataset.columns.map((column, index) => <td key={column.id} className="max-w-[240px] truncate px-3 py-2.5 text-slate-700" title={displayValue(row, index)}>{displayValue(row, index) || <span className="italic text-slate-300">empty</span>}</td>)}<td className="whitespace-nowrap px-3 py-2.5 text-slate-400">{row.rejected ? 'Rejected' : `Line ${row.sourceLine}`}</td></tr>)}{preview.length === 0 && <tr><td colSpan={dataset.columns.length + 1} className="px-4 py-10 text-center text-slate-400">No source records.</td></tr>}</tbody></table></div></section>
  </>;
}

function Metric({ value, label }: { value: number; label: string }) { return <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center"><p className="text-base font-bold">{value.toLocaleString()}</p><p className="mt-0.5 whitespace-nowrap text-[10px] text-slate-500">{label}</p></div>; }
function LoadingState({ text }: { text: string }) { return <div className="flex min-h-40 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm text-slate-500" role="status"><LoaderCircle size={16} className="animate-spin" />{text}</div>; }
function RetryState({ onRetry }: { onRetry: () => void }) { return <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-4 text-sm text-rose-700" role="alert">Could not load your datasets. <button className="font-semibold underline" type="button" onClick={onRetry}>Try again</button></div>; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }


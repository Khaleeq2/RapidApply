export default function LaunchWaitingPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f8fd] px-6 text-[#0b1220]">
      <section className="w-full max-w-md rounded-2xl border border-blue-950/10 bg-white p-8 text-center shadow-xl shadow-blue-950/5">
        <div className="mx-auto mb-5 grid size-12 place-items-center rounded-xl bg-[#0a2472] text-lg font-black text-white">
          R
        </div>
        <h1 className="text-xl font-bold">Preparing your browser workspace</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          RapidApply is saving the campaign and issuing a one-time browser handoff.
          Keep this tab open for a moment.
        </p>
        <div className="mx-auto mt-6 h-1.5 w-40 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-blue-600" />
        </div>
      </section>
    </main>
  );
}

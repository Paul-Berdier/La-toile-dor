import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { requireUserWith } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  await requireUserWith(PERMISSIONS.AUDIT_READ);
  const { action } = await searchParams;

  const logs = await prisma.auditLog.findMany({
    where: action ? { action: { contains: action } } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { displayName: true } } },
  });

  return (
    <div>
      <form className="mb-4 flex gap-2" action="/admin/audit" method="get">
        <label htmlFor="audit-filter" className="sr-only">Filtrer par action</label>
        <input
          id="audit-filter"
          name="action"
          defaultValue={action ?? ""}
          placeholder="Filtrer : mission., invite., auth.…"
          className="w-64 border border-border-default bg-elevated px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-gold"
        />
        <button type="submit" className="border border-border-default px-3 py-1.5 text-xs text-ink-muted hover:border-border-gold hover:text-gold">
          Filtrer
        </button>
      </form>

      <div className="overflow-x-auto border border-border-default bg-raised">
        <table className="w-full min-w-[52rem] text-left text-xs">
          <caption className="sr-only">Journal d&rsquo;audit</caption>
          <thead>
            <tr className="border-b border-border-gold font-mono-toile text-[0.65rem] uppercase tracking-wider text-ink-faint">
              <th scope="col" className="px-3 py-2.5">Date</th>
              <th scope="col" className="px-3 py-2.5">Acteur</th>
              <th scope="col" className="px-3 py-2.5">Action</th>
              <th scope="col" className="px-3 py-2.5">Ressource</th>
              <th scope="col" className="px-3 py-2.5">Détails</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-border-default align-top hover:bg-hover-bg">
                <td className="whitespace-nowrap px-3 py-2 font-mono-toile text-ink-faint">
                  {log.createdAt.toLocaleString("fr-FR")}
                </td>
                <td className="px-3 py-2 text-ink-muted">{log.actor?.displayName ?? "—"}</td>
                <td className="px-3 py-2 font-mono-toile text-gold">{log.action}</td>
                <td className="px-3 py-2 text-ink-muted">
                  {log.resourceType ? `${log.resourceType}:${log.resourceId?.slice(0, 10) ?? ""}` : "—"}
                </td>
                <td className="max-w-md px-3 py-2 text-ink-faint">
                  {log.reason && <p className="italic">{log.reason}</p>}
                  {log.newValues != null && (
                    <code className="block truncate">{JSON.stringify(log.newValues)}</code>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

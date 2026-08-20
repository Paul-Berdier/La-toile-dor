"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { BoardCard, BoardData } from "@/server/missions";
import type { KanbanColumnKey } from "@toile/shared";
import { moveMissionAction } from "@/server/mission-actions";
import { MissionCard, MissionRow } from "./mission-card";
import { AssignmentModal } from "./assignment-modal";
import { Button } from "@/components/ui/button";

/** Statut cible lors d'un dépôt dans une colonne. */
const COLUMN_TARGET_STATUS: Record<KanbanColumnKey, string> = {
  a_prendre: "AVAILABLE",
  en_cours: "IN_PROGRESS",
  accomplies: "COMPLETED",
  echouees: "FAILED",
  annulees: "CANCELLED",
};

/** Changements critiques : confirmation + justification obligatoires. */
const CRITICAL_COLUMNS: KanbanColumnKey[] = ["accomplies", "echouees", "annulees"];

interface PendingMove {
  card: BoardCard;
  toColumn: KanbanColumnKey;
  toStatus: string;
}

export function MissionBoard({ board }: { board: BoardData }) {
  const router = useRouter();
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  // Passage « en cours » : la modale d'attribution multi-groupes s'ouvre AVANT
  const [assignCard, setAssignCard] = useState<BoardCard | null>(null);
  // Retour « À prendre » d'une mission attribuée : choix conserver/retirer
  const [releaseCard, setReleaseCard] = useState<BoardCard | null>(null);
  const [reason, setReason] = useState("");
  const [completionRyo, setCompletionRyo] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Vue : tableau (colonnes) ou liste. La liste est bien plus praticable sur
  // un écran étroit et pour chercher une mission parmi quarante ; le choix
  // vit dans l'URL, donc il se partage et survit à un rechargement.
  const pathname = usePathname();
  const params = useSearchParams();
  const urlView = params.get("vue");
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  // Par défaut : liste sur écran étroit, tableau ailleurs — sauf choix explicite
  const view: "board" | "list" = urlView === "liste" ? "list" : urlView === "tableau" ? "board" : narrow ? "list" : "board";
  const setView = (next: "board" | "list") => {
    const p = new URLSearchParams(params.toString());
    p.set("vue", next === "list" ? "liste" : "tableau");
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  // Les colonnes d'archive (accomplies, échouées, annulées) sont repliées :
  // l'action du jour est « à prendre » et « en cours ». MAIS dès qu'un filtre
  // ou une recherche est actif, tout se déplie : chercher un contrat et ne
  // pas le voir parce qu'il dort dans une bande fermée serait une trahison.
  const ARCHIVE_COLUMNS: KanbanColumnKey[] = ["accomplies", "echouees", "annulees"];
  const filtering = [...params.keys()].some((key) => key !== "vue");
  const [expanded, setExpanded] = useState<Set<KanbanColumnKey>>(new Set());
  const toggleColumn = (key: KanbanColumnKey) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const executeMove = (move: PendingMove, justification?: string) => {
    startTransition(async () => {
      const result = await moveMissionAction({
        missionId: move.card.view.id,
        toStatus: move.toStatus,
        reason: justification || undefined,
        awardedRyo: move.toStatus === "COMPLETED" ? completionRyo : undefined,
      });
      if (!result.ok) {
        setError(result.error ?? "Le déplacement a échoué.");
      } else {
        setError(null);
      }
      setPendingMove(null);
      setReason("");
      setCompletionRyo(0);
      router.refresh();
    });
  };

  const onDragStart = (event: DragStartEvent) => {
    const card = event.active.data.current?.card as BoardCard | undefined;
    setActiveCard(card ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const card = event.active.data.current?.card as BoardCard | undefined;
    setActiveCard(null);
    const overColumn = event.over?.id as KanbanColumnKey | undefined;
    if (!card || !overColumn || overColumn === card.column) return;

    // « En cours » : jamais de changement de statut sans équipe confirmée
    if (overColumn === "en_cours") {
      setAssignCard(card);
      return;
    }
    // Retour « À prendre » d'une mission possédant des groupes assignés
    if (overColumn === "a_prendre" && card.team) {
      setReleaseCard(card);
      return;
    }

    const move: PendingMove = {
      card,
      toColumn: overColumn,
      toStatus: COLUMN_TARGET_STATUS[overColumn],
    };
    if (CRITICAL_COLUMNS.includes(overColumn)) {
      if (overColumn === "accomplies") setCompletionRyo(card.view.rewardRyoMin);
      setPendingMove(move); // confirmation demandée
    } else {
      executeMove(move);
    }
  };

  const executeRelease = (card: BoardCard, release: boolean) => {
    startTransition(async () => {
      const result = await moveMissionAction({
        missionId: card.view.id,
        toStatus: "AVAILABLE",
        releaseAssignments: release,
      });
      if (!result.ok) setError(result.error ?? "Le déplacement a échoué.");
      else setError(null);
      setReleaseCard(null);
      router.refresh();
    });
  };

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 border border-blood bg-blood/10 px-4 py-2 text-sm text-blood-bright">
          {error}
        </p>
      )}

      {board.isModerator && board.drafts.length > 0 && (
        <section className="mb-5 border border-border-gold bg-raised p-3 sm:p-4" aria-label="Brouillons">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-xs tracking-[0.2em] text-gold uppercase">
                Brouillons
              </h2>
              <p className="mt-1 text-xs text-ink-faint">
                Visibles uniquement par la modération. Ouvrez un contrat pour le modifier ou le publier.
              </p>
            </div>
            <span className="font-mono-toile text-xs text-ink-muted">{board.drafts.length}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {board.drafts.map((card) => (
              <MissionCard key={card.view.id} card={card} />
            ))}
          </div>
        </section>
      )}

      {/* Bascule tableau / liste */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-faint">
          {board.columns.reduce((total, column) => total + column.cards.length, 0)} contrat
          {board.columns.reduce((total, column) => total + column.cards.length, 0) > 1 ? "s" : ""}
          {view === "board" && board.isModerator && " — glissez une carte pour changer son destin"}
        </p>
        <div role="group" aria-label="Affichage" className="flex">
          {([
            ["board", "Tableau"],
            ["list", "Liste"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={`border px-3 py-1 text-xs uppercase tracking-wider transition-colors ${
                view === key
                  ? "border-gold text-gold"
                  : "border-border-default text-ink-faint hover:border-border-gold hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "list" ? (
        <MissionListView board={board} />
      ) : (
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/* `min-w-0` : sans lui, les colonnes imposent leur largeur au parent
            et c'est la PAGE ENTIÈRE qui défile de côté — le scroll doit rester
            dans le tableau. Les dégradés de bord signalent qu'il continue. */}
        <div className="relative min-w-0">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-4 bg-gradient-to-r from-obsidian to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-obsidian to-transparent"
          />
          <div className="flex snap-x gap-3 overflow-x-auto pr-8 pb-4">
            {board.columns.map((column) => (
              <BoardColumn
                key={column.key}
                columnKey={column.key}
                label={column.label}
                cards={column.cards}
                draggable={board.isModerator}
                // Les colonnes d'archive commencent repliées : elles occupent
                // la moitié du tableau pour des missions déjà réglées.
                collapsed={
                  !filtering && ARCHIVE_COLUMNS.includes(column.key) && !expanded.has(column.key)
                }
                onToggle={() => toggleColumn(column.key)}
                collapsible={!filtering && ARCHIVE_COLUMNS.includes(column.key)}
              />
            ))}
          </div>
        </div>
        <DragOverlay>
          {activeCard ? (
            <div className="w-72">
              <MissionCard card={activeCard} dragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      )}

      {/* Modale d'attribution multi-groupes (passage « en cours ») */}
      {assignCard && (
        <AssignmentModal
          missionId={assignCard.view.id}
          missionCode={assignCard.view.code}
          missionRank={assignCard.view.rank}
          claims={assignCard.pendingClaims ?? []}
          assignments={assignCard.activeAssignments ?? []}
          catalog={board.groupsCatalog}
          eligibility={assignCard.assignmentEligibility}
          start
          onClose={() => setAssignCard(null)}
        />
      )}

      {/* Retour « À prendre » : conserver ou retirer les attributions */}
      {releaseCard && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Rouvrir la mission"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-obsidian/80 px-4"
        >
          <div className="w-full max-w-md border border-border-gold bg-raised p-6 shadow-modal">
            <h2 className="font-display text-base tracking-widest text-gold uppercase">
              Rouvrir {releaseCard.view.code}
            </h2>
            <p className="mt-3 text-sm text-ink-muted">
              La mission possède actuellement des groupes assignés ({releaseCard.team?.label}).
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={() => executeRelease(releaseCard, false)}
                disabled={isPending}
              >
                Conserver les attributions
              </Button>
              <Button
                variant="danger"
                onClick={() => executeRelease(releaseCard, true)}
                disabled={isPending}
              >
                Retirer les attributions et rouvrir la mission
              </Button>
              <Button variant="ghost" onClick={() => setReleaseCard(null)} disabled={isPending}>
                Annuler l&rsquo;opération
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation des changements critiques */}
      {pendingMove && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirmer le changement de statut"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-obsidian/80 px-4"
        >
          <div className="w-full max-w-md border border-border-gold bg-raised p-6 shadow-modal">
            <h2 className="font-display text-base tracking-widest text-gold uppercase">
              Sceller le destin de {pendingMove.card.view.code}
            </h2>
            <p className="mt-3 text-sm text-ink-muted">
              La mission « {pendingMove.card.view.publicTitle} » sera marquée{" "}
              <strong className="text-ink">
                {pendingMove.toColumn === "accomplies"
                  ? "accomplie"
                  : pendingMove.toColumn === "echouees"
                    ? "échouée"
                    : "annulée"}
              </strong>
              . L&rsquo;action sera consignée et notifiée.
            </p>
            {pendingMove.card.team && (
              <p className="mt-2 border border-border-default bg-elevated px-3 py-2 text-xs text-ink-muted">
                Équipe concernée : {pendingMove.card.team.label}
                {pendingMove.card.team.groupsCount > 1 &&
                  ` (effectif total : ${pendingMove.card.team.totalHeadcount})`}
              </p>
            )}
            {pendingMove.toColumn === "accomplies" && (
              <label className="mt-4 block text-xs text-ink-faint" htmlFor="completion-ryo">
                Ryō à partager entre les agents engagés
                <input
                  id="completion-ryo"
                  type="number"
                  min={pendingMove.card.view.rewardRyoMin}
                  max={pendingMove.card.view.rewardRyoMax}
                  value={completionRyo}
                  onChange={(event) => setCompletionRyo(Number(event.target.value))}
                  className="mt-1 w-full border border-border-default bg-elevated p-2 text-sm text-ink focus:border-gold"
                />
                <span className="mt-1 block text-[0.65rem] text-ink-faint">
                  Fourchette du contrat : {pendingMove.card.view.rewardRyoMin.toLocaleString("fr-FR")} à{" "}
                  {pendingMove.card.view.rewardRyoMax.toLocaleString("fr-FR")} ryō
                </span>
              </label>
            )}
            <label className="mt-4 block text-xs text-ink-faint" htmlFor="move-reason">
              {pendingMove.toColumn === "echouees"
                ? "Motif de l'échec (visible dans l'historique)"
                : pendingMove.toColumn === "annulees"
                  ? "Motif de l'annulation (visible dans l'historique)"
                  : "Justification (visible dans l'historique)"}
            </label>
            <textarea
              id="move-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 w-full border border-border-default bg-elevated p-2 text-sm text-ink focus:border-gold"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingMove(null)} disabled={isPending}>
                Renoncer
              </Button>
              <Button
                variant={pendingMove.toColumn === "accomplies" ? "gold" : "seal"}
                onClick={() => executeMove(pendingMove, reason)}
                disabled={
                  isPending ||
                  (pendingMove.toColumn === "accomplies" &&
                    (completionRyo < pendingMove.card.view.rewardRyoMin ||
                      completionRyo > pendingMove.card.view.rewardRyoMax))
                }
              >
                {isPending ? "Scellement…" : "Apposer le sceau"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BoardColumn({
  columnKey,
  label,
  cards,
  draggable,
  collapsed = false,
  collapsible = false,
  onToggle,
}: {
  columnKey: KanbanColumnKey;
  label: string;
  cards: BoardCard[];
  draggable: boolean;
  collapsed?: boolean;
  collapsible?: boolean;
  onToggle?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnKey, disabled: !draggable });

  // Repliée : une bande étroite qui reste une CIBLE DE DÉPÔT valable — on doit
  // pouvoir y glisser une mission sans la déplier d'abord.
  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        aria-label={`Colonne ${label}, repliée`}
        className={`flex w-12 shrink-0 flex-col items-center border bg-raised/60 transition-colors ${
          isOver ? "border-gold bg-raised" : "border-border-default"
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          className="flex h-full w-full flex-col items-center gap-3 py-3 text-ink-faint hover:text-gold"
          title={`Déplier « ${label} » (${cards.length})`}
        >
          <span className="font-mono-toile text-xs text-ink-muted">{cards.length}</span>
          <span
            className="font-display text-xs tracking-[0.2em] uppercase"
            style={{ writingMode: "vertical-rl" }}
          >
            {label}
          </span>
        </button>
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      aria-label={`Colonne ${label}`}
      // `flex-1` + `basis` : les colonnes ouvertes se partagent la largeur
      // disponible plutôt que de laisser un désert à droite ; au-delà de
      // quatre, elles retombent à leur largeur minimale et le tableau défile.
      className={`flex min-w-[16rem] flex-1 shrink-0 basis-[17rem] snap-start flex-col border bg-raised transition-colors ${
        isOver ? "border-gold" : "border-border-default"
      }`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border-gold px-3 py-2.5">
        <h2 className="font-display text-xs tracking-[0.2em] text-gold uppercase">{label}</h2>
        <span className="flex items-center gap-2">
          <span className="font-mono-toile text-xs text-ink-muted">{cards.length}</span>
          {collapsible && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded
              className="text-xs text-ink-faint hover:text-gold"
              title={`Replier « ${label} »`}
            >
              ✕
            </button>
          )}
        </span>
      </header>
      <div className="flex min-h-32 flex-1 flex-col gap-2 p-2">
        {cards.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-ink-faint italic">
            Aucun fil ne mène ici.
          </p>
        )}
        {cards.map((card) =>
          draggable ? (
            <DraggableCard key={card.view.id} card={card} />
          ) : (
            <MissionCard key={card.view.id} card={card} />
          ),
        )}
      </div>
    </section>
  );
}

/**
 * Vue LISTE — toutes les missions, groupées par colonne, en lignes denses.
 * Pas de glisser-déposer ici : on y vient pour lire et chercher, pas pour
 * déplacer. La colonne d'origine reste indiquée sur chaque ligne.
 */
function MissionListView({ board }: { board: BoardData }) {
  const groups = board.columns.filter((column) => column.cards.length > 0);
  if (groups.length === 0) {
    return (
      <p className="border border-border-default bg-raised p-8 text-center text-sm text-ink-faint italic">
        Aucun contrat ne correspond. La Toile garde ses fils.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {groups.map((column) => (
        <section key={column.key} aria-label={column.label}>
          <h2 className="mb-2 flex items-baseline gap-2 font-display text-xs tracking-[0.2em] text-gold uppercase">
            {column.label}
            <span className="font-mono-toile text-[0.7rem] text-ink-faint">{column.cards.length}</span>
          </h2>
          <ul className="space-y-1.5">
            {column.cards.map((card) => (
              <MissionRow key={card.view.id} card={card} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DraggableCard({ card }: { card: BoardCard }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.view.id,
    data: { card },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={isDragging ? "opacity-30" : undefined}
    >
      <MissionCard card={card} />
    </div>
  );
}

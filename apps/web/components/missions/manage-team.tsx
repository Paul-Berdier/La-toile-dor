"use client";

import { useState } from "react";
import { AssignmentModal, type GroupCatalogEntry } from "./assignment-modal";
import type {
  CardAssignmentInfo,
  CardClaimInfo,
  MissionEligibilityConfig,
} from "@/server/missions";
import { Button } from "@/components/ui/button";

/** Bouton modération : ouvre la modale d'attribution depuis le détail d'une mission. */
export function ManageTeamButton({
  missionId,
  missionCode,
  missionRank,
  claims,
  assignments,
  catalog,
  eligibility,
  canStart,
}: {
  missionId: string;
  missionCode: string;
  missionRank: string;
  claims: CardClaimInfo[];
  assignments: CardAssignmentInfo[];
  catalog: GroupCatalogEntry[];
  eligibility: MissionEligibilityConfig;
  /** true si la mission n'est pas encore « en cours » */
  canStart: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(canStart);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="gold" size="sm" onClick={() => { setStart(canStart); setOpen(true); }}>
          {assignments.length > 0 ? "Gérer l'équipe" : "Attribuer la mission"}
        </Button>
        {assignments.length > 0 && canStart && (
          <Button variant="outline" size="sm" onClick={() => { setStart(false); setOpen(true); }}>
            Modifier sans démarrer
          </Button>
        )}
      </div>
      {open && (
        <AssignmentModal
          missionId={missionId}
          missionCode={missionCode}
          missionRank={missionRank}
          claims={claims}
          assignments={assignments}
          catalog={catalog}
          eligibility={eligibility}
          start={start}
          enforceFinalCriteria={!canStart}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

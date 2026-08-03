import { redirect } from "next/navigation";

// La gestion des invitations vit désormais sur /invitations, accessible
// selon la hiérarchie (Tisseur, modérateurs, chefs de groupe).
export default function AdminInvitationsRedirect() {
  redirect("/invitations");
}

import { redirect } from "next/navigation";

// La racine mène toujours à la porte d'entrée ; la garde de session
// redirigera vers le tableau des missions si l'utilisateur est déjà admis.
export default function RootPage() {
  redirect("/connexion");
}

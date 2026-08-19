import { describe, expect, it } from "vitest";
import {
  accessOrigin,
  canAdministerCharacterProfile,
  canContributeToCharacterProfile,
  canCreateCharacterProfile,
  canEditCharacterProfile,
  canViewCharacterProfile,
  type ProfileAccessTarget,
  type ProfileAccessViewer,
} from "./profile-access";
import { PERMISSIONS } from "./permissions";

const viewer = (o: Partial<ProfileAccessViewer> = {}): ProfileAccessViewer => ({
  userId: "u",
  permissions: new Set(),
  groupIds: new Set(),
  ...o,
});
const moderator = viewer({
  permissions: new Set([PERMISSIONS.PROFILE_INTEL_VIEW, PERMISSIONS.PROFILE_MANAGE]),
});
const inA = viewer({ groupIds: new Set(["A"]) });
const inB = viewer({ groupIds: new Set(["B"]) });
const inAB = viewer({ groupIds: new Set(["A", "B"]) });

const dossier = (o: Partial<ProfileAccessTarget> = {}): ProfileAccessTarget => ({
  id: "p",
  createdByGroupId: null,
  grants: [],
  ...o,
});

describe("canViewCharacterProfile — l'accès appartient au groupe", () => {
  it("un membre sans aucun octroi ne voit pas", () => {
    expect(canViewCharacterProfile(inA, dossier())).toBe(false);
  });

  it("le groupe créateur voit son dossier", () => {
    expect(canViewCharacterProfile(inA, dossier({ createdByGroupId: "A" }))).toBe(true);
    expect(canViewCharacterProfile(inB, dossier({ createdByGroupId: "A" }))).toBe(false);
  });

  it("le groupe créateur voit MÊME sans octroi CREATED_BY_GROUP (données anciennes)", () => {
    // Le backfill peut ne pas avoir tourné : la colonne suffit.
    expect(
      canViewCharacterProfile(inA, dossier({ createdByGroupId: "A", grants: [] })),
    ).toBe(true);
  });

  it("un octroi actif ouvre l'accès à TOUT le groupe, pas au seul acheteur", () => {
    const d = dossier({ grants: [{ groupId: "B", sourceType: "PURCHASED", revokedAt: null }] });
    expect(canViewCharacterProfile(inB, d)).toBe(true);
    expect(canViewCharacterProfile(inA, d)).toBe(false);
  });

  it("un octroi révoqué ne compte plus", () => {
    const d = dossier({
      grants: [{ groupId: "B", sourceType: "PURCHASED", revokedAt: new Date("2026-01-01") }],
    });
    expect(canViewCharacterProfile(inB, d)).toBe(false);
  });

  it("quitter son groupe fait perdre l'accès : le viewer sans le groupe ne voit plus", () => {
    // Le même dossier, le même octroi ; seul le lecteur a changé de groupes.
    const d = dossier({ grants: [{ groupId: "A", sourceType: "PURCHASED", revokedAt: null }] });
    expect(canViewCharacterProfile(inA, d)).toBe(true);
    expect(canViewCharacterProfile(viewer({ groupIds: new Set() }), d)).toBe(false);
    // …et le groupe, lui, garde le dossier pour ses autres membres
    expect(canViewCharacterProfile(inAB, d)).toBe(true);
  });

  it("la modération voit tout, sans octroi", () => {
    expect(canViewCharacterProfile(moderator, dossier())).toBe(true);
  });

  it("la cible d'une mission EN COURS de son groupe se lit sans achat, le temps de la mission", () => {
    // Le lecteur a été chargé avec les dossiers cibles des missions attribuées
    // à ses groupes : le dossier « p » en fait partie.
    const onMission = viewer({ groupIds: new Set(["A"]), missionTargetProfileIds: new Set(["p"]) });
    expect(canViewCharacterProfile(onMission, dossier())).toBe(true);
    // Un autre dossier, non visé, reste scellé
    expect(canViewCharacterProfile(onMission, dossier({ id: "autre" }))).toBe(false);
    // L'attribution retirée (plus de cible dans l'ensemble) : l'accès disparaît
    expect(canViewCharacterProfile(viewer({ groupIds: new Set(["A"]) }), dossier())).toBe(false);
  });

  it("la cible de mission donne à lire et à contribuer, jamais à modifier la source", () => {
    const onMission = viewer({ groupIds: new Set(["A"]), missionTargetProfileIds: new Set(["p"]) });
    expect(canContributeToCharacterProfile(onMission, dossier())).toBe(true);
    expect(canEditCharacterProfile(onMission, dossier())).toBe(false);
  });
});

describe("accessOrigin — le lecteur sait pourquoi il voit", () => {
  it("créé par son groupe prime sur tout", () => {
    const d = dossier({
      createdByGroupId: "A",
      grants: [{ groupId: "A", sourceType: "PURCHASED", revokedAt: null }],
    });
    expect(accessOrigin(inA, d)).toBe("CREATED_BY_GROUP");
  });

  it("acquis quand acheté", () => {
    const d = dossier({ grants: [{ groupId: "A", sourceType: "PURCHASED", revokedAt: null }] });
    expect(accessOrigin(inA, d)).toBe("PURCHASED");
  });

  it("gagné en mission est distinct d'un achat", () => {
    const d = dossier({ grants: [{ groupId: "A", sourceType: "MISSION_GRANTED", revokedAt: null }] });
    expect(accessOrigin(inA, d)).toBe("MISSION_GRANTED");
  });

  it("cible de mission en cours : origine provisoire, après tout octroi écrit", () => {
    const onMission = viewer({ groupIds: new Set(["A"]), missionTargetProfileIds: new Set(["p"]) });
    expect(accessOrigin(onMission, dossier())).toBe("MISSION_TARGET");
    // Un octroi écrit (achat) prime sur l'accès provisoire de mission
    const bought = dossier({ grants: [{ groupId: "A", sourceType: "PURCHASED", revokedAt: null }] });
    expect(accessOrigin(onMission, bought)).toBe("PURCHASED");
  });

  it("null sans accès, et null pour la modération qui voit par fonction", () => {
    expect(accessOrigin(inA, dossier())).toBeNull();
    expect(accessOrigin(moderator, dossier())).toBeNull();
  });
});

describe("canEditCharacterProfile — acheter ne donne pas la plume", () => {
  it("le groupe créateur modifie", () => {
    expect(canEditCharacterProfile(inA, dossier({ createdByGroupId: "A" }))).toBe(true);
  });

  it("un acheteur lit mais ne modifie pas", () => {
    const d = dossier({
      createdByGroupId: "A",
      grants: [{ groupId: "B", sourceType: "PURCHASED", revokedAt: null }],
    });
    expect(canViewCharacterProfile(inB, d)).toBe(true);
    expect(canEditCharacterProfile(inB, d)).toBe(false);
  });

  it("…mais il peut CONTRIBUER : le renseignement de mission ne se garde pas pour soi", () => {
    const d = dossier({
      createdByGroupId: "A",
      grants: [{ groupId: "B", sourceType: "PURCHASED", revokedAt: null }],
    });
    expect(canContributeToCharacterProfile(inB, d)).toBe(true);
    // Sans accès du tout, on ne contribue pas non plus
    expect(canContributeToCharacterProfile(viewer({ groupIds: new Set(["C"]) }), d)).toBe(false);
  });

  it("un dossier archivé ne se modifie plus, même par son créateur", () => {
    expect(
      canEditCharacterProfile(inA, dossier({ createdByGroupId: "A", archivedAt: new Date() })),
    ).toBe(false);
  });

  it("la modération modifie tout", () => {
    expect(canEditCharacterProfile(moderator, dossier())).toBe(true);
  });
});

describe("canAdministerCharacterProfile — supprimer et fusionner restent à la modération", () => {
  it("le groupe créateur n'administre pas", () => {
    expect(canAdministerCharacterProfile(inA)).toBe(false);
  });
  it("la modération administre", () => {
    expect(canAdministerCharacterProfile(moderator)).toBe(true);
  });
});

describe("canCreateCharacterProfile — tout membre de groupe peut ouvrir un dossier", () => {
  it("un agent d'un groupe crée", () => {
    expect(canCreateCharacterProfile(inA)).toBe(true);
  });
  it("sans groupe, on ne crée pas — le dossier n'aurait pas de propriétaire", () => {
    expect(canCreateCharacterProfile(viewer())).toBe(false);
  });
  it("la modération crée toujours", () => {
    expect(canCreateCharacterProfile(moderator)).toBe(true);
  });
});

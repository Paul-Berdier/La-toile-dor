import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from "./permissions";

describe("permissions de gestion des missions", () => {
  it.each(["super_admin", "moderator"] as const)(
    "%s peut créer, modifier et retirer une mission",
    (role) => {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toEqual(
        expect.arrayContaining([
          PERMISSIONS.MISSION_CREATE,
          PERMISSIONS.MISSION_UPDATE,
          PERMISSIONS.MISSION_CANCEL,
        ]),
      );
    },
  );

  it("réserve la gestion des appartenances utilisateurs au super administrateur", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.super_admin).toContain(PERMISSIONS.USER_MANAGE);
    expect(DEFAULT_ROLE_PERMISSIONS.moderator).not.toContain(PERMISSIONS.USER_MANAGE);
  });

  it("utilise uniquement les rôles de groupe, sans rôle de faction", () => {
    expect(Object.keys(DEFAULT_ROLE_PERMISSIONS).sort()).toEqual(
      ["group_leader", "group_member", "moderator", "super_admin"],
    );
    expect(DEFAULT_ROLE_PERMISSIONS.group_leader).toContain(PERMISSIONS.MISSION_CLAIM);
    expect(DEFAULT_ROLE_PERMISSIONS.group_leader).not.toContain(PERMISSIONS.MISSION_CREATE);
  });

  it("autorise la modération à créer des missions et des groupes", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.moderator).toEqual(
      expect.arrayContaining([
        PERMISSIONS.MISSION_CREATE,
        PERMISSIONS.GROUP_CREATE,
        PERMISSIONS.GROUP_EDIT_ANY,
      ]),
    );
  });
});

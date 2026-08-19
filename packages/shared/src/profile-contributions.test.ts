import { describe, expect, it } from "vitest";
import {
  CONTRIBUTABLE_FIELD_KEYS,
  CONTRIBUTION_VALUE_SCHEMAS,
  LIST_FIELD_KEYS,
  TEXT_FIELD_KEYS,
  canMergeField,
  intelContributionSchema,
} from "./profile-contributions";
import { PROFILE_FIELD_KEYS } from "./profile-fields";

const PROFILE = "clzzzzzzzzzzzzzzzzzzzzzzz";
const OPT = "clyyyyyyyyyyyyyyyyyyyyyyy";
const OPT2 = "clxxxxxxxxxxxxxxxxxxxxxxx";

describe("contributions — quels champs, quelles formes", () => {
  it("tout champ de dossier sauf l'image reçoit une contribution", () => {
    // L'image passe par la galerie ; tout le reste doit pouvoir être proposé,
    // sinon un groupe qui apprend quelque chose n'a aucun moyen de le dire.
    const expected = PROFILE_FIELD_KEYS.filter((k) => k !== "image");
    expect([...CONTRIBUTABLE_FIELD_KEYS].sort()).toEqual([...expected].sort());
  });

  it("chaque champ liste ou texte a une forme, et seuls eux se fusionnent", () => {
    for (const key of [...LIST_FIELD_KEYS, ...TEXT_FIELD_KEYS]) {
      expect(CONTRIBUTION_VALUE_SCHEMAS[key], key).toBeDefined();
      expect(canMergeField(key), key).toBe(true);
    }
    expect(canMergeField("faction")).toBe(false);
    expect(canMergeField("lastName")).toBe(false);
  });

  it("valide la valeur selon le champ", () => {
    const ok = intelContributionSchema.safeParse({ profileId: PROFILE, fieldKey: "faction", value: OPT });
    expect(ok.success).toBe(true);
    const bad = intelContributionSchema.safeParse({ profileId: PROFILE, fieldKey: "faction", value: "Konoha" });
    expect(bad.success).toBe(false);
    const list = intelContributionSchema.safeParse({ profileId: PROFILE, fieldKey: "clans", value: [OPT, OPT2] });
    expect(list.success).toBe(true);
    const emptyList = intelContributionSchema.safeParse({ profileId: PROFILE, fieldKey: "clans", value: [] });
    expect(emptyList.success).toBe(false);
  });

  it("refuse une contribution sur l'image", () => {
    const res = intelContributionSchema.safeParse({ profileId: PROFILE, fieldKey: "image", value: true });
    expect(res.success).toBe(false);
  });

  it("« absence confirmée » ne demande pas de valeur", () => {
    const res = intelContributionSchema.safeParse({
      profileId: PROFILE,
      fieldKey: "kekkeiGenkai",
      knowledgeState: "NONE_CONFIRMED",
    });
    expect(res.success).toBe(true);
  });

  it("hétérochromie : deux fois la même couleur est refusée", () => {
    const same = intelContributionSchema.safeParse({
      profileId: PROFILE, fieldKey: "eyeColor", value: { primaryId: OPT, secondaryId: OPT },
    });
    expect(same.success).toBe(false);
    const two = intelContributionSchema.safeParse({
      profileId: PROFILE, fieldKey: "eyeColor", value: { primaryId: OPT, secondaryId: OPT2 },
    });
    expect(two.success).toBe(true);
  });

  it("taille : au moins une borne, dans l'ordre", () => {
    expect(intelContributionSchema.safeParse({ profileId: PROFILE, fieldKey: "height", value: { minCm: null, maxCm: null } }).success).toBe(false);
    expect(intelContributionSchema.safeParse({ profileId: PROFILE, fieldKey: "height", value: { minCm: 190, maxCm: 180 } }).success).toBe(false);
    expect(intelContributionSchema.safeParse({ profileId: PROFILE, fieldKey: "height", value: { minCm: 180, maxCm: null } }).success).toBe(true);
  });
});

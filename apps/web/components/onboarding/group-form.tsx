"use client";

import { useState, useTransition } from "react";
import { MISSION_CATEGORIES } from "@toile/shared";
import { createOnboardingGroupAction } from "@/server/onboarding-actions";
import { Button } from "@/components/ui/button";

const input =
  "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold";
const label = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";

/** Formulaire de groupe réutilisé par l'onboarding (création) et l'édition. */
export function GroupFields({
  values,
  onChange,
}: {
  values: { name: string; primaryCountry: string; primaryVillage: string; specialties: string[] };
  onChange: (values: GroupFieldsValues) => void;
}) {
  const set = (patch: Partial<GroupFieldsValues>) => onChange({ ...values, ...patch });
  const toggleSpecialty = (value: string) =>
    set({
      specialties: values.specialties.includes(value)
        ? values.specialties.filter((s) => s !== value)
        : [...values.specialties, value],
    });

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="grp-name" className={label}>Nom du groupe *</label>
        <input id="grp-name" value={values.name} maxLength={80} required
          onChange={(e) => set({ name: e.target.value })} className={input}
          placeholder="ex. Les Crocs de Fer" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="grp-country" className={label}>Pays principal de résidence</label>
          <input id="grp-country" value={values.primaryCountry} maxLength={80}
            onChange={(e) => set({ primaryCountry: e.target.value })} className={input}
            placeholder="ex. Pays de la Foudre" />
        </div>
        <div>
          <label htmlFor="grp-village" className={label}>Village principal de résidence</label>
          <input id="grp-village" value={values.primaryVillage} maxLength={80}
            onChange={(e) => set({ primaryVillage: e.target.value })} className={input}
            placeholder="ex. Kumogakure" />
        </div>
      </div>
      <fieldset>
        <legend className={label}>Spécialités</legend>
        <div className="flex flex-wrap gap-1.5">
          {MISSION_CATEGORIES.map((category) => (
            <button
              key={category.value}
              type="button"
              onClick={() => toggleSpecialty(category.value)}
              aria-pressed={values.specialties.includes(category.value)}
              className={`border px-2 py-1 text-[0.7rem] transition-colors ${
                values.specialties.includes(category.value)
                  ? "border-gold bg-gold-faint/40 text-gold"
                  : "border-border-default text-ink-muted hover:border-border-gold hover:text-ink"
              }`}
            >
              {category.label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export type GroupFieldsValues = {
  name: string;
  primaryCountry: string;
  primaryVillage: string;
  specialties: string[];
};

export function OnboardingGroupForm() {
  const [values, setValues] = useState<GroupFieldsValues>({
    name: "",
    primaryCountry: "",
    primaryVillage: "",
    specialties: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (isPending) return;
    startTransition(async () => {
      const res = await createOnboardingGroupAction(values);
      // En cas de succès l'action redirige vers /missions
      if (res && !res.ok) setError(res.error ?? "La création a échoué.");
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
      noValidate
    >
      <GroupFields values={values} onChange={setValues} />
      {error && (
        <p role="alert" className="border border-blood bg-blood/10 px-3 py-2 text-xs text-blood-bright">
          {error}
        </p>
      )}
      <Button type="submit" variant="gold" size="lg" className="w-full"
        disabled={isPending || values.name.trim().length < 2}>
        {isPending ? "Tissage du groupe…" : "Fonder mon groupe"}
      </Button>
    </form>
  );
}

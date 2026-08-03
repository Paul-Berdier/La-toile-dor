export interface WeightedRecipient {
  key: string;
  weight: number;
}

/**
 * Répartit un entier sans en créer ni en perdre. Les restes sont attribués
 * selon la plus forte fraction, puis par clé pour rendre le résultat stable.
 */
export function shareInteger(
  total: number,
  recipients: readonly WeightedRecipient[],
): Map<string, number> {
  if (!Number.isSafeInteger(total)) throw new Error("Le total doit être un entier sûr.");
  if (recipients.length === 0) return new Map();
  if (new Set(recipients.map((recipient) => recipient.key)).size !== recipients.length) {
    throw new Error("Chaque destinataire doit être unique.");
  }
  if (recipients.some((recipient) => !Number.isSafeInteger(recipient.weight) || recipient.weight <= 0)) {
    throw new Error("Chaque poids doit être un entier strictement positif.");
  }

  const sign = total < 0 ? -1 : 1;
  const absoluteTotal = Math.abs(total);
  const weightTotal = recipients.reduce((sum, recipient) => sum + recipient.weight, 0);
  const shares = recipients.map((recipient) => {
    const exact = (absoluteTotal * recipient.weight) / weightTotal;
    const base = Math.floor(exact);
    return { ...recipient, base, fraction: exact - base };
  });
  let remainder = absoluteTotal - shares.reduce((sum, share) => sum + share.base, 0);
  const remainderOrder = [...shares].sort(
    (a, b) => b.fraction - a.fraction || a.key.localeCompare(b.key),
  );
  for (let index = 0; index < remainder; index += 1) {
    remainderOrder[index % remainderOrder.length]!.base += 1;
  }

  return new Map(shares.map((share) => [share.key, share.base * sign]));
}

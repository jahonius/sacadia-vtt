/**
 * Update operators for free-form object fields (`ObjectField`: focusRounds, marks, hitsByTarget, focusTargets, a
 * condition's source, flags). Foundry merges an update into such a field, so writing `{}` or a trimmed copy removes
 * nothing: a whole new value has to be marked as a replacement, and a key removed with a deletion. These are the v14
 * operators; the legacy `-=key` / `==key` syntax is deprecated. Touches Foundry only when called.
 */

/** Replace an object field's whole value (keys missing from `value` are removed). */
export const replaceWith = (value) => foundry.data.operators.ForcedReplacement.create(value);

/** Remove one key: `{ 'flags.sacadia.rage': deleteKey() }`. */
export const deleteKey = () => new foundry.data.operators.ForcedDeletion();

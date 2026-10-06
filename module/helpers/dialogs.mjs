/**
 * The system's prompts: Foundry's DialogV2, in the sheet's skin (the `sacadia-dialog` class, styled in
 * src/scss/global/_dialogs.scss) and sized to their content rather than Foundry's default. Called through
 * `foundry.applications.api.DialogV2` at call time, so anything that swaps that out (the in-Foundry tests' stubs) still
 * sees every prompt.
 */
const skin = (options = {}) => ({
  ...options,
  classes: [...(options.classes ?? []), 'sacadia-dialog'],
  position: { width: 380, ...(options.position ?? {}) },
});

export const sacDialog = {
  /** DialogV2.wait in the system's skin. */
  wait: (options) => foundry.applications.api.DialogV2.wait(skin(options)),
  /** DialogV2.confirm in the system's skin. */
  confirm: (options) => foundry.applications.api.DialogV2.confirm(skin(options)),
};

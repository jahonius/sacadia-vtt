/**
 * The Long Rest window (rulebook v1.2 printed pp.235, 263–266): how many weeks of downtime, and the Long Rest Action each
 * week, with what each needs (where the money comes from, the group, the offering, what to train away …) and the limits the
 * book sets. Taking the rest resolves it (rules/downtime.mjs): one card with every week, then the Fitful Rest it ends with.
 */
import { LONG_REST_ACTIONS, weekLimits, offeringAdvantage } from '../helpers/downtime.mjs';
import { downtimeOptions, takeLongRest } from '../rules/downtime.mjs';
import { sacDialog } from '../helpers/dialogs.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = (k) => game.i18n.localize(k);
const fmt = (k, d) => game.i18n.format(k, d);

/** A week's plan: its action and what that action needs. */
const blankWeek = (kind = 'earn') => ({ kind, earn: 'odd', amount: 0, group: '', offeringItem: '', gold: 0, religion: '', text: '', train: '' });

export class LongRest extends HandlebarsApplicationMixin(ApplicationV2) {
  static #open = new Map();

  /** Open the window for a character (one each). */
  static open(actor) {
    if (!actor?.isOwner) return null;
    const app = this.#open.get(actor.uuid) ?? new this({ actor });
    this.#open.set(actor.uuid, app);
    return app.render({ force: true });
  }

  constructor({ actor, ...options } = {}) {
    super({ id: `sacadia-long-rest-${actor.uuid.replace(/\./g, '-')}`, ...options });
    this.actor = actor;
    this.plan = { weeks: [blankWeek()] };
  }

  static DEFAULT_OPTIONS = {
    classes: ['sacadia-dialog', 'sacadia-long-rest'],
    tag: 'form',
    window: { icon: 'fa-solid fa-campground', resizable: true },
    position: { width: 620, height: 'auto' },
    form: { handler: LongRest.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      addWeek: LongRest.#onAddWeek,
      removeWeek: LongRest.#onRemoveWeek,
      takeRest: LongRest.#onTakeRest,
    },
  };

  static PARTS = { rest: { template: 'systems/sacadia/templates/apps/long-rest.hbs' } };

  get title() { return fmt('SACADIA.Downtime.Title', { name: this.actor.name }); }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const opts = downtimeOptions(actor);
    const prof = actor.system.proficiency ?? 0;
    const limits = weekLimits(this.plan.weeks, { proficiency: prof });
    const offeringWeeks = this.plan.weeks.filter((w) => w.kind === 'offering').length;
    const asChoices = (list) => Object.fromEntries(list.map((o) => [o.value, o.label]));
    context.kinds = Object.fromEntries(Object.entries(LONG_REST_ACTIONS).map(([k, d]) => [k, d.label]));
    context.weeks = this.plan.weeks.map((w, i) => {
      const lim = limits[i];
      const def = LONG_REST_ACTIONS[w.kind] ?? {};
      const max = def.max === 'proficiency' ? prof : def.max;
      const note = !lim.counts ? fmt('SACADIA.Downtime.OverLimit', { max })
        : lim.reason === 'pooled' ? loc('SACADIA.Downtime.Pooled')
          : w.kind === 'offering' ? fmt('SACADIA.Downtime.OfferingPreview', { adv: offeringAdvantage({ religionRank: w.religion !== '' ? (actor.system.specialties?.[Number(w.religion)]?.rank ?? 0) : 0, gold: w.gold, weeks: offeringWeeks }) })
            : '';
      const source = opts.earn.find((e) => e.value === w.earn);
      return { ...w, index: i, n: i + 1, note, warn: !lim.counts, page: def.page,
        [`is_${w.kind}`]: true, manualEarn: w.kind === 'earn' && source?.amount == null && !!source };
    });
    context.earn = asChoices(opts.earn);
    context.religion = asChoices(opts.religion);
    context.offerings = asChoices(opts.offerings);
    context.train = asChoices(opts.train);
    context.groups = opts.groups;
    context.listId = `${this.id}-groups`;
    context.money = actor.system.money ?? { gc: 0, sc: 0 };
    context.proficiency = prof;
    return context;
  }

  /** Every change to the form updates the plan. */
  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const weeks = data.weeks ? Object.keys(data.weeks).sort((a, b) => Number(a) - Number(b)).map((k) => ({ ...blankWeek(), ...this.plan.weeks[Number(k)], ...data.weeks[k] })) : [];
    // A week whose action changed starts clean (keeping only the action).
    this.plan.weeks = weeks.map((w, i) => (w.kind !== this.plan.weeks[i]?.kind ? blankWeek(w.kind) : w));
    this.render();
  }

  static #onAddWeek() {
    this.plan.weeks.push(blankWeek(this.plan.weeks.at(-1)?.kind ?? 'earn'));
    this.render();
  }

  static #onRemoveWeek(event, target) {
    if (this.plan.weeks.length <= 1) return;
    this.plan.weeks.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static async #onTakeRest() {
    const n = this.plan.weeks.length;
    const ok = await sacDialog.confirm({ window: { title: loc('SACADIA.Downtime.TakeTitle') }, rejectClose: false,
      content: `<p>${fmt('SACADIA.Downtime.TakeConfirm', { name: foundry.utils.escapeHTML(this.actor.name), n })}</p>` });
    if (!ok) return;
    await takeLongRest(this.actor, this.plan);
    this.plan = { weeks: [blankWeek()] };
    await this.close();
  }

  async _onClose(options) {
    await super._onClose(options);
    LongRest.#open.delete(this.actor.uuid);
  }
}

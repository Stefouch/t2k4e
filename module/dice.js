import T2KDialog from './dialog.js';
import { YearZeroRoll } from '../lib/yzur.js';
import { T2K4E } from './config.js';

/* -------------------------------------------- */
/*  Custom Dice Roller Interface                */
/* -------------------------------------------- */

/**
 * Interface for performing tasks and rolling dice.
 * @abstract
 * @interface
 */
export class T2KRoller {
  constructor() {
    throw new SyntaxError(`${this.constructor.name} cannot be instanciated. Use static methods instead.`);
  }

  /* -------------------------------------------- */

  /**
   * Rolls dice for T2K.
   * @param {string?}  title                The title of the roll
   * @param {Actor?}   actor                The actor who rolled the dice, if any
   * @param {Item?}    item                 The item used to roll the dice, if any
   * @param {number}  [attribute=0]         The attribute's size
   * @param {number}  [skill=0]             The skill's size
   * @param {number}  [rof=0]               The RoF's value
   * @param {number}  [modifier=0]          The task modifier
   * @param {boolean} [locate=false]        Whether to roll a Location die
   * @param {number}  [maxPush=1]           The maximum number of pushes (default is 1)
   * @param {string?}  rollMode             Dice roll visibility mode @see DICE_ROLL_MODES
   * @param {boolean} [askForOptions=false] Whether to show a Dialog for roll options
   * @param {boolean} [skipDialog=false]    Whether to force skip the Dialog for roll options
   * @param {boolean} [sendMessage=true]    Whether the message should be sent
   * @returns {Promise<YearZeroRoll|ChatMessage>} If sendMessage=true, returns the ChatMessage,
   *      otherwise returns the YearZeroRoll.
   * @static
   * @async
   */
  static async taskCheck({
    title = 'Twilight 2000 4E – Task Check',
    actor = null,
    item = null,
    attribute = 0,
    skill = 0,
    rof = 0,
    modifier = 0,
    locate = false,
    maxPush = 1,
    rollMode = null,
    askForOptions = false,
    skipDialog = false,
    sendMessage = true,
  } = {}) {
    // 1 — Prepares data.
    rollMode = rollMode ?? game.settings.get('core', 'rollMode');

    // 2 — Checks if we ask for options (roll dialog).
    const showTaskCheckOptions = game.settings.get('t2k4e', 'showTaskCheckOptions');
    if (!skipDialog && askForOptions !== showTaskCheckOptions) {
      // 2.1 — Prepares a formula.
      const formula = YearZeroRoll.createFromDiceQuantities(
        getDiceQuantities(attribute, skill),
      ).formula;

      // 2.2 — Renders the dialog.
      const opts = await T2KDialog.askRollOptions({
        title, attribute, skill, rof, modifier, locate,
        maxPush, rollMode, formula,
      });

      // 2.2.5 — Exits early if the dialog was cancelled.
      if (opts.cancelled) return null;

      // 2.3 — Uses options from the roll dialog.
      if (!attribute && !skill) {
        attribute = opts.attribute;
        skill = opts.skill;
      }
      rof = opts.rof;
      modifier = opts.modifier;
      locate = opts.locate;
      maxPush = opts.maxPush;
      rollMode = opts.rollMode;
    }
    // 3 — Clamps values.
    attribute = Math.clamped(attribute, 0, 12);
    skill = Math.clamped(skill, 0, 12);
    modifier = Math.clamped(modifier, -100, 100);
    maxPush = Math.clamped(maxPush, 0, 100);

    // 4 — Creates the roll.
    const dice = getDiceQuantities(attribute, skill, rof, locate);
    let roll = YearZeroRoll.createFromDiceQuantities(dice, { maxPush });
    roll.name = title;

    // 5 — Modifies the roll.
    if (modifier) {
      roll = roll.modify(modifier);
    }

    // 6 — Evaluates the roll.
    await roll.roll({ async: true });
    console.log('t2k4e | ROLL', roll.name, roll);

    // 7 — Sends the message and returns.
    if (sendMessage) {
      return roll.toMessage(null, { rollMode });
    }
    return roll;
  }

  /* -------------------------------------------- */

  /**
   * Rolls dice for a Coolness Under Fire test.
   * @returns {Promise<YearZeroRoll|ChatMessage>}
   */
  static async cufCheck({
    title = game.i18n.localize('T2K4E.Dialog.CuF.CoolnessUnderFire'),
    actor = null,
    unitMorale = false,
    modifier = 0,
    maxPush = 1,
    rollMode = null,
    sendMessage = true,
  } = {}) {
    if (!actor) return;
    rollMode = rollMode ?? game.settings.get('core', 'rollMode');
    const opts = await T2KDialog.askCuFOptions({ title, unitMorale, modifier, maxPush, rollMode });

    // Exits early if the dialog was cancelled.
    if (opts.cancelled) return null;

    // Uses options from the CuF dialog.
    unitMorale = opts.unitMorale;
    rollMode = opts.rollMode;

    // Gets attributes' values.
    const cuf = actor.data.data.cuf.value;
    const um = actor.data.data.unitMorale.value;

    return this.taskCheck({
      title,
      attribute: cuf,
      skill: unitMorale ? um : 0,
      modifier, maxPush, rollMode,
      skipDialog: true,
      sendMessage,
    });

  }
}

/* -------------------------------------------- */
/*  Roll Push                                   */
/* -------------------------------------------- */

/**
 * Pushes a roll.
 * @param {YearZeroRoll} roll    The roll to push
 * @param {ChatMessage?} message The message holding the roll that will be deleted
 * @returns {Promise<YearZeroRoll|ChatMessage>}
 * @async
 */
export async function rollPush(roll, message) {
  if (!roll.pushable) return roll;

  // Copies the roll.
  roll = roll.duplicate();

  // Pushes the roll.
  await roll.push({ async: true });

  // Returns the pushed roll if there is no message.
  if (!message) return roll.toMessage();

  // Gets all the message's flags.
  const flags = message.getFlag('t2k4e', 'data') ?? {};
  const oldAmmoSpent = flags.ammoSpent || 0;
  let newAmmoSpent = -Math.max(1, roll.ammoSpent);
  const actorId = flags.actor;
  const actor = game.actors.get(actorId);
  const ammoId = flags.ammo;
  const ammo = actor ? actor.items.get(ammoId) : game.items.get(ammoId);
  const itemId = flags.item;
  const item = actor ? actor.items.get(itemId) : game.items.get(itemId);

  // No need to await the deletion.
  message.delete();

  const m = await roll.toMessage();

  const flagData = {};

  // Updates the ammunition.
  if (ammo) {
    flagData.ammoSpent = oldAmmoSpent;

    if (oldAmmoSpent !== newAmmoSpent) {
      newAmmoSpent = await ammo.updateAmmo(newAmmoSpent - oldAmmoSpent);
      flagData.ammoSpent = oldAmmoSpent + newAmmoSpent;
    }
    flagData.ammo = ammo.id;
    // await m.setFlag('t2k4e', 'ammoSpent', -roll.ammoSpent);
    // await m.setFlag('t2k4e', 'ammo', ammo.id);
  }

  // Stores the referenced IDs.
  if (actor) flagData.actor = actor.id;
  if (item) flagData.item = item.id;
  // if (actor) await m.setFlag('t2k4e', 'actor', actor.id);
  // if (item) await m.setFlag('t2k4e', 'item', item.id);
  await m.setFlag('t2k4e', 'data', flagData);

  return m;
}

/* -------------------------------------------- */
/*  Dice Utility Functions                      */
/* -------------------------------------------- */
/**
 * Gets the size of a die from its rating.
 * @param {string} score A, B, C, D or F
 */
export function getDieSize(score) {
  if (typeof score !== 'string') throw new TypeError(`Die Score Not a String: "${score}"`);
  if (score.length !== 1) throw new SyntaxError(`Die Score Incorrect: "${score}"`);
  const size = T2K4E.dieSizesMap.get(score);
  if (size == undefined) throw new RangeError(`Die Size Not Found! Score: "${score}"`);
  return size;
}

/* -------------------------------------------- */

/**
 * Gets the Attribute and Skill values (+ the skill's name).
 * @param {string} skillName The code of the skill
 * @param {Object} data Actor's data data
 * @returns {{ title: string, attribute: number, skill: number }}
 */
export function getAttributeAndSkill(skillName, data) {
  const skill = data.skills[skillName].value;
  const attributeName = T2K4E.skillsMap[skillName];
  const attribute = data.attributes[attributeName].value;
  const title = game.i18n.localize(T2K4E.skills[skillName]);
  return { title, attribute, skill };
}

/* -------------------------------------------- */

/**
 * Gets a DiceQuantities object from given values.
 * @param {number}   attribute     The attribute's size
 * @param {number}  [skill=0]      The skill's size
 * @param {number}  [rof=0]        The RoF's value
 * @param {number}  [modifier=0]   The task modifier
 * @param {boolean} [locate=false] Whether to roll a Location die
 * @see {YearZeroRoll}
 * @returns {import('../lib/yzur.js').DiceQuantities}
 */
export function getDiceQuantities(attribute, skill = 0, rof = 0, locate = false) {
  const DIE_SIZES = [0, 0, 0, 0, 0, 0, 'd', 'd', 'c', 'c', 'b', 'b', 'a'];
  const attributeScore = DIE_SIZES[attribute];
  const skillScore = DIE_SIZES[skill];
  const dice = {};
  if (attributeScore === skillScore && attribute >= 6) {
    dice[`${attributeScore}`] = 2;
  }
  else {
    if (attribute >= 6) dice[`${attributeScore}`] = 1;
    if (skill >= 6) dice[`${skillScore}`] = 1;
  }
  if (rof) dice.ammo = rof;
  if (locate) dice.loc = 1;
  return dice;
}

/* -------------------------------------------- */
/*  Dice So Nice Registration                   */
/* -------------------------------------------- */
// https://gitlab.com/riccisi/foundryvtt-dice-so-nice/-/wikis/API/Customization

export function registerDsN(dice3d) {
  dice3d.addSystem({
    id: 't2k4e',
    name: 'Twilight 2000 4E',
  }, 'preferred');

  dice3d.addColorset({
    name: 't2k-base',
    category: 'Twilight 2000 4E',
    description: 'T2K Base Die',
    foreground: '#cfa826', // '#E2C45F',
    background: '#262c23', // '#4C5847',
    outline: 'none',
    // edge: '#000',
    texture: 'none',
    material: 'metal',
    font: 'DaisyWheel',
  }, 'default');

  dice3d.addColorset({
    name: 't2k-ammo',
    category: 'Twilight 2000 4E',
    description: 'T2K Ammo Die',
    foreground: '#000',
    background: '#726435', // '#A3904D',
    outline: 'none',
    // edge: '#000',
    texture: 'bronze01',
    material: 'metal',
    font: 'DaisyWheel',
    fontScale: { dm: 0.75, d6: 0.75 },
  }, 'default');

  dice3d.addColorset({
    name: 't2k-loc',
    category: 'Twilight 2000 4E',
    description: 'T2K Hit Location Die',
    foreground: '#000',
    background: '#fff', // '#9b978e', // '#DED8CC',
    outline: 'none',
    // edge: '#000',
    texture: 'none',
    material: 'glass',
    font: 'DaisyWheel',
  }, 'default');

  dice3d.addDicePreset({
    type: 'd6',
    labels: [
      'systems/t2k4e/assets/dice/d6/t2k_d6_1_dsn.png',
      '2',
      '3',
      '4',
      '5',
      'systems/t2k4e/assets/dice/d6/t2k_d6_6_dsn.png',
    ],
    bumpMaps: [
      'systems/t2k4e/assets/dice/d6/t2k_d6_1_dsn_bump.png',,,,,
      'systems/t2k4e/assets/dice/d6/t2k_d6_6_dsn_bump.png',
    ],
    system: 't2k4e',
    colorset: 't2k-base',
  }, 'd6');

  dice3d.addDicePreset({
    type: 'd8',
    labels: [
      'systems/t2k4e/assets/dice/d8/t2k_d8_1_dsn.png',
      '2',
      '3',
      '4',
      '5',
      'systems/t2k4e/assets/dice/d8/t2k_d8_6_dsn.png',
      'systems/t2k4e/assets/dice/d8/t2k_d8_7_dsn.png',
      'systems/t2k4e/assets/dice/d8/t2k_d8_8_dsn.png',
    ],
    bumpMaps: [
      'systems/t2k4e/assets/dice/d8/t2k_d8_1_dsn_bump.png',,,,,
      'systems/t2k4e/assets/dice/d8/t2k_d8_6_dsn_bump.png',
      'systems/t2k4e/assets/dice/d8/t2k_d8_7_dsn_bump.png',
      'systems/t2k4e/assets/dice/d8/t2k_d8_8_dsn_bump.png',
    ],
    system: 't2k4e',
    colorset: 't2k-base',
  }, 'd8');

  dice3d.addDicePreset({
    type: 'd10',
    labels: [
      'systems/t2k4e/assets/dice/d10/t2k_d10_1_dsn.png',
      '2',
      '3',
      '4',
      '5',
      'systems/t2k4e/assets/dice/d10/t2k_d10_6_dsn.png',
      'systems/t2k4e/assets/dice/d10/t2k_d10_7_dsn.png',
      'systems/t2k4e/assets/dice/d10/t2k_d10_8_dsn.png',
      'systems/t2k4e/assets/dice/d10/t2k_d10_9_dsn.png',
      'systems/t2k4e/assets/dice/d10/t2k_d10_10_dsn.png',
    ],
    bumpMaps: [
      'systems/t2k4e/assets/dice/d10/t2k_d10_1_dsn_bump.png',,,,,
      'systems/t2k4e/assets/dice/d10/t2k_d10_6_dsn_bump.png',
      'systems/t2k4e/assets/dice/d10/t2k_d10_7_dsn_bump.png',
      'systems/t2k4e/assets/dice/d10/t2k_d10_8_dsn_bump.png',
      'systems/t2k4e/assets/dice/d10/t2k_d10_9_dsn_bump.png',
      'systems/t2k4e/assets/dice/d10/t2k_d10_10_dsn_bump.png',
    ],
    system: 't2k4e',
    colorset: 't2k-base',
  }, 'd10');

  dice3d.addDicePreset({
    type: 'd12',
    labels: [
      'systems/t2k4e/assets/dice/d12/t2k_d12_1_dsn.png',
      '2',
      '3',
      '4',
      '5',
      'systems/t2k4e/assets/dice/d12/t2k_d12_6_dsn.png',
      'systems/t2k4e/assets/dice/d12/t2k_d12_7_dsn.png',
      'systems/t2k4e/assets/dice/d12/t2k_d12_8_dsn.png',
      'systems/t2k4e/assets/dice/d12/t2k_d12_9_dsn.png',
      'systems/t2k4e/assets/dice/d12/t2k_d12_10_dsn.png',
      'systems/t2k4e/assets/dice/d12/t2k_d12_11_dsn.png',
      'systems/t2k4e/assets/dice/d12/t2k_d12_12_dsn.png',
    ],
    bumpMaps: [
      'systems/t2k4e/assets/dice/d12/t2k_d12_1_dsn_bump.png',,,,,
      'systems/t2k4e/assets/dice/d12/t2k_d12_6_dsn_bump.png',
      'systems/t2k4e/assets/dice/d12/t2k_d12_7_dsn_bump.png',
      'systems/t2k4e/assets/dice/d12/t2k_d12_8_dsn_bump.png',
      'systems/t2k4e/assets/dice/d12/t2k_d12_9_dsn_bump.png',
      'systems/t2k4e/assets/dice/d12/t2k_d12_10_dsn_bump.png',
      'systems/t2k4e/assets/dice/d12/t2k_d12_11_dsn_bump.png',
      'systems/t2k4e/assets/dice/d12/t2k_d12_12_dsn_bump.png',
    ],
    system: 't2k4e',
    colorset: 't2k-base',
  }, 'd12');

  dice3d.addDicePreset({
    type: 'dm',
    labels: [
      'systems/t2k4e/assets/dice/dm/t2k_dm_1_dsn.png',
      '2',
      '3',
      '4',
      '5',
      'systems/t2k4e/assets/dice/dm/t2k_dm_6_dsn.png',
    ],
    bumpMaps: [
      'systems/t2k4e/assets/dice/dm/t2k_dm_1_dsn.png',,,,,
      'systems/t2k4e/assets/dice/dm/t2k_dm_6_dsn.png',
    ],
    system: 't2k4e',
    colorset: 't2k-ammo',
  }, 'd6');

  dice3d.addDicePreset({
    type: 'dl',
    labels: [
      'systems/t2k4e/assets/dice/dl/hit_L.png',
      'systems/t2k4e/assets/dice/dl/hit_T.png',
      'systems/t2k4e/assets/dice/dl/hit_T.png',
      'systems/t2k4e/assets/dice/dl/hit_T.png',
      'systems/t2k4e/assets/dice/dl/hit_A.png',
      'systems/t2k4e/assets/dice/dl/hit_H.png',
    ],
    bumpMaps: [
      'systems/t2k4e/assets/dice/dl/hit_L.png',
      'systems/t2k4e/assets/dice/dl/hit_T.png',
      'systems/t2k4e/assets/dice/dl/hit_T.png',
      'systems/t2k4e/assets/dice/dl/hit_T.png',
      'systems/t2k4e/assets/dice/dl/hit_A.png',
      'systems/t2k4e/assets/dice/dl/hit_H.png',
    ],
    system: 't2k4e',
    colorset: 't2k-loc',
  }, 'd6');
}
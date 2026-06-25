import { RecipeModel, OverclockResult } from "./page.js";
import { Fluid, Goods, Item, Recipe, RecipeInOut, RecipeIoType, RecipeType, Repository } from "./repository.js";
import { TIER_LV, TIER_MV, TIER_LUV, TIER_ZPM, TIER_UV, TIER_UHV, TIER_UEV, TIER_UIV, TIER_UXV, CoilTierNames, CoilTiers } from "./utils.js";
import { voltageTier, getFusionTierByStartupCost, formatTicksAsTime, RotorHolderTiers, TurbineRotors, ReflectorTiers, ParallelHatchTier, ParallelHatchTiers, AbsoluteParallelHatchTiers, HeatingFluids } from "./utils.js";

export type MachineCoefficient<T> = Exclude<T, Function> | ((recipe:RecipeModel, choices:{[key:string]:number}) => T);

export abstract class Overclocker {
    public abstract calculate(recipeModel:RecipeModel, overclockTiers:number): OverclockResult;
}

export class StandardOverclocker extends Overclocker{
    maxPerfect: number;
    maxNormal: number;
    multiplier: number;
    perfectLabel?: string;

    private constructor(maxPerfect:number, maxNormal:number, multiplier:number, perfectLabel?:string) {
        super();
        this.maxPerfect = maxPerfect;
        this.maxNormal = maxNormal;
        this.multiplier = multiplier;
        this.perfectLabel = perfectLabel;
    }

    static onlyPerfect(maxPerfect=MAX_OVERCLOCK, multiplier:number=4) {
        return new StandardOverclocker(maxPerfect, 0, multiplier);
    }

    static onlyNormal(maxNormal=MAX_OVERCLOCK) {
        return new StandardOverclocker(0, maxNormal, 4);
    }

    static perfectThenNormal(maxPerfect=MAX_OVERCLOCK) {
        return new StandardOverclocker(maxPerfect, MAX_OVERCLOCK, 4);
    }

    // Half-perfect overclock used by fusion reactors: each tier gives 2x speed
    // and 2x EU/t, so the energy per recipe stays the same (unlike a normal
    // overclock which doubles it). Shown in the UI as "Fusion OC xN".
    static fusion(maxFusion=MAX_OVERCLOCK) {
        return new StandardOverclocker(maxFusion, 0, 2, "Fusion OC");
    }

    public calculate(recipeModel:RecipeModel, overclockTiers:number): OverclockResult {
        let overclockSpeed = 1;
        let overclockPower = 1;
        let nameParts : string[] = [];

        if (this.maxPerfect == 0 && this.maxNormal == 0) {
            return {overclockSpeed:1, overclockPower:1, perfectOverclocks:0, overclockName: "Can't overclock"};
        } else {

            let perfectOverclocks = Math.min(this.maxPerfect, overclockTiers);
            let normalOverclocks = Math.min(this.maxNormal, overclockTiers - perfectOverclocks);

            if (perfectOverclocks > 0) {
                overclockSpeed = Math.pow(this.multiplier, perfectOverclocks);
                let showCapped = perfectOverclocks == this.maxPerfect && normalOverclocks == 0;
                let suffix = showCapped ? " (capped)" : "";
                if (this.perfectLabel) {
                    nameParts.push(this.perfectLabel + " x" + perfectOverclocks + suffix)
                } else if (this.multiplier == 4) {
                    nameParts.push("Perfect OC x" + perfectOverclocks + suffix)
                } else {
                    nameParts.push(this.multiplier + "/" + this.multiplier + " OC x" + perfectOverclocks + suffix)
                }
            }
            if (normalOverclocks > 0) {
                let showCapped = normalOverclocks == this.maxNormal;
                let suffix = showCapped ? " (capped)" : "";
                let coef = Math.pow(2, normalOverclocks);
                overclockSpeed *= coef;
                overclockPower *= coef;
                nameParts.push("OC x" + normalOverclocks + suffix)
            }

            let overclockName = nameParts.join(", ");
            return { overclockSpeed, overclockPower, perfectOverclocks, overclockName };
        }
    }
}

export class NullOverclocker extends Overclocker {
    private constructor() {
        super()
    }

    public calculate(recipeModel:RecipeModel, overclockTiers:number): OverclockResult {
        return {overclockSpeed:1, overclockPower:1, perfectOverclocks:0, overclockName: "Can't overclock"};
    }

    public static instance = new NullOverclocker();
}

export class OverclockerFromClosure extends Overclocker {
    closure: (recipe:RecipeModel, overclockTiers: number) => OverclockResult;

    constructor(closure:(recipe:RecipeModel, overclockTiers: number) => OverclockResult) {
        super();
        this.closure = closure;
    }

    public calculate(recipeModel: RecipeModel, overclockTiers: number): OverclockResult {
        return this.closure(recipeModel, overclockTiers);
    }
}

const MAX_OVERCLOCK = Number.POSITIVE_INFINITY;

export type Machine = {
    choices?: {[key:string]:Choice};
    enforceChoiceConstraints?: (recipe:RecipeModel, choices:{[key:string]:number}) => void;
    overclocker: MachineCoefficient<Overclocker>;
    speed: MachineCoefficient<number>;
    power: MachineCoefficient<number>;
    parallels: MachineCoefficient<number>;
    recipe?: (recipe:RecipeModel, choices:{[key:string]:number}, items:RecipeInOut[]) => RecipeInOut[];
    info?: MachineCoefficient<string>;
    ignoreParallelLimit?: boolean;
    fixedVoltageTier?: MachineCoefficient<number>;
    excludesRecipe?: (recipe:Recipe) => boolean;
    roundAfterParallels?: boolean;
    subtick?: boolean;
}

export function GetParameter<T>(coefficient: MachineCoefficient<T>, recipeModel:RecipeModel): T {
    if (typeof coefficient === "function")
        return (coefficient as ((recipe:RecipeModel, choices:{[key:string]:number}) => T))(recipeModel, recipeModel.choices);
    else 
        return coefficient;
}

export type Choice = {
    description: string;
    choices?: string[];
    min?: number;
    max?: number;
    // Lowest selectable index for a given recipe. Options below it are hidden in
    // the UI and the value is clamped up to it. Used for recipe-dependent limits
    // such as the minimum reflector tier a fusion recipe requires.
    minIndex?: (recipe:RecipeModel) => number;
}

function createEditableCopy(items: RecipeInOut[]): RecipeInOut[] {
    return items.map(item => ({ ...item }));
}

let CoilTierChoice:Choice = {
    description: "Coils",
    choices: CoilTierNames.map((name, index) => `T${index+1}: ${name}`),
}

type MachineList = {
    [key: string]: Machine;
}

export const machines: MachineList = {};

export const singleBlockMachine:Machine = {
    overclocker: StandardOverclocker.onlyNormal(),
    speed: 1,
    power: 1,
    parallels: 1,
    excludesRecipe: (recipe:Recipe) => {
        return (recipe.gtRecipe.MetadataByKey("compression_tier") ?? 0) > 0;
    }
};

const singleBlockMachineWith22Overclock:Machine = {
    overclocker: StandardOverclocker.onlyNormal(),
    speed: 1,
    power: (recipe, choices) => {
        return Math.pow(0.5, recipe.voltageTier);
    },
    parallels: 1,
};

export function GetSingleBlockMachine(recipeType:RecipeType):Machine {
    if (recipeType.name == "Mass Fabrication")
        return singleBlockMachineWith22Overclock;
    return singleBlockMachine;
}

function IsRecipeType(recipe:RecipeModel, type:string):boolean {
    return recipe.recipe ? recipe.recipe.recipeType.name == type : false;
}

export const notImplementedMachine:Machine = {
    overclocker: StandardOverclocker.onlyNormal(),
    speed: 1,
    power: 1,
    parallels: 1,
    info: "Machine not implemented (Calculated as a singleblock)",
}

// ============================================================================
// Modifier-driven machine engine
// ----------------------------------------------------------------------------
// Machine behaviour is derived from the crafter's exported recipeModifiers
// rather than a hardcoded per-machine table. The formulas mirror
// GTRecipeModifiers / StarTRecipeModifiers from the StarTech source. Crafters
// whose modifiers are not modelled fall back to a sensible default (non-perfect
// overclock, no parallels) and carry an informational note.
// ============================================================================

function makeParallelHatchChoice(tiers:ParallelHatchTier[]):Choice {
    return {
        description: "Parallel Hatch",
        choices: tiers.map((tier) => `${tier.name}: ${tier.parallels}`),
    };
}

// Number of parallels for the selected hatch (choice index into the tier list).
function parallelHatchCount(tiers:ParallelHatchTier[], index:number):number {
    const tier = tiers[index] ?? tiers[0];
    return Math.max(1, tier?.parallels ?? 1);
}

// Describes every machine choice key the user can set a global default for,
// together with the human-readable option labels (matching how each choice is
// rendered on individual recipes). Used by the "Default machine choices" editor.
export type ChoiceDescriptor = {
    key: string;
    description: string;
    options: string[];
};

export function getChoiceDefaultDescriptors():ChoiceDescriptor[] {
    return [
        { key: "coilTier", description: "Coils", options: CoilTierNames.map((name, index) => `T${index+1}: ${name}`) },
        { key: "parallels", description: "Parallel Hatch", options: ParallelHatchTiers.map((tier) => `${tier.name}: ${tier.parallels}`) },
        { key: "absoluteParallels", description: "Absolute Parallel Hatch", options: AbsoluteParallelHatchTiers.map((tier) => `${tier.name}: ${tier.parallels}`) },
        { key: "reflector", description: "Reflector", options: ReflectorTiers.map((reflector) => `T${reflector.tier}: ${reflector.name}`) },
        { key: "heatingFluid", description: "Heating Fluid", options: HeatingFluids.map((fluid) => `${fluid.name}: ${fluid.temperature}MK`) },
        { key: "rotorHolder", description: "Rotor Holder", options: RotorHolderTiers.map((holder) => holder.name) },
        { key: "turbineRotor", description: "Rotor", options: TurbineRotors.map((rotor) => `${rotor.name} (P:${rotor.power}%, E:${rotor.efficiency}%)`) },
        { key: "boosting", description: "Boosting", options: ["None", "Passive", "Active"] },
    ];
}

// --- Hell Forge heating fluids ---
// The Hell Forge heats its crucible with a heating fluid. The recipe's required
// temperature (ebf_temp, in MK) determines the minimum usable fluid; every 450MK
// the fluid's temperature exceeds it multiplies the free (absolute) parallels by 2.
function makeHeatingFluidChoice():Choice {
    return {
        description: "Heating Fluid",
        choices: HeatingFluids.map((fluid) => `${fluid.name}: ${fluid.temperature}MK`),
        minIndex: minHeatingFluidIndex,
    };
}

function hellforgeRequiredTemp(recipe:RecipeModel):number {
    return recipe.recipe?.gtRecipe.MetadataByKey("ebf_temp") ?? 0;
}

// Lowest heating-fluid index whose temperature reaches the recipe's required
// temperature. Fluids below it cannot heat the crucible enough to run the recipe
// and are hidden from the dropdown.
function minHeatingFluidIndex(recipe:RecipeModel):number {
    const required = hellforgeRequiredTemp(recipe);
    if (required <= 0)
        return 0;
    const index = HeatingFluids.findIndex((fluid) => fluid.temperature >= required);
    return index < 0 ? Math.max(0, HeatingFluids.length - 1) : index;
}

// For every full 450MK the selected fluid exceeds the recipe's required
// temperature, the free parallels multiply by 2 (e.g. +450MK => x2, +1350MK => x8).
function hellforgeParallels(recipe:RecipeModel, choices:{[key:string]:number}):number {
    const fluid = HeatingFluids[choices.heatingFluid] ?? HeatingFluids[0];
    if (!fluid)
        return 1;
    const excess = fluid.temperature - hellforgeRequiredTemp(recipe);
    if (excess < 450)
        return 1;
    return Math.pow(2, Math.floor(excess / 450));
}

function makeCoilChoice():Choice {
    return {
        description: "Coils",
        choices: CoilTierNames.map((name, index) => `T${index+1}: ${name}`),
    };
}

function makeReflectorChoice():Choice {
    return {
        description: "Reflector",
        choices: ReflectorTiers.map((reflector) => `T${reflector.tier}: ${reflector.name}`),
    };
}

// Lowest reflector choice index whose tier satisfies the recipe requirement.
function minReflectorIndexForTier(requiredTier:number):number {
    const index = ReflectorTiers.findIndex((reflector) => reflector.tier >= requiredTier);
    return index < 0 ? Math.max(0, ReflectorTiers.length - 1) : index;
}

// Fusion reactors run at a fixed voltage matching their tier (e.g. luv/zpm/uv/
// uhv/uev/uiv_fusion_reactor). Derives that tier from the crafter's internal
// name prefix by matching it against the voltage tier names.
function getReactorVoltageTier(crafter:Item):number | undefined {
    const prefix = (crafter.internalName ?? "").split("_")[0].toUpperCase();
    const index = voltageTier.findIndex((tier) => tier.name.toUpperCase() === prefix);
    return index >= 0 ? index : undefined;
}

function multiplyFactors(factors: MachineCoefficient<number>[]): MachineCoefficient<number> {
    if (factors.length === 0)
        return 1;
    if (factors.length === 1)
        return factors[0];
    const closures = factors;
    return (recipe, _choices) => closures.reduce<number>((product, factor) => product * GetParameter<number>(factor, recipe), 1);
}

// EBF heat helpers, now reading the real coil baseHeatCapacity from the data.
function getEbfBlastTemp(recipe:RecipeModel, choices:{[key:string]:number}):number {
    const coil = CoilTiers[choices.coilTier] ?? CoilTiers[0];
    const coilHeat = coil ? coil.baseHeatCapacity : 0;
    const voltageHeat = Math.max(0, recipe.voltageTier - TIER_MV) * 100;
    return coilHeat + voltageHeat;
}

function getEbfExcessHeat(recipe:RecipeModel, choices:{[key:string]:number}):number {
    const recipeHeat = recipe.recipe?.gtRecipe.MetadataByKey("ebf_temp") ?? 0;
    return getEbfBlastTemp(recipe, choices) - recipeHeat;
}

// Lowest coil choice index whose blast temperature reaches the recipe's required
// heat (coil base heat + the recipe's voltage heat). Coils below it can't run the
// recipe and are hidden from the dropdown.
function minCoilIndexForEbf(recipe:RecipeModel):number {
    const recipeHeat = recipe.recipe?.gtRecipe.MetadataByKey("ebf_temp") ?? 0;
    if (recipeHeat <= 0)
        return 0;
    const voltageHeat = Math.max(0, recipe.voltageTier - TIER_MV) * 100;
    const index = CoilTiers.findIndex((coil) => coil.baseHeatCapacity + voltageHeat >= recipeHeat);
    return index < 0 ? Math.max(0, CoilTiers.length - 1) : index;
}

function makeEbfOverclocker(recipe:RecipeModel, choices:{[key:string]:number}):Overclocker {
    const maxPerfectOverclocks = Math.floor(getEbfExcessHeat(recipe, choices) / 1800);
    return StandardOverclocker.perfectThenNormal(maxPerfectOverclocks);
}

function ebfPower(recipe:RecipeModel, choices:{[key:string]:number}):number {
    const energyReductions = Math.floor(getEbfExcessHeat(recipe, choices) / 900);
    return Math.pow(0.95, energyReductions);
}

// Mutable accumulator describing the machine being assembled from modifiers.
type MachineBuilder = {
    speedFactors: MachineCoefficient<number>[];
    powerFactors: MachineCoefficient<number>[];
    parallelFactors: MachineCoefficient<number>[];
    overclocker?: MachineCoefficient<Overclocker>;
    subtick: boolean;
    ignoreParallelLimit: boolean;
    choices: {[key:string]:Choice};
    enforceChoiceConstraints?: (recipe:RecipeModel, choices:{[key:string]:number}) => void;
    excludesRecipe?: (recipe:Recipe) => boolean;
    fixedVoltageTier?: MachineCoefficient<number>;
    infos: string[];
};

type ModifierImpl = (builder:MachineBuilder, crafter:Item) => void;

const NO_OP:ModifierImpl = () => {};

function addCoilChoice(builder:MachineBuilder) {
    builder.choices["coilTier"] = makeCoilChoice();
}
function addParallelChoice(builder:MachineBuilder) {
    builder.choices["parallels"] = makeParallelHatchChoice(ParallelHatchTiers);
    builder.parallelFactors.push((_recipe, choices) => parallelHatchCount(ParallelHatchTiers, choices.parallels));
}

// Like addParallelChoice, but the parallels do not increase the EU consumed:
// each parallel runs for free, so the per-recipe power is divided by the count.
function addFreeParallelChoice(builder:MachineBuilder) {
    builder.choices["absoluteParallels"] = makeParallelHatchChoice(AbsoluteParallelHatchTiers);
    builder.parallelFactors.push((_recipe, choices) => parallelHatchCount(AbsoluteParallelHatchTiers, choices.absoluteParallels));
    builder.powerFactors.push((_recipe, choices) => 1 / parallelHatchCount(AbsoluteParallelHatchTiers, choices.absoluteParallels));
}

// Hell Forge heating-fluid modifier. The selected fluid sets the crucible
// temperature; surplus heat over the recipe's required temperature grants free
// (absolute) parallels that do not increase EU consumption. Applied by crafter id
// (the underlying recipe-modifier lambda is shared and its id is unstable).
function addHellforgeHeatingFluid(builder:MachineBuilder) {
    builder.choices["heatingFluid"] = makeHeatingFluidChoice();
    builder.parallelFactors.push((recipe, choices) => hellforgeParallels(recipe, choices));
    builder.powerFactors.push((recipe, choices) => 1 / hellforgeParallels(recipe, choices));
    builder.infos.push("Hell Forge: a heating fluid heats the crucible; every 450MK above the recipe's required temperature doubles the free parallels.");
}

// Crafters whose recipe-modifier lambda is not modelled by id but whose behaviour
// is known. Keyed by `mod:internalName` (the lambda id is shared and unstable
// across exports, so it cannot be used as a stable key).
const crafterModifierRegistry: {[id:string]: ModifierImpl} = {
    "start_core:hellforge": addHellforgeHeatingFluid,
    "start_core:fornaxs_infernal_rotary_engine": addHellforgeHeatingFluid,
    "start_core:bacterial_hydrocarbon_harvester": builder => {
        builder.infos.push("Input/output amounts are for a perfect-stat (5/1/1) bacteria colony.");
    },
    "start_core:bacterial_breeding_vat": builder => {
        builder.infos.push("Output assumes no mutation.");
    },
};

// Maps each known modifier id to the contribution it makes to a machine.
const modifierRegistry: {[id:string]: ModifierImpl} = {
    // --- Overclocking behaviour ---
    "oc_perfect": builder => { builder.overclocker = StandardOverclocker.onlyPerfect(); },
    "oc_non_perfect": builder => { builder.overclocker = StandardOverclocker.onlyNormal(); },
    "oc_non_perfect_subtick": builder => {
        builder.overclocker = StandardOverclocker.onlyNormal();
        builder.subtick = true;
    },

    // --- Parallels ---
    // parallel_hatch scales EU with the parallel count (voltage-budget limited),
    // while absolute_parallel runs its parallels for free (no extra EU).
    "parallel_hatch": addParallelChoice,
    "absolute_parallel": addFreeParallelChoice,

    // --- Bulk / throughput multipliers ---
    "throughput_boosting": builder => {
        builder.parallelFactors.push(4);
        builder.speedFactors.push(1 / 1.6);
        builder.powerFactors.push(0.95);
        // The 4 parallels are free: divide the per-recipe power so total EU does
        // not grow with the parallel count.
        builder.powerFactors.push(1 / 4);
    },
    "bulk_processing": builder => {
        builder.parallelFactors.push(16);
        builder.speedFactors.push(1 / 13);
    },

    // --- Coil-based specialised overclocks ---
    "ebf_oc": builder => {
        builder.overclocker = makeEbfOverclocker;
        builder.powerFactors.push(ebfPower);
        addCoilChoice(builder);
        // Hide coils that can't reach the recipe's required blast temperature.
        builder.choices["coilTier"].minIndex = minCoilIndexForEbf;
    },
    "cracker_oc": builder => {
        builder.overclocker = StandardOverclocker.onlyNormal();
        builder.subtick = true;
        addCoilChoice(builder);
        builder.powerFactors.push((_recipe, choices) => {
            const tier = choices.coilTier;
            if (tier <= 0)
                return 1;
            const discount = tier > 9 ? (0.9 + (tier - 9) * 0.025) : tier * 0.1;
            return Math.max(0.0001, 1 - discount);
        });
    },
    "pyrolyse_oven_oc": builder => {
        builder.overclocker = StandardOverclocker.onlyNormal();
        builder.subtick = true;
        addCoilChoice(builder);
        builder.speedFactors.push((_recipe, choices) => {
            const tier = choices.coilTier;
            const durationMultiplier = tier == 0 ? (4 / 3) : (2 / (tier + 1));
            return 1 / durationMultiplier;
        });
    },
    "chemical_reactor_oc": builder => {
        builder.overclocker = StandardOverclocker.onlyNormal();
        builder.subtick = true;
        addCoilChoice(builder);
        builder.speedFactors.push((_recipe, choices) => 0.75 + choices.coilTier * 0.25);
        builder.powerFactors.push((_recipe, choices) => 1 - choices.coilTier * 0.05);
    },
    "multi_smellter_parallel": builder => {
        // Approximation: maxParallel = 32 * coil smelter level. The in-game logic
        // also rewrites recipe duration/EUt, which is not modelled here.
        builder.overclocker = StandardOverclocker.onlyNormal();
        builder.subtick = true;
        addCoilChoice(builder);
        builder.parallelFactors.push((_recipe, choices) => {
            const coil = CoilTiers[choices.coilTier] ?? CoilTiers[0];
            const level = coil ? coil.smelterLevel : (choices.coilTier + 1);
            return Math.max(1, 32 * level);
        });
        builder.infos.push("Multi Smelter parallels approximated (duration/EUt overrides not modelled).");
    },

    // --- No-ops for rate calculation ---
    "batch_mode": NO_OP,
    "default_environment_requirement": NO_OP,
    "consume_eu_to_start": NO_OP,
    "fake_fusion_overclock": NO_OP,

    // --- Reflector fusion reactor ---
    // Mirrors ReflectorFusionReactorMachine.recipeModifier from StarT-Core. The
    // reactor runs at a fixed voltage equal to its tier. Overclocking is done
    // with half-perfect "Fusion OC" steps (2x speed, 2x EU/t, so energy per
    // recipe is unchanged):
    //   * one Fusion OC for each tier the reactor voltage is above the recipe
    //     base tier, then
    //   * one extra Fusion OC for each surplus reflector tier (reflectorDiff),
    //     applied afterwards up to the reactor tier's maximum voltage.
    // A reactor can only run a recipe whose startup energy (eu_to_start) fits
    // within its maximum energy storage (read from the tooltip).
    "reflector_fusion_reactor": (builder, crafter) => {
        builder.choices["reflector"] = makeReflectorChoice();
        // A reactor can only run a recipe whose reflector requirement is met:
        // hide reflector tiers below the recipe's required `reflector_tier`.
        builder.choices["reflector"].minIndex = (recipe) => {
            const required = recipe.recipe?.gtRecipe.MetadataByKey("reflector_tier") ?? 0;
            return required > 0 ? minReflectorIndexForTier(required) : 0;
        };
        const maxEnergyStorage = crafter.MetadataByKey("maxEnergyStorage", 0);
        if (maxEnergyStorage > 0) {
            builder.excludesRecipe = (recipe) => {
                const euToStart = recipe.gtRecipe.MetadataByKey("eu_to_start", 0);
                return euToStart > maxEnergyStorage;
            };
        }
        const reactorTier = getReactorVoltageTier(crafter);
        if (reactorTier !== undefined)
            builder.fixedVoltageTier = reactorTier;
        builder.overclocker = (recipe, choices) => {
            const required = recipe.recipe?.gtRecipe.MetadataByKey("reflector_tier") ?? 0;
            const reflector = ReflectorTiers[choices.reflector] ?? ReflectorTiers[0];
            const reflectorDiff = Math.max(0, (reflector?.tier ?? 1) - required);
            return new OverclockerFromClosure((recipeModel, _overclockTiers) => {
                const gtRecipe = recipeModel.recipe?.gtRecipe;
                // One Fusion OC per reactor tier above the recipe base tier.
                const baseOverclocks = Math.max(0, recipeModel.voltageTier - (gtRecipe?.voltageTier ?? recipeModel.voltageTier));
                // The reactor tier's max voltage caps how many extra (reflector)
                // Fusion OCs can be applied: each OC doubles the EU/t draw.
                const baseVoltage = Math.abs(gtRecipe?.voltage ?? 0);
                const reactorMaxVoltage = voltageTier[recipeModel.voltageTier]?.voltage ?? 0;
                const voltageOverclockCap = (baseVoltage > 0 && reactorMaxVoltage > 0)
                    ? Math.floor(Math.log2(reactorMaxVoltage / baseVoltage))
                    : baseOverclocks + reflectorDiff;
                const totalOverclocks = Math.min(baseOverclocks + reflectorDiff, Math.max(baseOverclocks, voltageOverclockCap));
                return StandardOverclocker.fusion().calculate(recipeModel, totalOverclocks);
            });
        };
        builder.infos.push("Reflector fusion: runs at the reactor's fixed voltage; surplus reflector tiers add Fusion OCs up to the reactor tier's max voltage.");
    },
};

const machineCache: {[id:string]: Machine} = {};

function ComposeMachineFromModifiers(crafter:Item, _recipeType:RecipeType):Machine {
    const modifiers = crafter.recipeModifiers ?? [];
    if (modifiers.length === 0)
        return notImplementedMachine;

    const builder:MachineBuilder = {
        speedFactors: [],
        powerFactors: [],
        parallelFactors: [],
        overclocker: undefined,
        subtick: false,
        ignoreParallelLimit: false,
        choices: {},
        infos: [],
    };

    let hasCustomLogic = false;
    for (const id of modifiers) {
        const impl = modifierRegistry[id];
        if (impl)
            impl(builder, crafter);
        else
            // Unknown / lambda / fusion-style modifier: cannot be modelled exactly.
            hasCustomLogic = true;
    }

    // Crafters with a known-but-lambda modifier (keyed by id rather than the
    // unstable lambda modifier id). Applying it replaces the unmodelled lambda,
    // so the generic approximation note is suppressed.
    const crafterImpl = crafterModifierRegistry[`${crafter.mod}:${crafter.internalName}`];
    if (crafterImpl) {
        crafterImpl(builder, crafter);
        hasCustomLogic = false;
    }

    if (hasCustomLogic)
        builder.infos.push("Uses custom machine logic that is not fully modelled (approximated).");

    const machine:Machine = {
        overclocker: builder.overclocker ?? StandardOverclocker.onlyNormal(),
        speed: multiplyFactors(builder.speedFactors),
        power: multiplyFactors(builder.powerFactors),
        parallels: multiplyFactors(builder.parallelFactors),
    };
    if (builder.subtick)
        machine.subtick = true;
    if (Object.keys(builder.choices).length > 0)
        machine.choices = builder.choices;
    if (builder.enforceChoiceConstraints)
        machine.enforceChoiceConstraints = builder.enforceChoiceConstraints;
    if (builder.excludesRecipe)
        machine.excludesRecipe = builder.excludesRecipe;
    if (builder.fixedVoltageTier !== undefined)
        machine.fixedVoltageTier = builder.fixedVoltageTier;
    if (builder.ignoreParallelLimit)
        machine.ignoreParallelLimit = true;
    if (builder.infos.length > 0)
        machine.info = builder.infos.join(" ");
    return machine;
}

// ============================================================================
// Rotor-based turbine generators
// ----------------------------------------------------------------------------
// The large gas/plasma turbines (and the boosted Supreme/Nyinsane variants)
// cannot be modelled through the named-modifier pattern: their behaviour is
// driven by the installed rotor holder tier and turbine rotor material, exposed
// here as data-driven choices (mirroring the EBF coil choice).
//
// GT formulas (RotorHolderPartMachine / LargeTurbineMachine):
//   tierDiff        = holderTier - controllerTier   (clamped >= 0)
//   totalEfficiency = max(100, rotorEfficiency% * 1.1^tierDiff)
//   totalPower      = rotorPower% * 2^tierDiff
//   maxVoltage      = baseProduction * totalPower/100 * parallelBonus
// The net EU produced per unit of fuel scales with totalEfficiency (and the
// boost bonus); maxVoltage only sets how much fuel a single turbine burns, i.e.
// the number of turbines needed (parallels), not the fuel<->EU balance.
// ============================================================================

type TurbineSpec = {
    controllerTier: number;     // tier the rotor holder is compared against
    baseProduction: number;     // BASE_EU_OUTPUT = V[controllerTier] * 2
    parallelBonus: number;      // boosted turbines burn more fuel per turbine
    boostTable?: number[];      // EU-per-fuel multiplier by [None, Passive, Active]
};

function makeTurbineMachine(spec:TurbineSpec):Machine {
    // Rotor holders below the turbine's controller tier cannot be installed.
    const minHolderIndex = Math.max(0, RotorHolderTiers.findIndex(h => h.tier >= spec.controllerTier));
    const choices:{[key:string]:Choice} = {
        rotorHolder: { description: "Rotor Holder", choices: RotorHolderTiers.map(h => h.name), min: minHolderIndex },
        turbineRotor: { description: "Rotor", choices: TurbineRotors.map(r => `${r.name} (P:${r.power}%, E:${r.efficiency}%)`) },
    };
    if (spec.boostTable)
        choices.boosting = { description: "Boosting", choices: ["None", "Passive", "Active"] };

    const tierDiffOf = (selected:{[key:string]:number}) => {
        const holder = RotorHolderTiers[selected.rotorHolder] ?? RotorHolderTiers[0];
        return Math.max(0, (holder?.tier ?? spec.controllerTier) - spec.controllerTier);
    };
    const rotorOf = (selected:{[key:string]:number}) => TurbineRotors[selected.turbineRotor] ?? TurbineRotors[0];

    const power:MachineCoefficient<number> = (_recipe, selected) => {
        const tierDiff = tierDiffOf(selected);
        const rotor = rotorOf(selected);
        const totalEfficiency = Math.max(100, (rotor?.efficiency ?? 100) * Math.pow(1.1, tierDiff));
        let bonus = 1;
        if (spec.boostTable)
            bonus = spec.boostTable[selected.boosting ?? 0] ?? spec.boostTable[0];
        return totalEfficiency / 100 * bonus;
    };

    const parallels:MachineCoefficient<number> = (recipe, selected) => {
        const tierDiff = tierDiffOf(selected);
        const rotor = rotorOf(selected);
        const totalPower = (rotor?.power ?? 100) * Math.pow(2, tierDiff);
        const maxVoltage = spec.baseProduction * totalPower / 100 * spec.parallelBonus;
        const recipeVoltage = Math.abs(recipe.recipe?.gtRecipe.voltage ?? 0);
        if (recipeVoltage <= 0)
            return 1;
        return Math.max(1, Math.ceil(maxVoltage / recipeVoltage));
    };

    const info = spec.boostTable
        ? "Production scales with the chosen rotor holder tier and rotor material. Boosting fuel is not modelled."
        : "Production scales with the chosen rotor holder tier and rotor material.";

    return {
        choices,
        overclocker: NullOverclocker.instance,
        speed: 1,
        power,
        parallels,
        ignoreParallelLimit: true,
        info,
    };
}

// Crafters whose machine cannot be derived from modifiers. Keyed by the binary
// item id (i:<mod>:<internalName>:<damage>).
const customMachineRegistry:{[crafterId:string]: () => Machine} = {
    "i:gtceu:gas_large_turbine:0": () => makeTurbineMachine({ controllerTier: 4, baseProduction: 4096, parallelBonus: 1 }),
    "i:gtceu:plasma_large_turbine:0": () => makeTurbineMachine({ controllerTier: 5, baseProduction: 16384, parallelBonus: 1 }),
    "i:gtceu:supreme_plasma_turbine:0": () => makeTurbineMachine({ controllerTier: 5, baseProduction: 16384, parallelBonus: 6, boostTable: [0.9, 1.25, 2] }),
    "i:gtceu:nyinsane_plasma_turbine:0": () => makeTurbineMachine({ controllerTier: 5, baseProduction: 16384, parallelBonus: 12, boostTable: [0.8, 1.5, 3] }),
};

// Builds (and memoizes) the Machine for a given multiblock crafter from its
// exported recipeModifiers. Replaces the former hardcoded machine table.
export function BuildMachineFromCrafter(crafter:Item, recipeType:RecipeType):Machine {
    const cached = machineCache[crafter.id];
    if (cached)
        return cached;
    const custom = customMachineRegistry[crafter.id];
    const machine = custom ? custom() : ComposeMachineFromModifiers(crafter, recipeType);
    machineCache[crafter.id] = machine;
    return machine;
}

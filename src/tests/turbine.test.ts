import { PageModel, RecipeModel } from '../page';
import { SolvePage } from '../solver';
import { Recipe, RecipeIoType, Repository } from '../repository';
import { RotorHolderTiers, TurbineRotors } from '../utils';
import { setupRepository } from './setup';

// Turbine controllers (customMachineRegistry in machines.ts).
const PLASMA_TURBINE = 'i:gtceu:plasma_large_turbine:0';
const SUPREME_TURBINE = 'i:gtceu:supreme_plasma_turbine:0';
const GAS_TURBINE = 'i:gtceu:gas_large_turbine:0';

// Plasma fuels are direct fluids; the gas fuels are single-variant forge tags
// that resolve to one fluid, so every fuel slot is a plain FluidInput. Plasma
// recipes also emit the de-energized gas (a 1:1 material output).
const HELIUM_RECIPE = 'r:start:plasma_generator/helium_from_helium_plasma';
const ARGON_RECIPE = 'r:start:plasma_generator/argon_from_argon_plasma';
const IRON_RECIPE = 'r:start:plasma_generator/iron_from_iron_plasma';
const GAS_NITROBENZENE_RECIPE = 'r:gtceu:gas_turbine/nitrobenzene';

// controllerTier IV (5) for the plasma turbines, parallelBonus 1.
const PLASMA_BASE = 16384;

function solve(crafter: string, recipeId: string, choices: { [key: string]: number }): RecipeModel {
    const page = new PageModel({
        name: 'Turbine Test',
        products: [],
        rootGroup: {
            type: 'recipe_group',
            links: {},
            elements: [{
                type: 'recipe',
                recipeId,
                voltageTier: 9,
                fixedCrafterCount: 1,
                crafter,
                choices,
            }],
        },
    });
    SolvePage(page);
    return page.rootGroup.elements[0] as RecipeModel;
}

// Total EU/t produced (energy flows are negative for generators). One crafter is
// fixed, so this is the output of a single turbine.
const producedEuPerTick = (model: RecipeModel) =>
    -Object.values(model.flow.energy).reduce((a, b) => a + b, 0);

const holderIndex = (tier: number) => RotorHolderTiers.findIndex((h) => h.tier === tier);

// Resolve a rotor by its exact (power%, efficiency%). Throws if the data changes
// so the test fails loudly instead of silently falling back to another rotor.
function rotor(power: number, efficiency: number): number {
    const i = TurbineRotors.findIndex((r) => r.power === power && r.efficiency === efficiency);
    if (i < 0)
        throw new Error(`no turbine rotor with power ${power}% efficiency ${efficiency}%`);
    return i;
}

// A single fixed crafter runs `parallels` recipes every effective (post-
// truncation) duration, so recipesPerMinute = parallels * 1200 / duration.
// Inverting that recovers the whole-tick duration the solver actually used.
const effectiveDurationTicks = (model: RecipeModel) =>
    model.parallels * 1200 / model.recipesPerMinute;

// Fuel input rate in mB/second (flow.input is per minute). Handles both plain
// fluids and ore-dict fuels (resolved via selectedOreDicts).
function fuelPerSecond(model: RecipeModel, recipeId: string): number {
    const recipe = Repository.current.GetById<Recipe>(recipeId)!;
    const slot = recipe.items.find((s) =>
        s.type === RecipeIoType.FluidInput || s.type === RecipeIoType.ItemInput ||
        s.type === RecipeIoType.FluidOreDictInput || s.type === RecipeIoType.OreDictInput)!;
    const goodsId = (model.selectedOreDicts[slot.goods.id] ?? slot.goods).id;
    return (model.flow.input[goodsId] ?? 0) / 60;
}

describe('Large turbine generators', () => {
    beforeAll(async () => {
        await setupRepository();
    });

    // Stats captured in-game (turbine-data.md). The holder adds a flat +10%
    // efficiency per tier above the controller; efficiency stretches the recipe
    // duration (truncated to a whole tick) so fuel burns slower at a fixed EU/t,
    // while EU/t itself is the unrounded maxVoltage (independent of efficiency).
    const cases = [
        {
            name: 'Large Plasma / IV / Helium',
            turbine: PLASMA_TURBINE, recipe: HELIUM_RECIPE, holderTier: 5,
            power: 150, efficiency: 120,   // tierDiff 0 -> 120% total
            parallels: 12, durationTicks: 32, fuelPerSecond: 37.5, outputEuPerTick: 24576,
        },
        {
            name: 'Large Plasma / ZPM / Argon (Lumium rotor)',
            turbine: PLASMA_TURBINE, recipe: ARGON_RECIPE, holderTier: 7,
            power: 220, efficiency: 160,   // 160% * (1 + 0.2) = 192% total
            parallels: 71, durationTicks: 222, fuelPerSecond: 31.98, outputEuPerTick: 144179,
        },
        {
            name: 'Large Plasma / UHV / Iron (Runicalium rotor)',
            turbine: PLASMA_TURBINE, recipe: IRON_RECIPE, holderTier: 9,
            power: 6400, efficiency: 320,  // 320% * (1 + 0.4) = 448% total
            parallels: 8192, durationTicks: 604, fuelPerSecond: 271.26, outputEuPerTick: 16777216,
        },
        {
            name: 'Large Gas / ZPM / Nitrobenzene (Runicalium rotor)',
            turbine: GAS_TURBINE, recipe: GAS_NITROBENZENE_RECIPE, holderTier: 7,
            power: 6400, efficiency: 320,  // 320% * (1 + 0.3) = 416% total
            parallels: 65536, durationTicks: 166, fuelPerSecond: 7895.9, outputEuPerTick: 2097152,
        },
    ];

    for (const c of cases) {
        it(`matches in-game stats: ${c.name}`, () => {
            const model = solve(c.turbine, c.recipe, {
                rotorHolder: holderIndex(c.holderTier),
                turbineRotor: rotor(c.power, c.efficiency),
            });
            // Fuel is consumed for the full (ceil'd) parallel count...
            expect(model.parallels).toBe(c.parallels);
            expect(fuelPerSecond(model, c.recipe)).toBeCloseTo(c.fuelPerSecond, 1);
            // ...at the efficiency-stretched, whole-tick recipe duration...
            expect(Math.round(effectiveDurationTicks(model))).toBe(c.durationTicks);
            // ...but EU/t output is only the unrounded maxVoltage.
            expect(producedEuPerTick(model)).toBeCloseTo(c.outputEuPerTick, 0);
        });
    }

    it('adds a flat +10% holder bonus per tier, not a compounding 1.1^tier', () => {
        // Lumium (eff 160%) two tiers above the IV controller (ZPM) totals
        // 160 * (1 + 0.2) = 192% (additive). The old bug used 160 * 1.1^2 = 193.6%,
        // which floors the 116-tick argon recipe to 224 ticks instead of 222.
        const base = Repository.current.GetById<Recipe>(ARGON_RECIPE)!.gtRecipe.durationTicks;
        const additive = Math.floor(base * (160 * (1 + 0.2)) / 100);
        const compounded = Math.floor(base * (160 * Math.pow(1.1, 2)) / 100);
        expect(additive).not.toBe(compounded);

        const model = solve(PLASMA_TURBINE, ARGON_RECIPE, {
            rotorHolder: holderIndex(7), turbineRotor: rotor(220, 160),
        });
        expect(Math.round(effectiveDurationTicks(model))).toBe(additive);
    });

    it('produces the same EU/t regardless of rotor efficiency (only fuel differs)', () => {
        // Two rotors, same power, different efficiency, at the controller tier
        // (tierDiff 0) so maxVoltage = baseProduction * power%/100 = baseProduction.
        const holder = holderIndex(5);
        const low = solve(PLASMA_TURBINE, HELIUM_RECIPE, { rotorHolder: holder, turbineRotor: rotor(100, 120) });
        const high = solve(PLASMA_TURBINE, HELIUM_RECIPE, { rotorHolder: holder, turbineRotor: rotor(100, 160) });

        expect(producedEuPerTick(low)).toBeCloseTo(PLASMA_BASE, 0);
        expect(producedEuPerTick(high)).toBeCloseTo(PLASMA_BASE, 0);
        // Same EU/t, but the higher-efficiency rotor burns less fuel for it.
        expect(fuelPerSecond(high, HELIUM_RECIPE)).toBeLessThan(fuelPerSecond(low, HELIUM_RECIPE));
    });

    it('keeps the plasma -> gas mass balance (de-energized output tracks the fuel)', () => {
        const model = solve(PLASMA_TURBINE, HELIUM_RECIPE, { rotorHolder: holderIndex(5), turbineRotor: rotor(100, 160) });
        const recipe = Repository.current.GetById<Recipe>(HELIUM_RECIPE)!;
        const input = recipe.items.find((s) => s.type === RecipeIoType.FluidInput)!;
        const output = recipe.items.find((s) => s.type === RecipeIoType.FluidOutput)!;
        // The base recipe converts fuel 1:1 into its de-energized gas; consumed
        // plasma must equal produced gas.
        expect(model.flow.output[output.goods.id]).toBeCloseTo(model.flow.input[input.goods.id], 5);
    });

    it('lets the boost bonus multiply EU/t without changing fuel use', () => {
        // Supreme turbine boost table [None 0.9, Passive 1.25, Active 2.0].
        const holder = holderIndex(5);
        const r = rotor(100, 160);
        const none = solve(SUPREME_TURBINE, HELIUM_RECIPE, { rotorHolder: holder, turbineRotor: r, boosting: 0 });
        const passive = solve(SUPREME_TURBINE, HELIUM_RECIPE, { rotorHolder: holder, turbineRotor: r, boosting: 1 });
        const active = solve(SUPREME_TURBINE, HELIUM_RECIPE, { rotorHolder: holder, turbineRotor: r, boosting: 2 });

        const euNone = producedEuPerTick(none);
        expect(producedEuPerTick(passive) / euNone).toBeCloseTo(1.25 / 0.9, 5);
        expect(producedEuPerTick(active) / euNone).toBeCloseTo(2.0 / 0.9, 5);

        // Boost raises output per turbine; it does not change how much fuel a
        // turbine burns (that only depends on the rotor efficiency).
        expect(fuelPerSecond(passive, HELIUM_RECIPE)).toBeCloseTo(fuelPerSecond(none, HELIUM_RECIPE), 5);
        expect(fuelPerSecond(active, HELIUM_RECIPE)).toBeCloseTo(fuelPerSecond(none, HELIUM_RECIPE), 5);
    });
});

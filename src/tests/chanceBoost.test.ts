import { PageModel, RecipeModel } from '../page';
import { SolvePage } from '../solver';
import { Recipe, RecipeIoType, Repository } from '../repository';
import { voltageTier } from '../utils';
import { setupRepository } from './setup';

// Void Excavation has six chanced item outputs, each carrying a positive
// tierChanceBoost, which makes it a good end-to-end check for chance boosting.
const RECIPE_ID = 'r:start:void_excavation/mining';
const CRAFTER_ID = 'i:gtceu:void_excavator:0';

function solveAt(tier: number): RecipeModel {
    const page = new PageModel({
        name: 'Chance Boost Test',
        products: [],
        rootGroup: {
            type: 'recipe_group',
            links: {},
            elements: [{
                type: 'recipe',
                recipeId: RECIPE_ID,
                voltageTier: tier,
                fixedCrafterCount: 1,
                crafter: CRAFTER_ID,
                choices: {},
            }],
        },
    });
    SolvePage(page);
    return page.rootGroup.elements[0] as RecipeModel;
}

// Mirrors BoostedProbability in the solver: chance grows by tierChanceBoost per
// overclock and is clamped to [0, 1].
const boostedChance = (base: number, boost: number, tiers: number) =>
    Math.min(1, Math.max(0, base + boost * tiers));

describe('Chance boosting (void_excavation)', () => {
    beforeAll(async () => {
        await setupRepository();
    });

    it('reads probability and tierChanceBoost for every chanced output', () => {
        const recipe = Repository.current.GetById<Recipe>(RECIPE_ID)!;
        expect(recipe).toBeDefined();

        const actual = recipe.items
            .filter((slot) => slot.type === RecipeIoType.ItemOutput)
            .map((slot) => ({ p: slot.probability, b: slot.tierChanceBoost }))
            .sort((a, b) => a.p - b.p || a.b - b.b);
        const expected = [
            { p: 0.30, b: 0.050 }, // raw_pentlandite
            { p: 0.30, b: 0.100 }, // raw_sodalite
            { p: 0.35, b: 0.075 }, // raw_silver
            { p: 0.40, b: 0.075 }, // raw_gold
            { p: 0.40, b: 0.100 }, // raw_coal
            { p: 0.60, b: 0.120 }, // raw_realgar
        ];

        expect(actual.length).toBe(expected.length);
        actual.forEach((slot, i) => {
            expect(slot.p).toBeCloseTo(expected[i].p, 5);
            expect(slot.b).toBeCloseTo(expected[i].b, 5);
        });
    });

    it('does not boost chanced outputs at the recipe base tier', () => {
        const baseTier = Repository.current.GetById<Recipe>(RECIPE_ID)!.gtRecipe.voltageTier;
        const model = solveAt(baseTier);

        expect(model.overclockTiers).toBe(0);
        expect(model.recipesPerMinute).toBeGreaterThan(0);

        for (const slot of model.recipeItems) {
            if (slot.type !== RecipeIoType.ItemOutput) continue;
            const expected = slot.amount * slot.probability * model.recipesPerMinute;
            expect(model.flow.output[slot.goods.id]).toBeCloseTo(expected, 5);
        }
    });

    it('boosts every chanced output by tierChanceBoost per overclock', () => {
        const baseTier = Repository.current.GetById<Recipe>(RECIPE_ID)!.gtRecipe.voltageTier;
        const model = solveAt(Math.min(baseTier + 2, voltageTier.length - 1));
        const overclocks = model.overclockTiers;

        expect(overclocks).toBeGreaterThan(0);
        expect(model.recipesPerMinute).toBeGreaterThan(0);

        let boostedOutputs = 0;
        for (const slot of model.recipeItems) {
            if (slot.type !== RecipeIoType.ItemOutput) continue;

            const chance = boostedChance(slot.probability, slot.tierChanceBoost, overclocks);
            const expected = slot.amount * chance * model.recipesPerMinute;
            expect(model.flow.output[slot.goods.id]).toBeCloseTo(expected, 5);

            // Positive boost must raise the produced amount above the base chance.
            const unboosted = slot.amount * slot.probability * model.recipesPerMinute;
            expect(model.flow.output[slot.goods.id]).toBeGreaterThan(unboosted);
            boostedOutputs++;
        }
        expect(boostedOutputs).toBe(6);
    });

    it('scales chanced outputs with the tier while leaving non-chanced outputs untouched', () => {
        const baseTier = Repository.current.GetById<Recipe>(RECIPE_ID)!.gtRecipe.voltageTier;
        const low = solveAt(baseTier);
        const high = solveAt(Math.min(baseTier + 2, voltageTier.length - 1));

        expect(low.overclockTiers).toBe(0);
        expect(high.overclockTiers).toBeGreaterThan(0);

        // Per-recipe chance isolates the boost from the higher recipe throughput.
        const chancePerRecipe = (model: RecipeModel, id: string, amount: number) =>
            (model.flow.output[id] ?? 0) / (amount * model.recipesPerMinute);

        let chancedOutputs = 0;
        let steadyOutputs = 0;
        for (const slot of low.recipeItems) {
            const isOutput = slot.type === RecipeIoType.ItemOutput || slot.type === RecipeIoType.FluidOutput;
            if (!isOutput) continue;

            const lowChance = chancePerRecipe(low, slot.goods.id, slot.amount);
            const highChance = chancePerRecipe(high, slot.goods.id, slot.amount);
            if (slot.tierChanceBoost > 0) {
                expect(lowChance).toBeCloseTo(slot.probability, 5);
                expect(highChance).toBeGreaterThan(lowChance);
                chancedOutputs++;
            } else {
                // Non-chanced outputs (the 100% fluids) never change with the tier.
                expect(highChance).toBeCloseTo(lowChance, 5);
                steadyOutputs++;
            }
        }
        expect(chancedOutputs).toBe(6);
        expect(steadyOutputs).toBeGreaterThan(0);
    });
});

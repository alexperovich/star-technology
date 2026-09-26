import { PageModel, RecipeModel } from '../page';
import { Recipe, Repository } from '../repository';
import { SolvePage } from '../solver';
import { setupRepository } from './setup';
import { TIER_HV, TIER_LV, TIER_MV, TIER_UEV, voltageTier } from '../utils';

const RECIPES = [
    'r:gtceu:combustion_generator/biodiesel',
    'r:gtceu:gas_turbine/methane',
    'r:gtceu:steam_turbine/steam',
];

const COMPOUND_GENERATORS = [
    { tier: TIER_LV, crafter: 'i:gtceu:lv_compound_generator:0' },
    { tier: TIER_MV, crafter: 'i:gtceu:mv_compound_generator:0' },
    { tier: TIER_HV, crafter: 'i:gtceu:hv_compound_generator:0' },
];

function solve(recipeId:string, voltageTierIndex:number, crafter?:string):RecipeModel {
    const page = new PageModel({
        name: 'Generator Test',
        products: [],
        rootGroup: {
            type: 'recipe_group',
            links: {},
            elements: [{
                type: 'recipe',
                recipeId,
                voltageTier: voltageTierIndex,
                fixedCrafterCount: 1,
                crafter,
                choices: {},
            }],
        },
    });
    SolvePage(page);
    return page.rootGroup.elements[0] as RecipeModel;
}

function producedEuPerTick(model:RecipeModel):number {
    return -Object.values(model.flow.energy).reduce((sum, value) => sum + value, 0);
}

describe('Tiered fuel generators', () => {
    beforeAll(async () => {
        await setupRepository();
    });

    it.each(RECIPES)('treats %s as an energy-bearing recipe type', (recipeId) => {
        const recipe = Repository.current.GetById<Recipe>(recipeId)!;
        expect(recipe.recipeType.usesEnergy).toBe(true);
    });

    it.each(RECIPES)('scales %s singleblocks with free parallels', (recipeId) => {
        const recipe = Repository.current.GetById<Recipe>(recipeId)!;
        const baseRecipesPerMinute = 1200 / recipe.gtRecipe.durationTicks;
        for (const tier of [TIER_LV, TIER_MV, TIER_HV]) {
            const model = solve(recipeId, tier);
            const expectedParallels = Math.pow(4, tier);
            expect(model.overclockTiers).toBe(0);
            expect(model.parallels).toBe(expectedParallels);
            expect(model.recipesPerMinute).toBeCloseTo(baseRecipesPerMinute * Math.pow(4, tier), 8);
            expect(producedEuPerTick(model)).toBeCloseTo(voltageTier[tier].voltage, 8);
        }
    });

    it.each(RECIPES)('clamps unavailable %s singleblock tiers to HV', (recipeId) => {
        const model = solve(recipeId, TIER_UEV);
        expect(model.voltageTier).toBe(TIER_HV);
        expect(model.parallels).toBe(16);
        expect(producedEuPerTick(model)).toBeCloseTo(voltageTier[TIER_HV].voltage, 8);
    });

    it.each(RECIPES)('scales %s compound generators from 16 base parallels', (recipeId) => {
        const recipe = Repository.current.GetById<Recipe>(recipeId)!;
        const baseRecipesPerMinute = 1200 / recipe.gtRecipe.durationTicks;
        for (const { tier, crafter } of COMPOUND_GENERATORS) {
            const model = solve(recipeId, TIER_LV, crafter);
            const expectedParallels = 16 * Math.pow(4, tier);
            expect(model.voltageTier).toBe(tier);
            expect(model.overclockTiers).toBe(0);
            expect(model.parallels).toBe(expectedParallels);
            expect(model.recipesPerMinute).toBeCloseTo(baseRecipesPerMinute * 16 * Math.pow(4, tier), 8);
            expect(producedEuPerTick(model)).toBeCloseTo(16 * voltageTier[tier].voltage, 8);
        }
    });

    it.each(RECIPES)('keeps the basic %s compound generator fixed at LV', (recipeId) => {
        const model = solve(recipeId, TIER_UEV, 'i:gtceu:lv_compound_generator:0');
        expect(model.voltageTier).toBe(TIER_LV);
        expect(model.parallels).toBe(16);
        expect(producedEuPerTick(model)).toBeCloseTo(16 * voltageTier[TIER_LV].voltage, 8);
    });
});

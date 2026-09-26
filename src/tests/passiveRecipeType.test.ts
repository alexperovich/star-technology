import { PageModel, RecipeModel } from '../page';
import { Recipe, Repository } from '../repository';
import { SolvePage } from '../solver';
import { setupRepository } from './setup';
import { TIER_UV } from '../utils';

const FERMENTING_RECIPE = 'r:start:fermenting/sweetcorn_beer';
const COMPOSTING_RECIPE = 'r:start:composting/poppy';

describe('Recipe types without EU consumption', () => {
    beforeAll(async () => {
        await setupRepository();
    });

    it('classifies fermenting as non-EU-consuming', () => {
        const recipe = Repository.current.GetById<Recipe>(FERMENTING_RECIPE)!;
        expect(recipe.recipeType.usesEnergy).toBe(false);
    });

    it.each([
        [FERMENTING_RECIPE, 'i:gtceu:casket:0'],
        [COMPOSTING_RECIPE, 'i:gtceu:advanced_composter:0'],
    ])('classifies the crafter for %s as an ordinary singleblock', (recipeId, crafterId) => {
        const recipe = Repository.current.GetById<Recipe>(recipeId)!;
        expect(recipe.recipeType.singleblocks.some((item) => item?.id === crafterId)).toBe(true);
        expect(recipe.recipeType.multiblocks.some((item) => item.id === crafterId)).toBe(false);
    });

    it('does not overclock fermenting recipes at higher voltage tiers', () => {
        const page = new PageModel({
            name: 'Passive Recipe Type Test',
            products: [],
            rootGroup: {
                type: 'recipe_group',
                links: {},
                elements: [{
                    type: 'recipe',
                    recipeId: FERMENTING_RECIPE,
                    voltageTier: TIER_UV,
                    fixedCrafterCount: 1,
                    crafter: 'i:gtceu:casket:0',
                    choices: {},
                }],
            },
        });

        SolvePage(page);
        const model = page.rootGroup.elements[0] as RecipeModel;

        expect(model.voltageTier).toBe(model.recipe!.gtRecipe.voltageTier);
        expect(model.overclockTiers).toBe(0);
        expect(model.overclockFactor).toBe(1);
        expect(model.multiblockCrafter).toBeNull();
        expect(model.machineInfo.info).toBeUndefined();
        expect(model.recipesPerMinute).toBe(12);
        expect(model.flow.output['f:kubejs:sweetcorn_beer'] / 60).toBeCloseTo(20, 8);
    });
});

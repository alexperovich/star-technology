import { PageModel, RecipeModel } from '../page';
import { Recipe, RecipeIoType, Repository } from '../repository';
import { SolvePage } from '../solver';
import { setupRepository } from './setup';

const TDA = 'i:gtceu:super_pyrolyse:0';
const CHARCOAL_BYPRODUCTS = 'r:gtceu:pyrolyse_oven/log_to_charcoal_byproducts';

function solveTda(voltageTier: number): RecipeModel {
    const page = new PageModel({
        name: 'Pyrolyse Test',
        products: [],
        rootGroup: {
            type: 'recipe_group',
            links: {},
            elements: [{
                type: 'recipe',
                recipeId: CHARCOAL_BYPRODUCTS,
                voltageTier,
                fixedCrafterCount: 1,
                crafter: TDA,
                choices: { coilTier: 5 },
            }],
        },
    });
    SolvePage(page);
    return page.rootGroup.elements[0] as RecipeModel;
}

describe('Pyrolyse Oven', () => {
    beforeAll(async () => {
        await setupRepository();
    });

    it('matches the TDA charcoal-byproducts rate with Naquadah coils at ZPM', () => {
        const model = solveTda(6);
        const recipe = Repository.current.GetById<Recipe>(CHARCOAL_BYPRODUCTS)!;
        const byproducts = recipe.items.find((slot) =>
            slot.type === RecipeIoType.FluidOutput && slot.goods.id === 'f:gtceu:charcoal_byproducts')!;

        expect(model.recipesPerMinute).toBeCloseTo(1200, 5);
        expect(model.flow.output[byproducts.goods.id] / 60).toBeCloseTo(80000, 5);
    });

    it('matches the TDA charcoal-byproducts batch rate with Naquadah coils at HV', () => {
        const model = solveTda(2);
        const recipe = Repository.current.GetById<Recipe>(CHARCOAL_BYPRODUCTS)!;
        const byproducts = recipe.items.find((slot) =>
            slot.type === RecipeIoType.FluidOutput && slot.goods.id === 'f:gtceu:charcoal_byproducts')!;

        expect(model.flow.output[byproducts.goods.id] / 60).toBeCloseTo(16000 / 4.2, 5);
    });
});
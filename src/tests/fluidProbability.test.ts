/// <reference types="jest" />

import { PageModel, RecipeModel } from '../page';
import { Recipe, RecipeIoType, Repository } from '../repository';
import { SolvePage } from '../solver';
import { setupRepository } from './setup';

const RECIPE_ID = 'r:gtceu:chemical_reactor/dichloroethane';

describe('Fluid input probabilities', () => {
    beforeAll(async () => {
        await setupRepository();
    });

    it('reads and applies zero-probability fluid catalyst inputs', () => {
        const recipe = Repository.current.GetById<Recipe>(RECIPE_ID)!;
        expect(recipe).toBeDefined();

        const catalyst = recipe.items.find((slot) =>
            (slot.type === RecipeIoType.FluidInput || slot.type === RecipeIoType.FluidOreDictInput) &&
            slot.probability === 0);
        expect(catalyst).toBeDefined();
        expect(catalyst!.amount).toBe(100);

        const page = new PageModel({
            name: 'Fluid Probability Test',
            products: [],
            rootGroup: {
                type: 'recipe_group',
                links: {},
                elements: [{
                    type: 'recipe',
                    recipeId: RECIPE_ID,
                    voltageTier: recipe.gtRecipe.voltageTier,
                    fixedCrafterCount: 1,
                    choices: {},
                }],
            },
        });
        SolvePage(page);
        const model = page.rootGroup.elements[0] as RecipeModel;

        expect(model.recipeItems).toContain(catalyst);
        expect(model.flow.input[catalyst!.goods.id]).toBe(0);
    });
});
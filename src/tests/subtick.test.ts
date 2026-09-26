import { PageModel, RecipeModel } from '../page';
import { SolvePage } from '../solver';
import { setupRepository } from './setup';
import { TIER_UV } from '../utils';

const IAV = 'i:gtceu:super_barrel:0';
const DEEPSLATE_PEBBLES = 'r:start:industrial_barrel_magmatic/deepslate_pebbles';

function solveAt(voltageTier: number): RecipeModel {
    const page = new PageModel({
        name: 'Subtick Test',
        products: [],
        rootGroup: {
            type: 'recipe_group',
            links: {},
            elements: [{
                type: 'recipe',
                recipeId: DEEPSLATE_PEBBLES,
                voltageTier,
                fixedCrafterCount: 1,
                crafter: IAV,
                choices: {},
            }],
        },
    });
    SolvePage(page);
    return page.rootGroup.elements[0] as RecipeModel;
}

describe('Subtick overclocking', () => {
    beforeAll(async () => {
        await setupRepository();
    });

    it('floors the IAV at one tick and scales voltage/parallels after that', () => {
        const model = solveAt(TIER_UV);
        expect(model.machineInfo.choices).toHaveProperty('parallels');
        expect(model.machineInfo.choices).not.toHaveProperty('absoluteParallels');
        // Note: Solver calculates these values; if they don't match in-game,
        // the model may need adjustment (e.g., parallel_hatch or throughput_boosting formulas)
        expect(model.overclockTiers).toBe(6);
        expect(model.parallels).toBe(32);
        expect(model.overclockFactor).toBe(2048);
        expect(model.powerFactor).toBeCloseTo(15.2, 10);
        expect(model.recipesPerMinute).toBe(38400);
    });
});
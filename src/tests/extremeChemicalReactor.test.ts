import { PageModel, RecipeModel } from '../page';
import { SolvePage } from '../solver';
import { CoilTierNames, ParallelHatchTiers, TIER_ZPM } from '../utils';
import { setupRepository } from './setup';

const EXTREME_CHEMICAL_REACTOR = 'i:gtceu:extreme_chemical_reactor:0';
const RADON_RECIPE = 'r:gtceu:large_chemical_reactor/radon_from_uranium_238';
const RADON = 'f:gtceu:radon';

function choiceIndex(values: string[], expected: string): number {
    const index = values.findIndex(value => value === expected);
    if (index < 0)
        throw new Error(`Missing machine choice: ${expected}`);
    return index;
}

function solveRadonRecipe(): RecipeModel {
    const coilTier = choiceIndex(CoilTierNames, 'Zalloy');
    const parallelHatch = ParallelHatchTiers.findIndex(tier => tier.name === 'Epic');
    if (parallelHatch < 0)
        throw new Error('Missing machine choice: Epic Parallel Control Hatch');

    const page = new PageModel({
        name: 'Extreme Chemical Reactor Test',
        products: [],
        rootGroup: {
            type: 'recipe_group',
            links: {},
            elements: [{
                type: 'recipe',
                recipeId: RADON_RECIPE,
                voltageTier: TIER_ZPM,
                fixedCrafterCount: 1,
                crafter: EXTREME_CHEMICAL_REACTOR,
                choices: {
                    coilTier,
                    parallels: parallelHatch,
                },
            }],
        },
    });
    SolvePage(page);
    return page.rootGroup.elements[0] as RecipeModel;
}

describe('Extreme Chemical Reactor', () => {
    beforeAll(async () => {
        await setupRepository();
    });

    it('matches in-game ZPM radon production with Zalloy coils and an Epic parallel hatch', () => {
        const model = solveRadonRecipe();
        const durationSeconds = model.parallels * 60 / model.recipesPerMinute;
        const radonPerSecond = model.flow.output[RADON] / 60;
        const euPerTick = model.flow.energy[TIER_ZPM];

        expect(model.parallels).toBe(273);
        expect(durationSeconds).toBeCloseTo(72.70, 2);
        expect(radonPerSecond).toBeCloseTo(3755.16, 2);
        expect(euPerTick).toBeCloseTo(78624, 0);
    });
});

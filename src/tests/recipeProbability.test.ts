import { formatRecipeProbability } from '../recipeProbability';
import { RecipeIoType } from '../repository';

describe('recipe probability labels', () => {
    it.each([
        RecipeIoType.ItemInput,
        RecipeIoType.OreDictInput,
        RecipeIoType.FluidInput,
        RecipeIoType.FluidOreDictInput,
    ])('shows zero-consumption input type %s as NC', (type) => {
        expect(formatRecipeProbability(0, type)).toBe('NC');
    });

    it.each([
        RecipeIoType.ItemOutput,
        RecipeIoType.FluidOutput,
    ])('keeps zero-probability output type %s as 0%%', (type) => {
        expect(formatRecipeProbability(0, type)).toBe('0%');
    });

    it('keeps percentage labels for consumed inputs', () => {
        expect(formatRecipeProbability(0.5, RecipeIoType.ItemInput)).toBe('50%');
    });
});

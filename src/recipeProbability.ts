import { RecipeIoType } from "./repository.js";

export function formatRecipeProbability(probability: number, type: RecipeIoType): string {
    const isInput = type <= RecipeIoType.FluidOreDictInput;
    if (isInput && probability === 0)
        return "NC";
    return `${Math.round(probability * 100)}%`;
}
